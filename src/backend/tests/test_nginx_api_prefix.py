"""Contract test for `/v1` and its transitional `/api` alias (#558).

The alias lives in nginx, the API gateway in front of FastAPI. This test runs
the real frontend nginx config in an `nginx:alpine` container against a fake
upstream and sends the same requests through both prefixes.

It asserts behavior, never config text: the upstream sees the same path,
query, method, body and headers for `/api` and `/v1`; SSE stays unbuffered;
`/metrics` is blocked under both names and never reaches the upstream.

The suite must keep working where no container runtime is available (a
reviewer without Docker, for instance), so the fixture skips in that case
instead of failing. A runtime that is available but rejects the config fails.
"""

import hashlib
import http.client
import json
import os
import shutil
import socket
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urlsplit

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
FRONTEND_NGINX = REPO_ROOT / "src" / "frontend" / "nginx.conf"
NGINX_IMAGE = "docker.io/library/nginx:alpine"
UPSTREAM_HOST = "backend"
# The fake upstream holds the SSE response open this long. Reading the first
# event well before it proves nginx is not buffering the stream.
STREAM_HOLD_S = 3.0
STREAM_FIRST_EVENT_MAX_S = 2.0


class _FakeUpstream:
    """Tiny HTTP server that echoes what nginx forwarded."""

    def __init__(self) -> None:
        self.requests: list[dict] = []
        self._lock = threading.Lock()
        self._server = ThreadingHTTPServer(("0.0.0.0", 0), self._handler())
        self._server.daemon_threads = True
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)

    @property
    def port(self) -> int:
        return int(self._server.server_address[1])

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._server.shutdown()
        self._server.server_close()

    def _record(self, record: dict) -> None:
        with self._lock:
            self.requests.append(record)

    def _handler(self):
        upstream = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, format, *args):  # noqa: A002 - stdlib signature
                pass

            def do_GET(self):
                self._respond()

            def do_POST(self):
                self._respond()

            def _respond(self):
                parts = urlsplit(self.path)
                length = int(self.headers.get("Content-Length") or 0)
                body = self.rfile.read(length) if length else b""
                record = {
                    "method": self.command,
                    "path": parts.path,
                    "query": parts.query,
                    "body_sha256": hashlib.sha256(body).hexdigest(),
                    "content_length": self.headers.get("Content-Length"),
                    "headers": {k.lower(): v for k, v in self.headers.items()},
                }
                upstream._record(record)

                if parts.path.endswith("/notifications/stream"):
                    self.send_response(200)
                    self.send_header("Content-Type", "text/event-stream")
                    self.send_header("Cache-Control", "no-cache")
                    self.send_header("Connection", "close")
                    self.end_headers()
                    self.wfile.write(b"data: first\n\n")
                    self.wfile.flush()
                    time.sleep(STREAM_HOLD_S)
                    self.wfile.write(b"data: second\n\n")
                    self.wfile.flush()
                    self.close_connection = True
                    return

                payload = json.dumps(record).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

        return Handler


def _container_runtime() -> str | None:
    forced = os.getenv("OIKONOMIA_NGINX_RUNTIME")
    candidates = [forced] if forced else ["docker", "podman"]
    for name in candidates:
        if not name or shutil.which(name) is None:
            continue
        try:
            proc = subprocess.run([name, "info"], capture_output=True, timeout=20, text=True)
        except (OSError, subprocess.TimeoutExpired):
            continue
        if proc.returncode == 0:
            return name
    return None


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _request(port: int, method: str, path: str, body: bytes | None = None, headers=None):
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=20)
    try:
        conn.request(method, path, body=body, headers={"Host": "platform.test", **(headers or {})})
        response = conn.getresponse()
        payload = response.read()
        return response.status, dict(response.getheaders()), payload
    finally:
        conn.close()


