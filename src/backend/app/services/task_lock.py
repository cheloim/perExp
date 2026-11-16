"""Best-effort distributed lock for scheduled Celery tasks.

Redis is the shared coordination point; if it is unavailable the task runs
without the lock (fail-open) and logs the degradation, matching the cache and
rate-limit policy. The tasks themselves are also made idempotent so a rare
duplicate run cannot create duplicate rows.
"""

from __future__ import annotations

import logging
import secrets
from contextlib import contextmanager

from app.services.rate_limit import _get_redis

logger = logging.getLogger(__name__)


@contextmanager
def task_lock(name: str, ttl: int = 3600):
    key = f"task_lock:{name}"
    token = secrets.token_hex(16)
    try:
        client = _get_redis()
        acquired = client.set(key, token, nx=True, ex=ttl)
    except Exception as exc:
        logger.warning("task lock %s unavailable, running without lock: %s", name, exc)
        yield True
        return

    if not acquired:
        logger.info("task lock %s is held by another worker; skipping", name)
        yield False
        return

    try:
        yield True
    finally:
        try:
            client.eval(
                "if redis.call('get', KEYS[1]) == ARGV[1] "
                "then return redis.call('del', KEYS[1]) else return 0 end",
                1,
                key,
                token,
            )
        except Exception as exc:
            logger.warning("task lock %s release failed: %s", name, exc)
