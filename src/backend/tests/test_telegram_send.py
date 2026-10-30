"""Outbound messages must leave through the Bot API when no bot thread runs.

Production keeps the bot in its own container and sets
TELEGRAM_BOT_ENABLED=false on the backend, so the in-process bot is absent
there. Without the HTTP fallback every Telegram notification from a script or
a Celery task would be dropped with only a warning in the log.
"""

import os
from unittest.mock import MagicMock, patch

os.environ.setdefault("SECRET_KEY", "test-secret-key-that-is-at-least-32-chars-long-for-testing")


def _response(status_code: int) -> MagicMock:
    response = MagicMock()
    response.status_code = status_code
    return response


def test_send_message_falls_back_to_the_bot_api(monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "test-token")
    client = MagicMock()
    client.__enter__.return_value.post.return_value = _response(200)

    with patch("app.telegram_bot._bot_app", None), patch("httpx.Client", return_value=client):
        from app.telegram_bot import send_message_to_chat

        assert send_message_to_chat("123456", "¡Novedades!") is True

    client.__enter__.return_value.post.assert_called_once()


def test_send_message_reports_an_api_error(monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "test-token")
    client = MagicMock()
    client.__enter__.return_value.post.return_value = _response(400)

    with patch("app.telegram_bot._bot_app", None), patch("httpx.Client", return_value=client):
        from app.telegram_bot import send_message_to_chat

        assert send_message_to_chat("123456", "¡Novedades!") is False


def test_send_message_without_a_token_does_not_call_the_api(monkeypatch):
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)

    with patch("app.telegram_bot._bot_app", None), patch("httpx.Client") as client:
        from app.telegram_bot import send_message_to_chat

        assert send_message_to_chat("123456", "¡Novedades!") is False

    client.assert_not_called()
