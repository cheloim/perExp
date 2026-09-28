"""Shared service-layer helpers."""

from sqlalchemy.orm import Session


def get_setting(db: Session, key: str, user_id: int) -> str | None:
    """Get effective setting value: global override first, then per-user, then None."""
    from app.models import Setting

    # Check global override (admin feature flag)
    global_override = db.query(Setting).filter(Setting.key == f"flag:{key}").first()
    if global_override and global_override.value:
        return "true" if global_override.value == "on" else "false"
    # Fall back to per-user setting
    row = db.query(Setting).filter(Setting.key == f"{user_id}:{key}").first()
    return row.value if row else None
