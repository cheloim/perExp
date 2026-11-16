"""Task locks and WhatsApp webhook idempotency (#529)."""

import hashlib
import hmac

import pytest

from app.routers import whatsapp_webhook
from app.services import task_lock


class FakeRedis:
    def __init__(self):
        self.values: dict[str, str] = {}

    def set(self, key, value, nx=False, ex=None):
        if nx and key in self.values:
            return None
        self.values[key] = value
        return True

    def eval(self, script, numkeys, key, token):
        if self.values.get(key) == token:
            del self.values[key]
            return 1
        return 0


def test_task_lock_acquires_and_releases(monkeypatch):
    fake = FakeRedis()
    monkeypatch.setattr(task_lock, "_get_redis", lambda: fake)

    with task_lock.task_lock("daily") as acquired:
        assert acquired is True
        assert "task_lock:daily" in fake.values

    assert "task_lock:daily" not in fake.values


def test_task_lock_skips_when_another_worker_holds_it(monkeypatch):
    fake = FakeRedis()
    monkeypatch.setattr(task_lock, "_get_redis", lambda: fake)

    with (
        task_lock.task_lock("daily") as first,
        task_lock.task_lock("daily") as second,
    ):
        assert first is True
        assert second is False


def test_task_lock_fails_open_without_redis(monkeypatch):
    def down():
        raise ConnectionError("redis down")

    monkeypatch.setattr(task_lock, "_get_redis", down)

    with task_lock.task_lock("daily") as acquired:
        assert acquired is True


def test_whatsapp_message_id_is_claimed_once(monkeypatch):
    fake = FakeRedis()
    monkeypatch.setattr("app.services.rate_limit._get_redis", lambda: fake)

    assert whatsapp_webhook._claim_message_id("wamid-1") is True
    assert whatsapp_webhook._claim_message_id("wamid-1") is False


def test_whatsapp_signature_is_required_in_production(monkeypatch):
    monkeypatch.setattr(whatsapp_webhook, "APP_ENV", "production")
    monkeypatch.setattr(whatsapp_webhook, "APP_SECRET", "")

    assert whatsapp_webhook._verify_webhook_signature(b"{}", None) is False


def test_whatsapp_signature_accepts_a_valid_hmac(monkeypatch):
    secret = "meta-secret"
    monkeypatch.setattr(whatsapp_webhook, "APP_ENV", "production")
    monkeypatch.setattr(whatsapp_webhook, "APP_SECRET", secret)
    body = b'{"object":"whatsapp_business_account"}'
    signature = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()

    assert whatsapp_webhook._verify_webhook_signature(body, signature) is True
    assert whatsapp_webhook._verify_webhook_signature(body, "sha256=bad") is False


def test_whatsapp_dev_mode_without_secret_still_accepts(monkeypatch):
    monkeypatch.setattr(whatsapp_webhook, "APP_ENV", "development")
    monkeypatch.setattr(whatsapp_webhook, "APP_SECRET", "")

    assert whatsapp_webhook._verify_webhook_signature(b"{}", None) is True


if __name__ == "__main__":
    pytest.main([__file__, "-q"])
