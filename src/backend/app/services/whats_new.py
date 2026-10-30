"""Announce a published release through the user's notification channel.

A release announcement is content, not a new delivery mechanism: it goes
through ``notify_user`` so it obeys the same channel preference and the same
global off switch as every other notification. The version is recorded in
``settings`` so re-running the script is a no-op instead of a second round of
messages.
"""

import os
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.orm import Session

from app.models import Setting, User
from app.services.notify import notify_user

SETTING_PREFIX = "whats_new_broadcast"
DEFAULT_FRONTEND_URL = "https://platform.oikonomia.ar"

# The copy lives with the release it announces. Add an entry here only when the
# matching version exists in the frontend changelog.
RELEASES: dict[str, dict[str, Any]] = {
    "v1.6": {
        "title": "✨ Novedades de Oikonomia v1.6",
        "path": "/changes/v1.6",
        "highlights": [
            "Capturá gastos por voz o escaneando un comprobante.",
            "Asistente renovado: ventana de 3/6/12 meses y un solo hilo.",
            "Notificaciones en la barra lateral, con el texto completo.",
            "Gastos: búsqueda, selección masiva y edición rápida.",
            "Presupuesto y Dashboard rediseñados.",
            "Mini App con paridad visual y mejor accesibilidad.",
        ],
    },
}


def setting_key(version: str) -> str:
    """The settings row that records a completed broadcast."""
    return f"{SETTING_PREFIX}:{version}"


def already_announced(db: Session, version: str) -> bool:
    """Whether this version was already broadcast."""
    return db.query(Setting).filter(Setting.key == setting_key(version)).first() is not None


def build_announcement_body(highlights: list[str], url: str) -> str:
    """Plain-text body shared by the in-app row and the Telegram message.

    Plain text keeps the in-app notification readable; Telegram still turns the
    bare URL into a link.
    """
    bullets = "\n".join(f"• {highlight}" for highlight in highlights)
    return f"{bullets}\n\n{url}"


def _release_url(path: str, frontend_url: str | None) -> str:
    base = (frontend_url or os.getenv("FRONTEND_URL") or DEFAULT_FRONTEND_URL).rstrip("/")
    return f"{base}{path}"


def announce_release(
    db: Session,
    version: str,
    frontend_url: str | None = None,
    dry_run: bool = False,
    force: bool = False,
) -> dict[str, Any]:
    """Send the release announcement to every Telegram-linked active user.

    Returns a summary with the number of recipients and the channel each one
    used. ``dry_run`` counts recipients and writes nothing; it cannot know a
    user's channel without touching notification state, so ``sent`` is the
    number of users that would be notified.
    """
    release = RELEASES.get(version)
    if release is None:
        raise ValueError(f"Unknown release {version!r}; known: {', '.join(RELEASES)}")

    if not force and already_announced(db, version):
        return {
            "version": version,
            "already_announced": True,
            "dry_run": dry_run,
            "recipients": 0,
            "sent": 0,
            "skipped": 0,
            "channels": {},
        }

    users = (
        db.query(User).filter(User.is_active.is_(True), User.telegram_chat_hash.isnot(None)).all()
    )
    url = _release_url(release["path"], frontend_url)
    body = build_announcement_body(release["highlights"], url)

    if dry_run:
        return {
            "version": version,
            "already_announced": False,
            "dry_run": True,
            "recipients": len(users),
            "sent": len(users),
            "skipped": 0,
            "channels": {},
            "url": url,
        }

    channels: dict[str, int] = {}
    sent = 0
    skipped = 0
    for user in users:
        channel = notify_user(
            db,
            user.id,
            "whats_new",
            release["title"],
            body,
            {"version": version, "path": release["path"]},
        )
        channels[channel] = channels.get(channel, 0) + 1
        if channel == "none":
            skipped += 1
        else:
            sent += 1

    setting = db.query(Setting).filter(Setting.key == setting_key(version)).first()
    timestamp = datetime.now(UTC).isoformat()
    if setting is None:
        db.add(Setting(key=setting_key(version), value=timestamp))
    else:
        setting.value = timestamp
    db.commit()

    return {
        "version": version,
        "already_announced": False,
        "dry_run": False,
        "recipients": len(users),
        "sent": sent,
        "skipped": skipped,
        "channels": channels,
        "url": url,
    }
