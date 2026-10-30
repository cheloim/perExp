"""The release announcement rides the notification channel each user chose."""

import json
from unittest.mock import patch

import pytest


def _make_user(db, email, telegram_chat_id):
    from app.models import User
    from app.services.auth import get_password_hash
    from app.services.encryption import compute_hmac

    user = User(
        email=email,
        full_name="Release User",
        hashed_password=get_password_hash("testpassword"),
        email_verified=True,
        telegram_chat_id=telegram_chat_id,
    )
    if telegram_chat_id:
        user.telegram_chat_hash = compute_hmac(telegram_chat_id)
    db.add(user)
    db.flush()
    return user


class TestAnnounceRelease:
    def test_sends_once_to_every_linked_user(self, db):
        from app.models import Notification
        from app.services.whats_new import already_announced, announce_release

        user = _make_user(db, "release@test.com", "555000111")

        with patch("app.services.notify._send_telegram") as send_telegram:
            result = announce_release(db, "v1.6", frontend_url="https://example.test")

        assert result["sent"] == 1
        assert result["skipped"] == 0
        send_telegram.assert_called_once()

        notification = db.query(Notification).filter(Notification.user_id == user.id).one()
        assert notification.type == "whats_new"
        assert json.loads(notification.data)["version"] == "v1.6"
        assert json.loads(notification.data)["path"] == "/changes/v1.6"
        assert already_announced(db, "v1.6")

    def test_rerunning_the_same_version_is_a_noop(self, db):
        from app.models import Notification
        from app.services.whats_new import announce_release

        _make_user(db, "release2@test.com", "555000222")

        with patch("app.services.notify._send_telegram"):
            announce_release(db, "v1.6", frontend_url="https://example.test")
            again = announce_release(db, "v1.6", frontend_url="https://example.test")

        assert again["already_announced"] is True
        assert again["sent"] == 0
        assert db.query(Notification).count() == 1

    def test_dry_run_counts_recipients_without_writing(self, db):
        from app.models import Notification
        from app.services.whats_new import already_announced, announce_release

        _make_user(db, "release3@test.com", "555000333")

        with patch("app.services.notify._send_telegram") as send_telegram:
            result = announce_release(db, "v1.6", dry_run=True)

        assert result["dry_run"] is True
        assert result["recipients"] == 1
        assert result["sent"] == 1
        send_telegram.assert_not_called()
        assert db.query(Notification).count() == 0
        assert not already_announced(db, "v1.6")

    def test_users_without_telegram_are_not_targeted(self, db):
        from app.models import Notification
        from app.services.whats_new import announce_release

        _make_user(db, "release4@test.com", None)

        with patch("app.services.notify._send_telegram") as send_telegram:
            result = announce_release(db, "v1.6")

        assert result["recipients"] == 0
        send_telegram.assert_not_called()
        assert db.query(Notification).count() == 0

    def test_unknown_version_is_rejected(self, db):
        from app.services.whats_new import announce_release

        with pytest.raises(ValueError):
            announce_release(db, "v9.9")


class TestAnnouncementBody:
    def test_lists_the_highlights_and_the_link(self):
        from app.services.whats_new import build_announcement_body

        body = build_announcement_body(
            ["Captura por voz", "Asistente renovado"],
            "https://example.test/changes/v1.6",
        )

        assert "• Captura por voz" in body
        assert "• Asistente renovado" in body
        assert body.rstrip().endswith("https://example.test/changes/v1.6")