@pytest.fixture(scope="module")
def nginx(tmp_path_factory):
    runtime = _container_runtime()
    if runtime is None:
        pytest.skip("no usable docker/podman runtime for the nginx contract test")

    if not FRONTEND_NGINX.exists():
        pytest.fail(f"missing nginx config: {FRONTEND_NGINX}")

    upstream = _FakeUpstream()
    upstream.start()

    container = f"oikonomia-api-prefix-{os.getpid()}"
    conf_dir = tmp_path_factory.mktemp("nginx-api-prefix")
    config = FRONTEND_NGINX.read_text()
    # Point the real config at the fake upstream's ephemeral port. This is
    # fixture wiring, not a contract assertion.
    if f"{UPSTREAM_HOST}:8000" not in config:
        pytest.fail("nginx config no longer proxies to backend:8000; update the fixture")
    (conf_dir / "default.conf").write_text(
        config.replace(f"{UPSTREAM_HOST}:8000", f"{UPSTREAM_HOST}:{upstream.port}")
    )

    if subprocess.run([runtime, "image", "inspect", NGINX_IMAGE], capture_output=True).returncode:
        pulled = subprocess.run(
            [runtime, "pull", NGINX_IMAGE], capture_output=True, text=True, timeout=180
        )
        if pulled.returncode:
            upstream.stop()
            pytest.skip(f"cannot obtain {NGINX_IMAGE}: {pulled.stderr.strip()[-300:]}")

    base = [
        "--rm",
        "--add-host",
        f"{UPSTREAM_HOST}:host-gateway",
        "-v",
        f"{conf_dir}:/etc/nginx/conf.d:ro,z",
    ]

    checked = subprocess.run(
        [runtime, "run", *base, NGINX_IMAGE, "nginx", "-t"],
        capture_output=True,
        text=True,
        timeout=60,
    )
    if checked.returncode != 0:
        upstream.stop()
        pytest.fail(f"nginx rejects the config:\n{checked.stderr}")

    port = _free_port()
    started = subprocess.run(
        [
            runtime,
            "run",
            "-d",
            "--name",
            container,
            "-p",
            f"127.0.0.1:{port}:80",
            *base,
            NGINX_IMAGE,
        ],
        capture_output=True,
        text=True,
        timeout=60,
    )
    if started.returncode != 0:
        upstream.stop()
        pytest.skip(f"cannot start the nginx container: {started.stderr.strip()[-300:]}")

    try:
        deadline = time.monotonic() + 20
        while True:
            try:
                status, _, _ = _request(port, "GET", "/api/health")
                if status == 200:
                    break
            except OSError:
                pass
            if time.monotonic() > deadline:
                logs = subprocess.run([runtime, "logs", container], capture_output=True, text=True)
                pytest.fail(f"nginx did not become ready:\n{logs.stdout}\n{logs.stderr}")
            time.sleep(0.2)

        yield SimpleNamespace(port=port, upstream=upstream)
    finally:
        subprocess.run([runtime, "rm", "-f", container], capture_output=True)
        upstream.stop()


@pytest.mark.parametrize("prefix", ["/api", "/v1"])
def test_both_prefixes_reach_the_same_upstream_route(nginx, prefix):
    status, _, body = _request(nginx.port, "GET", f"{prefix}/expenses/abc?limit=2&tag=food")

    assert status == 200
    record = json.loads(body)
    assert record["path"] == "/expenses/abc"
    assert record["query"] == "limit=2&tag=food"
    assert record["headers"]["host"] == "platform.test"
    assert record["headers"]["x-forwarded-proto"] == "http"


def test_api_and_v1_responses_are_identical(nginx):
    api = _request(nginx.port, "GET", "/api/dashboard/summary?month=2026-11")
    v1 = _request(nginx.port, "GET", "/v1/dashboard/summary?month=2026-11")

    assert api[0] == v1[0] == 200
    assert json.loads(api[2]) == json.loads(v1[2])


@pytest.mark.parametrize("prefix", ["/api", "/v1"])
def test_multipart_uploads_survive_both_prefixes(nginx, prefix):
    boundary = "----oikonomia-api-prefix-contract"
    body = (
        f"--{boundary}\r\n"
        'Content-Disposition: form-data; name="file"; filename="statement.pdf"\r\n'
        "Content-Type: application/pdf\r\n\r\n"
        "%PDF-1.4 fake statement body\r\n"
        f"--{boundary}--\r\n"
    ).encode()
    content_type = f"multipart/form-data; boundary={boundary}"

    status, _, response = _request(
        nginx.port,
        "POST",
        f"{prefix}/import-jobs",
        body=body,
        headers={"Content-Type": content_type},
    )

    assert status == 200
    record = json.loads(response)
    assert record["body_sha256"] == hashlib.sha256(body).hexdigest()
    assert record["content_length"] == str(len(body))
    assert record["headers"]["content-type"] == content_type


@pytest.mark.parametrize("prefix", ["/api", "/v1"])
def test_sse_is_streamed_unbuffered_on_both_prefixes(nginx, prefix):
    conn = http.client.HTTPConnection("127.0.0.1", nginx.port, timeout=20)
    try:
        started = time.monotonic()
        conn.request("GET", f"{prefix}/notifications/stream?token=contract")
        response = conn.getresponse()
        first_line = response.readline()
        elapsed = time.monotonic() - started
        rest = response.read()
    finally:
        conn.close()

    assert response.status == 200
    assert first_line == b"data: first\n"
    assert b"data: second" in rest
    # With proxy_buffering on, the first read would wait for the upstream's
    # full 3s hold instead of arriving immediately.
    assert elapsed < STREAM_FIRST_EVENT_MAX_S


def test_metrics_are_blocked_under_both_prefixes(nginx):
    seen_before = len(nginx.upstream.requests)

    for prefix in ("/api", "/v1"):
        status, _, _ = _request(nginx.port, "GET", f"{prefix}/metrics")
        assert status == 404

    assert len(nginx.upstream.requests) == seen_before, "/metrics must never reach the backend"
