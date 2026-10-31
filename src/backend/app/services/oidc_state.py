"""One-time state and login codes for OIDC redirect flows.

The state protects the redirect against CSRF/session fixation; the login code
keeps the access token out of the URL, history and referrer. Both live in Redis
and are consumed atomically. If Redis is unavailable we fail closed: a login is
never completed without validating the state and the one-time code.
"""

import logging
import secrets

from app.services.rate_limit import _get_redis

logger = logging.getLogger(__name__)

_STATE_PREFIX = "oidc:state:"
_CODE_PREFIX = "oidc:code:"
STATE_TTL_SECONDS = 600
CODE_TTL_SECONDS = 60


class OidcStateUnavailableError(RuntimeError):
    """Redis is not available; the flow cannot be completed safely."""


def _client():
    try:
        return _get_redis()
    except Exception as exc:  # pragma: no cover - depends on the redis client
        raise OidcStateUnavailableError("Redis unavailable") from exc


def _consume(key: str) -> str | None:
    """Read and delete a key atomically when possible."""
    r = _client()
    # getdel is atomic; fall back to get+delete on older clients.
    if hasattr(r, "getdel"):
        return r.getdel(key)
    value = r.get(key)
    if value is not None:
        r.delete(key)
    return value


def create_state(ttl: int = STATE_TTL_SECONDS) -> str:
    state = secrets.token_urlsafe(32)
    try:
        _client().setex(f"{_STATE_PREFIX}{state}", ttl, "1")
    except Exception as exc:
        raise OidcStateUnavailableError("Redis unavailable") from exc
    return state


def consume_state(state: str) -> bool:
    if not state:
        return False
    try:
        return _consume(f"{_STATE_PREFIX}{state}") is not None
    except Exception as exc:
        logger.warning("OIDC state consume failed: %s", exc)
        return False


def create_login_code(user_id: int, ttl: int = CODE_TTL_SECONDS) -> str:
    code = secrets.token_urlsafe(32)
    try:
        _client().setex(f"{_CODE_PREFIX}{code}", ttl, str(user_id))
    except Exception as exc:
        raise OidcStateUnavailableError("Redis unavailable") from exc
    return code


def consume_login_code(code: str) -> int | None:
    if not code:
        return None
    try:
        value = _consume(f"{_CODE_PREFIX}{code}")
    except Exception as exc:
        logger.warning("OIDC login code consume failed: %s", exc)
        return None
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        logger.warning("OIDC login code contained a non-integer user id")
        return None
