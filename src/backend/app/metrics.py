"""In-memory metrics middleware and Prometheus exposition for the admin panel."""

import threading
import time
from collections import deque

from fastapi import FastAPI, Request
from prometheus_client import (
    CONTENT_TYPE_LATEST,
    REGISTRY,
    Counter,
    Histogram,
    generate_latest,
)
from starlette.responses import Response

# ── Prometheus counters / histograms ──────────────────────────

REQUEST_COUNT = Counter(
    "http_requests_total",
    "Total HTTP requests",
    ["method", "endpoint", "status"],
)

REQUEST_LATENCY = Histogram(
    "http_request_duration_seconds",
    "Request latency in seconds",
    ["method", "endpoint"],
    buckets=(0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0),
)

# ── In-memory ring buffer for admin UI ────────────────────────

_MAX_HISTORY = 1000  # last N requests kept


class _MetricsState:
    """Thread-safe in-memory metrics ring buffer (no persistence, no per-user data)."""

    def __init__(self, maxlen: int = _MAX_HISTORY) -> None:
        self.lock = threading.Lock()
        self.history: deque[dict] = deque(maxlen=maxlen)
        self.total = 0
        self.errors = 0  # 4xx + 5xx

    def record(self, method: str, path: str, status: int, duration_ms: float) -> None:
        ts = int(time.time())
        with self.lock:
            self.history.append({"m": method, "p": path, "s": status, "d": duration_ms, "t": ts})
            self.total += 1
            if status >= 400:
                self.errors += 1

    def summary(self, window: int = 300) -> dict:
        """Return aggregated counts for the last *window* seconds."""
        cutoff = int(time.time()) - window
        with self.lock:
            recent = [e for e in self.history if e["t"] >= cutoff]
        count = len(recent)
        errs = sum(1 for e in recent if e["s"] >= 400)
        latencies = sorted(e["d"] for e in recent)
        p50 = latencies[len(latencies) // 2] if latencies else 0
        p95 = latencies[int(len(latencies) * 0.95)] if latencies else 0
        p99 = latencies[int(len(latencies) * 0.99)] if latencies else 0
        return {
            "window_seconds": window,
            "request_count": count,
            "error_count": errs,
            "error_rate": round(errs / count * 100, 2) if count else 0,
            "p50_ms": round(p50, 2),
            "p95_ms": round(p95, 2),
            "p99_ms": round(p99, 2),
            "throughput_rpm": round(count / window * 60, 1) if window else 0,
        }


_metrics = _MetricsState()

# ── Middleware (injected in main.py) ──────────────────────────

_PATH_EXCLUDES = ("/metrics", "/health", "/docs", "/openapi.json", "/redoc")


def _metrics_middleware_factory():
    """Return an ASGI middleware that records request metrics."""

    async def _middleware(request: Request, call_next):
        # Skip noisy internal paths
        path = request.url.path
        if any(path.startswith(ex) for ex in _PATH_EXCLUDES):
            return await call_next(request)

        method = request.method
        start = time.perf_counter()
        response = await call_next(request)
        duration = (time.perf_counter() - start) * 1000  # ms
        status = response.status_code

        # Prometheus
        endpoint = path
        REQUEST_COUNT.labels(method=method, endpoint=endpoint, status=status).inc()
        REQUEST_LATENCY.labels(method=method, endpoint=endpoint).observe(duration / 1000)

        # In-memory buffer (for admin UI)
        _metrics.record(method, path, status, duration)
        return response

    return _middleware


def install_metrics(app: FastAPI) -> None:
    """Mount the metrics middleware and /metrics endpoint on *app*."""
    from starlette.middleware.base import BaseHTTPMiddleware

    app.add_middleware(BaseHTTPMiddleware, dispatch=_metrics_middleware_factory())

    @app.get("/metrics", include_in_schema=False)
    async def prometheus_metrics():
        return Response(content=generate_latest(REGISTRY), media_type=CONTENT_TYPE_LATEST)


# ── Admin helpers (used by admin.py) ─────────────────────────


def get_usage_stats(window: int = 86400) -> dict:
    """Aggregated request/error stats for the last *window* seconds."""
    return _metrics.summary(window=window)
