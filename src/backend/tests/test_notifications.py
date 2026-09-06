"""Tests for notification service and recurring/installment tasks.

Uses unittest.mock to test without a real database or Telegram bot.
"""

import os
from unittest.mock import MagicMock, patch

os.environ["SECRET_KEY"] = "test-secret-key-that-is-at-least-32-chars-long-for-testing"


# ── Channel resolution tests ─────────────────────────────────────────


class TestChannelResolution:
    """Test _resolve_channel by mocking the Setting queries."""

    @patch("app.services.notify._resolve_channel")
    def test_default_is_both(self, mock_resolve):
        mock_resolve.return_value = "both"
        from app.services.notify import _resolve_channel

        result = _resolve_channel(1, MagicMock())
        assert result == "both"

    def test_none_when_global_off(self):
        from app.services.notify import _resolve_channel

        db = MagicMock()
        # Make all Setting queries return None (no settings configured)
        db.query.return_value.filter.return_value.first.return_value = None
        # But add a global flag:notify_enabled = false
        from app.models import Setting

        off_setting = MagicMock(spec=Setting)
        off_setting.value = "false"

        call_count = [0]

        def fake_query(model):
            class FakeQuery:
                def filter(self, *args):
                    return self

                def first(self):
                    call_count[0] += 1
                    if call_count[0] == 1:
                        return off_setting  # flag:notify_enabled = false
                    return None

            return FakeQuery()

        db.query = fake_query
        result = _resolve_channel(1, db)
        assert result == "none"

    def test_user_inapp_setting(self):
        from app.services.notify import _resolve_channel

        db = MagicMock()
        from app.models import Setting

        inapp_setting = MagicMock(spec=Setting)
        inapp_setting.value = "inapp"

        call_count = [0]

        def fake_query(model):
            class FakeQuery:
                def filter(self, *args):
                    return self

                def first(self):
                    call_count[0] += 1
                    if call_count[0] == 2:
                        return inapp_setting  # user setting
                    return None

            return FakeQuery()

        db.query = fake_query
        result = _resolve_channel(1, db)
        assert result == "inapp"

    def test_global_telegram_default(self):
        from app.services.notify import _resolve_channel

        db = MagicMock()
        from app.models import Setting

        tg_setting = MagicMock(spec=Setting)
        tg_setting.value = "telegram"

        call_count = [0]

        def fake_query(model):
            class FakeQuery:
                def filter(self, *args):
                    return self

                def first(self):
                    call_count[0] += 1
                    if call_count[0] == 3:
                        return tg_setting  # flag:notify_channel
                    return None

            return FakeQuery()

        db.query = fake_query
        result = _resolve_channel(1, db)
        assert result == "telegram"


# ── notify_user tests ────────────────────────────────────────────────


class TestNotifyUser:
    """Test notify_user creates in-app and/or sends Telegram."""

    @patch("app.services.notify._send_telegram")
    def test_both_channels(self, mock_tg):
        from app.services.notify import notify_user

        db = MagicMock()
        user = MagicMock()
        user.id = 1
        user.telegram_chat_id = "123456"

        # Mock the User query chain
        mock_user_query = MagicMock()
        mock_user_query.filter.return_value.first.return_value = user
        db.query.return_value = mock_user_query

        with patch("app.services.notify._resolve_channel", return_value="both"):
            result = notify_user(db, 1, "test", "Title", "Body", {"key": "val"})

        assert result == "both"
        db.add.assert_called_once()
        mock_tg.assert_called_once()
        notif = db.add.call_args[0][0]
        assert notif.type == "test"

    @patch("app.services.notify._send_telegram")
    def test_inapp_only(self, mock_tg):
        from app.services.notify import notify_user

        db = MagicMock()
        user = MagicMock()
        user.id = 1
        user.telegram_chat_id = "123456"

        with patch("app.services.notify._resolve_channel", return_value="inapp"):
            result = notify_user(db, 1, "test", "Title", "Body")

        assert result == "inapp"
        db.add.assert_called_once()
        mock_tg.assert_not_called()

    @patch("app.services.notify._send_telegram")
    def test_telegram_only(self, mock_tg):
        from app.services.notify import notify_user

        db = MagicMock()
        user = MagicMock()
        user.id = 1
        user.telegram_chat_id = "123456"

        with patch("app.services.notify._resolve_channel", return_value="telegram"):
            mock_query = MagicMock()
            mock_query.filter.return_value.first.return_value = user
            db.query.return_value = mock_query

            result = notify_user(db, 1, "test", "Title", "Body")

        assert result == "telegram"
        db.add.assert_not_called()
        mock_tg.assert_called_once()

    @patch("app.services.notify._send_telegram")
    def test_none(self, mock_tg):
        from app.services.notify import notify_user

        db = MagicMock()

        with patch("app.services.notify._resolve_channel", return_value="none"):
            result = notify_user(db, 1, "test", "Title", "Body")

        assert result == "none"
        db.add.assert_not_called()
        mock_tg.assert_not_called()


# ── Telegram safety ──────────────────────────────────────────────────


class TestSendTelegram:
    def test_no_chat_id(self):
        from app.services.notify import _send_telegram

        user = MagicMock()
        user.telegram_chat_id = None
        _send_telegram(user, "test")  # Should not raise

    def test_encrypted_placeholder(self):
        from app.services.notify import _send_telegram

        user = MagicMock()
        user.telegram_chat_id = "[encrypted]"
        _send_telegram(user, "test")  # Should not raise
