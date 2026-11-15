"""Rate limiting must use the real client IP and fail open when Redis is down (#530)."""

import redis
from starlette.requests import Request

from app.routers.auth import _get_client_ip
from app.services import rate_limit


def _request(headers: dict[str, str] | None = None, peer: str = "10.0.0.1") -> Request:
    raw = [(key.lower().encode(), value.encode()) for key, value in (headers or {}).items()]
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/",
            "headers": raw,
            "client": (peer, 1234),
            "scheme": "http",
            "query_string": b"",
            "server": ("testserver", 80),
        }
    )


def test_xff_uses_the_last_hop_from_a_trusted_proxy():
    request = _request({"x-forwarded-for": "1.2.3.4, 9.9.9.9"}, peer="10.0.0.1")

    assert _get_client_ip(request) == "9.9.9.9"


def test_xff_is_ignored_from_a_public_peer():
    request = _request({"x-forwarded-for": "1.2.3.4"}, peer="8.8.8.8")

    assert _get_client_ip(request) == "8.8.8.8"


def test_no_xff_uses_the_peer():
    assert _get_client_ip(_request(peer="10.0.0.1")) == "10.0.0.1"


def test_explicit_trusted_proxy_can_be_public(monkeypatch):
    monkeypatch.setenv("TRUSTED_PROXIES", "203.0.113.5")
    request = _request({"x-forwarded-for": "1.2.3.4, 9.9.9.9"}, peer="203.0.113.5")

    assert _get_client_ip(request) == "9.9.9.9"


def test_redis_timeouts_are_short(monkeypatch):
    captured = {}

    def fake_from_url(url, **kwargs):
        captured.update(kwargs)
        return object()

    monkeypatch.setattr(rate_limit, "_redis", None)
    monkeypatch.setattr(rate_limit.redis, "from_url", fake_from_url)

    rate_limit._get_redis()

    assert captured["socket_connect_timeout"] == 1
    assert captured["socket_timeout"] == 1
    assert captured["decode_responses"] is True


def test_rate_limit_fails_open_when_redis_is_down(monkeypatch):
    def down():
        raise redis.RedisError("redis down")

    monkeypatch.setattr(rate_limit, "_get_redis", down)

    assert rate_limit.check_rate_limit("1.2.3.4", "login") == (True, 0)
    assert rate_limit.is_account_locked(1) == (False, 0)
    assert rate_limit.record_failed_login(1) == rate_limit.LOCKOUT_CONFIG["max_failed_attempts"]
    rate_limit.reset_failed_logins(1)
