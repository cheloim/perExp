"""Shared notification service for recurring/expense alerts.

Resolves per-user channel preference (inapp/telegram/both), writes an
in-app Notification, and optionally sends to Telegram via the bot.
"""

import json
import logging
from typing import Any

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


def _resolve_channel(user_id: int, db: Session) -> str:
    """Resolve the notification channel for a user.

    Priority: user-level setting > global flag > default 'both'.
    Returns: 'both' | 'inapp' | 'telegram' | 'none'.
    """
    from app.models import Setting

    # Global off switch
    global_setting = db.query(Setting).filter(Setting.key == "flag:notify_enabled").first()
    if global_setting and global_setting.value.lower() in ("false", "0", "no", "off"):
        return "none"

    # Per-user channel preference
    user_setting = db.query(Setting).filter(Setting.key == f"{user_id}:notify_channel").first()
    if user_setting and user_setting.value.lower() in ("inapp", "telegram", "both", "none"):
        return user_setting.value.lower()

    # Global channel default
    global_channel = db.query(Setting).filter(Setting.key == "flag:notify_channel").first()
    if global_channel and global_channel.value.lower() in ("inapp", "telegram", "both", "none"):
        return global_channel.value.lower()

    return "both"


def _send_telegram(user, text: str) -> None:
    """Send a Telegram message to a user. Catches all errors."""
    if not user.telegram_chat_id or user.telegram_chat_id == "[encrypted]":
        return
    try:
        from app.telegram_bot import send_message_to_chat

        send_message_to_chat(user.telegram_chat_id, text)
    except Exception as e:
        logger.warning(f"[NOTIFY] Failed to send Telegram to user {user.id}: {e}")


def notify_user(
    db: Session,
    user_id: int,
    ntype: str,
    title: str,
    body: str,
    data: dict[str, Any] | None = None,
) -> str:
    """Send a notification to a user via the configured channel.

    Args:
        db: Active database session
        user_id: Target user ID
        ntype: Notification type (e.g. 'upcoming_recurring', 'upcoming_installment')
        title: Short title (used for in-app and Telegram)
        body: Full body text
        data: Optional JSON-serializable dict for structured data

    Returns:
        Channel(s) used: 'inapp' | 'telegram' | 'both' | 'none'
    """
    from app.models import Notification, User

    channel = _resolve_channel(user_id, db)
    if channel == "none":
        return "none"

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        return "none"

    sent_inapp = False
    sent_telegram = False

    # In-app notification
    if channel in ("inapp", "both"):
        notification = Notification(
            user_id=user_id,
            type=ntype,
            title=title,
            body=body,
            data=json.dumps(data or {}, ensure_ascii=False),
            read=False,
        )
        db.add(notification)
        sent_inapp = True

    # Telegram
    if (
        channel in ("telegram", "both")
        and user.telegram_chat_id
        and user.telegram_chat_id != "[encrypted]"
    ):
        _send_telegram(user, f"{title}\n\n{body}")
        sent_telegram = True

    if sent_inapp and sent_telegram:
        return "both"
    if sent_inapp:
        return "inapp"
    if sent_telegram:
        return "telegram"
    return "none"
