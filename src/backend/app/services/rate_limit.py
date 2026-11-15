"""Redis-based rate limiting and account lockout.

The limiter is a protection, not a gate for the whole app: if Redis is slow or
down, login must still work. Every operation fails open and logs the
degradation, and the client has short socket timeouts so a hung Redis does not
hold the request path.
"""

import logging
import os
import time

import redis

logger = logging.getLogger(__name__)

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
_redis: redis.Redis | None = None


def _get_redis() -> redis.Redis:
    global _redis
    if _redis is None:
        _redis = redis.from_url(
            REDIS_URL,
            decode_responses=True,
            socket_connect_timeout=1,
            socket_timeout=1,
        )
    return _redis


# --- Rate Limiting ---

RATE_LIMITS = {
    "login": {"max_attempts": 10, "window_seconds": 60},
    "register": {"max_attempts": 3, "window_seconds": 300},
    "forgot_password": {"max_attempts": 3, "window_seconds": 300},
    "mfa": {"max_attempts": 5, "window_seconds": 300},
    "password_change": {"max_attempts": 5, "window_seconds": 300},
    "token_refresh": {"max_attempts": 20, "window_seconds": 60},
    "capture": {"max_attempts": 60, "window_seconds": 3600},
}


def check_rate_limit(key: str, limit_type: str) -> tuple[bool, int]:
    """Check rate limit. Returns (is_allowed, retry_after_seconds).

    Fails open: a Redis outage must not block logins or other protected paths.
    """
    config = RATE_LIMITS.get(limit_type, RATE_LIMITS["login"])
    redis_key = f"rate_limit:{limit_type}:{key}"

    try:
        r = _get_redis()
        now = time.time()
        window_start = now - config["window_seconds"]

        pipe = r.pipeline()
        pipe.zremrangebyscore(redis_key, 0, window_start)
        pipe.zadd(redis_key, {str(now): now})
        pipe.zcard(redis_key)
        pipe.expire(redis_key, config["window_seconds"])
        results = pipe.execute()

        current_count = results[2]
        if current_count > config["max_attempts"]:
            retry_after = int(
                config["window_seconds"] - (now - float(r.zrange(redis_key, 0, 0)[0]))
            )
            return False, max(retry_after, 1)
        return True, 0
    except Exception as exc:
        logger.warning("rate limit %s unavailable, failing open: %s", limit_type, exc)
        return True, 0


# --- Account Lockout ---

LOCKOUT_CONFIG = {
    "max_failed_attempts": 5,
    "lockout_duration_seconds": 900,  # 15 minutes
}


def record_failed_login(user_id: int) -> int:
    """Record a failed login attempt. Returns remaining attempts before lockout.

    Fails open: without Redis we cannot count, and locking a user out because
    the counter is unavailable would turn an outage into an account lockout.
    """
    try:
        r = _get_redis()
        key = f"failed_login:{user_id}"
        lockout_key = f"lockout:{user_id}"

        if r.exists(lockout_key):
            return 0

        attempts = r.incr(key)
        r.expire(key, LOCKOUT_CONFIG["lockout_duration_seconds"])

        remaining = LOCKOUT_CONFIG["max_failed_attempts"] - attempts
        if remaining <= 0:
            r.setex(lockout_key, LOCKOUT_CONFIG["lockout_duration_seconds"], "1")
            return 0
        return remaining
    except Exception as exc:
        logger.warning("failed-login counter unavailable, failing open: %s", exc)
        return LOCKOUT_CONFIG["max_failed_attempts"]


def reset_failed_logins(user_id: int) -> None:
    """Reset failed login attempts after successful login."""
    try:
        r = _get_redis()
        r.delete(f"failed_login:{user_id}", f"lockout:{user_id}")
    except Exception as exc:
        logger.warning("failed-login reset unavailable: %s", exc)


def is_account_locked(user_id: int) -> tuple[bool, int]:
    """Check if account is locked. Returns (is_locked, retry_after_seconds)."""
    try:
        r = _get_redis()
        ttl = r.ttl(f"lockout:{user_id}")
        if ttl > 0:
            return True, ttl
        return False, 0
    except Exception as exc:
        logger.warning("lockout check unavailable, failing open: %s", exc)
        return False, 0
