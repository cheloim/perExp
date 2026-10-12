"""Shared Redis cache for API aggregates (p95).

Cache-aside with Postgres as source of truth:
- miss or Redis error -> caller runs DB path unchanged, returns DB result.
- never raises: set/delete are best-effort, get returns None on miss/error.
- short socket timeouts + 10s circuit breaker so a down Redis adds ~0ms.
- 10s in-process L1 absorbs same-process bursts without a network hop.

Key rule: every input that changes the response belongs in the key.
Use group_hash() for group-scoped endpoints so member changes invalidate.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import logging
import time

logger = logging.getLogger(__name__)

# Reuse broker URL by default; allow a dedicated cache DB via env.
# e.g. REDIS_CACHE_URL=redis://redis:6379/2 isolates cache from Celery broker /0.
_L1: dict[str, tuple[float, object]] = {}
_L1_TTL = 10.0

_circuit_open_until = 0.0
_CIRCUIT_COOLDOWN = 10.0

_redis_client = None

# Raw JSON over this size is gzipped before storing (LLM payloads).
_GZIP_THRESHOLD = 10 * 1024


def _cache_redis_url() -> str:
    import os

    return os.getenv("REDIS_CACHE_URL", "") or os.getenv("REDIS_URL", "redis://localhost:6379/0")


def _get_redis():
    global _redis_client
    if _redis_client is not None:
        return _redis_client
    import redis

    _redis_client = redis.from_url(
        _cache_redis_url(),
        decode_responses=False,  # bytes: we store JSON, sometimes gzipped
        socket_connect_timeout=0.05,
        socket_timeout=0.2,
    )
    return _redis_client


def _circuit_open() -> bool:
    return time.time() < _circuit_open_until


def _trip_circuit() -> None:
    global _circuit_open_until
    _circuit_open_until = time.time() + _CIRCUIT_COOLDOWN


def group_hash(uid_list: list[int]) -> str:
    """Stable short hash for a group member list. Order-independent."""
    h = hashlib.sha256(",".join(str(i) for i in sorted(uid_list)).encode()).hexdigest()
    return h[:12]


def _l1_get(key: str):
    entry = _L1.get(key)
    if entry and time.time() < entry[0]:
        return entry[1]
    _L1.pop(key, None)
    return None


def _l1_set(key: str, value: object) -> None:
    _L1[key] = (time.time() + _L1_TTL, value)
    # Bound memory: drop oldest when large.
    if len(_L1) > 2000:
        oldest = min(_L1, key=lambda k: _L1[k][0])
        _L1.pop(oldest, None)


def _encode(value: object) -> bytes:
    raw = json.dumps(value, separators=(",", ":")).encode()
    if len(raw) > _GZIP_THRESHOLD:
        return b"\x01" + gzip.compress(raw)
    return b"\x00" + raw


def _decode(blob: bytes) -> object:
    if blob[:1] == b"\x01":
        return json.loads(gzip.decompress(blob[1:]).decode())
    payload = blob[1:] if blob[:1] == b"\x00" else blob
    return json.loads(payload.decode())


def get_json(key: str):
    """Return cached value or None on miss/error. Never raises."""
    l1 = _l1_get(key)
    if l1 is not None:
        return l1
    if _circuit_open():
        return None
    try:
        blob = _get_redis().get(key)
    except Exception as e:
        logger.warning("cache get %s failed, falling back to DB: %s", key, e)
        _trip_circuit()
        return None
    if blob is None:
        return None
    try:
        value = _decode(blob)
    except Exception as e:
        logger.warning("cache decode %s failed: %s", key, e)
        return None
    _l1_set(key, value)
    return value


def set_json(key: str, value: object, ttl: int) -> None:
    """Best-effort store. Never raises."""
    _l1_set(key, value)
    if _circuit_open():
        return
    try:
        _get_redis().setex(key, ttl, _encode(value))
    except Exception as e:
        logger.warning("cache set %s failed (DB remains source of truth): %s", key, e)
        _trip_circuit()


def del_prefix(prefix: str, count_limit: int = 500) -> int:
    """Delete keys starting with prefix. Best-effort, returns deleted count."""
    for k in [k for k in _L1 if k.startswith(prefix)]:
        _L1.pop(k, None)
    if _circuit_open():
        return 0
    try:
        r = _get_redis()
        deleted = 0
        for k in r.scan_iter(match=f"{prefix}*", count=200):
            r.delete(k)
            deleted += 1
            if deleted >= count_limit:
                break
        return deleted
    except Exception as e:
        logger.warning("cache del %s* failed: %s", prefix, e)
        _trip_circuit()
        return 0


# Key convention (so invalidation is scoped, not global):
#   v1:dash:{group_hash}:summary:{month}:{person}:{cat}:{bank}:{group_by}
#   v1:cards:{group_hash}:distinct | v1:cards:{group_hash}:options
#   v1:uncat:{user_id} | v1:aitrends:{user_id}:{month} | v1:prices:{ticker}
def dash_summary_key(
    gh: str,
    month: str | None,
    person: str | None,
    cat: int | None,
    bank: str | None,
    group_by: str,
) -> str:
    return f"v1:dash:{gh}:summary:{month or 'all'}:{person or '-'}:{cat or '-'}:{bank or '-'}:{group_by}"


def invalidate_group(group_hash_value: str) -> None:
    """Invalidate group-scoped dashboard/card keys. Best-effort."""
    del_prefix(f"v1:dash:{group_hash_value}")
    del_prefix(f"v1:cards:{group_hash_value}")
