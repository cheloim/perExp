"""Tests for app.services.cache — fallback to DB (source of truth)."""

import os

os.environ["SECRET_KEY"] = "test-secret-key-that-is-at-least-32-chars-long-for-testing"

from unittest.mock import MagicMock, patch

from app.services import cache


def _reset():
    cache._L1.clear()
    cache._circuit_open_until = 0.0
    cache._redis_client = None


def test_group_hash_order_independent():
    _reset()
    assert cache.group_hash([3, 1, 2]) == cache.group_hash([1, 2, 3])
    assert cache.group_hash([1, 2]) != cache.group_hash([1, 3])


def test_get_miss_returns_none():
    _reset()
    fake = MagicMock()
    fake.get.return_value = None
    with patch.object(cache, "_get_redis", return_value=fake):
        assert cache.get_json("v1:missing") is None


def test_set_then_get_hit():
    _reset()
    store = {}

    class FakeRedis:
        def get(self, k):
            return store.get(k)

        def setex(self, k, ttl, v):
            store[k] = v

    with patch.object(cache, "_get_redis", return_value=FakeRedis()):
        cache.set_json("v1:dash:abc:summary:all:-:-:-:month", {"total": 5}, ttl=90)
        # Clear L1 to prove Redis hit, not just L1
        cache._L1.clear()
        assert cache.get_json("v1:dash:abc:summary:all:-:-:-:month") == {"total": 5}


def test_redis_down_get_falls_back_to_none_and_set_does_not_raise():
    _reset()
    broken = MagicMock()
    broken.get.side_effect = ConnectionError("down")
    broken.setex.side_effect = ConnectionError("down")
    with patch.object(cache, "_get_redis", return_value=broken):
        assert cache.get_json("v1:dash:x") is None  # caller goes to DB
        cache.set_json("v1:dash:x", {"a": 1}, ttl=60)  # must not raise
        # Circuit open: second get short-circuits without touching redis
        broken.get.reset_mock()
        assert cache.get_json("v1:dash:y") is None
        broken.get.assert_not_called()


def test_del_prefix_scoped():
    _reset()
    store = {}

    class FakeRedis:
        def scan_iter(self, match, count=200):
            import fnmatch

            return [k.encode() for k in store if fnmatch.fnmatch(k, match)]

        def delete(self, k):
            k = k.decode() if isinstance(k, bytes) else k
            store.pop(k, None)

        def setex(self, k, ttl, v):
            store[k] = v

    fr = FakeRedis()
    with patch.object(cache, "_get_redis", return_value=fr):
        cache.set_json("v1:dash:AAA:summary:all:-:-:-:month", {"a": 1}, ttl=60)
        cache.set_json("v1:dash:BBB:summary:all:-:-:-:month", {"b": 2}, ttl=60)
        cache._L1.clear()
        n = cache.del_prefix("v1:dash:AAA")
        assert n >= 1
        assert "v1:dash:AAA:summary:all:-:-:-:month" not in store
        assert "v1:dash:BBB:summary:all:-:-:-:month" in store
