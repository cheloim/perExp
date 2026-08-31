"""Unit tests for Telegram SSO HMAC validation."""

import hashlib
import hmac
import os
import time
import unittest
import urllib.parse

os.environ["SECRET_KEY"] = "test-secret-key-that-is-at-least-32-chars-long-for-testing"
os.environ["TELEGRAM_BOT_TOKEN"] = "test-bot-token:1234567890"

from app.services.auth import verify_telegram_login_widget, verify_telegram_webapp


BOT_TOKEN = "test-bot-token:1234567890"


def _build_init_data(user_id: int = 123456, auth_date: int | None = None) -> str:
    """Build a valid Telegram Mini App initData string."""
    if auth_date is None:
        auth_date = int(time.time())

    user_json = str(
        {
            "id": user_id,
            "first_name": "Test",
            "username": "testuser",
        }
    ).replace("'", '"')

    pairs = {"user": user_json, "auth_date": str(auth_date), "query_id": "abc123"}
    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(pairs.items()))

    secret_key = hmac.new(
        "WebAppData".encode(), BOT_TOKEN.encode(), hashlib.sha256
    ).digest()
    computed_hash = hmac.new(
        secret_key, data_check_string.encode(), hashlib.sha256
    ).hexdigest()

    pairs["hash"] = computed_hash
    return urllib.parse.urlencode(pairs)


def _build_widget_data(user_id: int = 123456, auth_date: int | None = None) -> dict:
    """Build valid Telegram Login Widget data."""
    if auth_date is None:
        auth_date = int(time.time())

    data = {
        "id": user_id,
        "first_name": "Test",
        "auth_date": str(auth_date),
    }

    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(data.items()))
    secret = hashlib.sha256(BOT_TOKEN.encode()).digest()
    data["hash"] = hmac.new(secret, data_check_string.encode(), hashlib.sha256).hexdigest()
    return data


class TestVerifyTelegramWebApp(unittest.TestCase):
    def test_valid_init_data(self):
        """Valid initData returns parsed user dict."""
        init_data = _build_init_data(user_id=42)
        result = verify_telegram_webapp(init_data)
        self.assertIsNotNone(result)
        self.assertEqual(result["id"], 42)
        self.assertEqual(result["first_name"], "Test")

    def test_tampered_hash(self):
        """Tampered hash returns None."""
        init_data = _build_init_data()
        # Replace hash with garbage
        init_data = init_data.replace("hash=", "hash=badhash")
        result = verify_telegram_webapp(init_data)
        self.assertIsNone(result)

    def test_expired_auth_date(self):
        """Old auth_date returns None."""
        old_date = int(time.time()) - 600  # 10 minutes ago, max_age=300
        init_data = _build_init_data(auth_date=old_date)
        result = verify_telegram_webapp(init_data)
        self.assertIsNone(result)

    def test_missing_hash(self):
        """Missing hash returns None."""
        result = verify_telegram_webapp("user=%7B%7D&auth_date=123")
        self.assertIsNone(result)

    def test_missing_user(self):
        """Missing user in initData returns None."""
        auth_date = int(time.time())
        pairs = {"auth_date": str(auth_date)}
        data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(pairs.items()))
        secret_key = hmac.new(
            "WebAppData".encode(), BOT_TOKEN.encode(), hashlib.sha256
        ).digest()
        computed_hash = hmac.new(
            secret_key, data_check_string.encode(), hashlib.sha256
        ).hexdigest()
        pairs["hash"] = computed_hash
        init_data = urllib.parse.urlencode(pairs)
        result = verify_telegram_webapp(init_data)
        self.assertIsNone(result)

    def test_empty_init_data(self):
        """Empty string returns None."""
        self.assertIsNone(verify_telegram_webapp(""))

    def test_different_bot_token(self):
        """initData signed with a different token fails."""
        other_token = "other-bot-token:999999"
        auth_date = int(time.time())
        user_json = '{"id": 42, "first_name": "Test"}'
        pairs = {"user": user_json, "auth_date": str(auth_date)}
        data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(pairs.items()))
        # Sign with wrong token
        secret_key = hmac.new(
            "WebAppData".encode(), other_token.encode(), hashlib.sha256
        ).digest()
        computed_hash = hmac.new(
            secret_key, data_check_string.encode(), hashlib.sha256
        ).hexdigest()
        pairs["hash"] = computed_hash
        init_data = urllib.parse.urlencode(pairs)
        result = verify_telegram_webapp(init_data)
        self.assertIsNone(result)


class TestVerifyTelegramLoginWidget(unittest.TestCase):
    def test_valid_widget_data(self):
        """Valid widget data returns user dict."""
        data = _build_widget_data(user_id=42)
        result = verify_telegram_login_widget(data)
        self.assertIsNotNone(result)
        self.assertEqual(result["id"], 42)

    def test_tampered_hash(self):
        """Tampered hash returns None."""
        data = _build_widget_data()
        data["hash"] = "tampered"
        result = verify_telegram_login_widget(data)
        self.assertIsNone(result)

    def test_expired_auth_date(self):
        """Old auth_date returns None."""
        old_date = int(time.time()) - 600
        data = _build_widget_data(auth_date=old_date)
        result = verify_telegram_login_widget(data)
        self.assertIsNone(result)

    def test_missing_fields(self):
        """Missing hash returns None."""
        result = verify_telegram_login_widget({"id": 42, "first_name": "Test"})
        self.assertIsNone(result)

    def test_empty_data(self):
        """Empty dict returns None."""
        self.assertIsNone(verify_telegram_login_widget({}))


if __name__ == "__main__":
    unittest.main()
