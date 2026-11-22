"""Investment settings storage, encryption and broker credentials.

Settings are scoped per user (``"{user_id}:{key}"`` in the ``settings`` table).
Sensitive values are encrypted at rest; callers always see plaintext.
"""

from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import Setting
from app.services.access import scoped_user_ids_for
from app.services.encryption import decrypt_value, encrypt_value

# Sensitive setting keys that should be encrypted at rest
SENSITIVE_KEYS = {"iol_password", "ppi_api_key", "ppi_api_secret"}

# Credential keys per broker, in deletion order.
BROKER_KEYS = {
    "iol": ["iol_username", "iol_password"],
    "ppi": ["ppi_api_key", "ppi_api_secret"],
}

DENY_SETTINGS_VIEW = "No tenés acceso a la configuración de otro usuario"
DENY_SETTINGS_WRITE = "No tenés acceso para modificar configuración de otro usuario"


def _scoped_key(key: str, user_id: int | None) -> str:
    return f"{user_id}:{key}" if user_id is not None else key


def get_setting(db: Session, key: str, user_id: int | None = None) -> str:
    """Return a decrypted setting value, or ``""`` when it does not exist."""
    row = db.query(Setting).filter(Setting.key == _scoped_key(key, user_id)).first()
    if not row:
        return ""
    # Decrypt sensitive values
    if key in SENSITIVE_KEYS:
        return decrypt_value(row.value)
    return row.value


def set_setting(db: Session, key: str, value: str, user_id: int | None = None) -> None:
    """Create or update a setting, encrypting sensitive values before storage."""
    scoped_key = _scoped_key(key, user_id)
    stored_value = encrypt_value(value) if key in SENSITIVE_KEYS else value
    row = db.query(Setting).filter(Setting.key == scoped_key).first()
    if row:
        row.value = stored_value
    else:
        db.add(Setting(key=scoped_key, value=stored_value))
    db.commit()


def get_user_creds(db: Session, user_id: int) -> dict:
    """Return broker credentials for a user from the DB settings table."""
    keys = ("iol_username", "iol_password", "ppi_api_key", "ppi_api_secret")
    return {k: get_setting(db, k, user_id=user_id) for k in keys}


def resolve_target_user_id(
    db: Session,
    current_user_id: int,
    user_id: int | None,
    *,
    deny_message: str,
) -> int:
    """Resolve the settings owner, allowing access to accepted group members."""
    target_user_id = user_id if user_id else current_user_id
    if (
        user_id
        and user_id != current_user_id
        and user_id not in scoped_user_ids_for(current_user_id, db)
    ):
        raise HTTPException(403, deny_message)
    return target_user_id


def load_user_settings(db: Session, user_id: int) -> dict:
    """Load every setting for a user, decrypting sensitive keys."""
    prefix = f"{user_id}:"
    rows = db.query(Setting).filter(Setting.key.like(f"{prefix}%")).all()
    result: dict = {}
    for row in rows:
        key = row.key[len(prefix) :]
        if key in SENSITIVE_KEYS:
            result[key] = decrypt_value(row.value)
        else:
            result[key] = row.value
    creds = get_user_creds(db, user_id)
    result["iol_configured"] = bool(creds["iol_username"] and creds["iol_password"])
    result["ppi_configured"] = bool(creds["ppi_api_key"] and creds["ppi_api_secret"])
    return result


def delete_setting(db: Session, user_id: int, key: str) -> bool:
    """Delete a single scoped setting and commit. Returns whether a row existed."""
    deleted = db.query(Setting).filter(Setting.key == _scoped_key(key, user_id)).delete()
    db.commit()
    return deleted > 0


def setting_keys_for_broker(broker: str) -> list[str]:
    """Return the credential keys for a broker, rejecting unknown brokers."""
    if broker not in BROKER_KEYS:
        raise HTTPException(400, f"Broker desconocido: {broker}")
    return BROKER_KEYS[broker]


def delete_settings_for_broker(db: Session, user_id: int, broker: str) -> int:
    """Delete a broker's credential rows without committing.

    The caller owns the transaction because broker deletion also removes
    investment rows.
    """
    deleted_count = 0
    for key in setting_keys_for_broker(broker):
        deleted_count += db.query(Setting).filter(Setting.key == _scoped_key(key, user_id)).delete()
    return deleted_count
