"""
Migration: Encrypt existing plaintext sensitive investment settings.
Run once: python -m scripts.migrate_encrypt_settings
"""

import hashlib
import os
import sys
from datetime import datetime

from app.database import SessionLocal
from app.models import Setting

_log = lambda msg: print(f"{datetime.now().isoformat()} {msg}")

SENSITIVE_KEYS = {"iol_password", "ppi_api_key", "ppi_api_secret"}


def _get_encryptor():
    from cryptography.fernet import Fernet

    secret = os.getenv("SECRET_KEY", "fallback-dev-key-change-in-prod")
    key = hashlib.sha256(secret.encode()).digest()
    fernet_key = __import__("base64").urlsafe_b64encode(key)
    return Fernet(fernet_key)


def _is_already_encrypted(value: str) -> bool:
    """Check if a value is already Fernet-encrypted (starts with gAAAAA)."""
    return value.startswith("gAAAAA")


def migrate():
    db = SessionLocal()
    try:
        fernet = _get_encryptor()
        encrypted_count = 0
        skipped_count = 0

        for key_suffix in SENSITIVE_KEYS:
            # Find all settings with this key suffix
            rows = (
                db.query(Setting)
                .filter(Setting.key.like(f"%:{key_suffix}"))
                .all()
            )

            for row in rows:
                if not row.value or _is_already_encrypted(row.value):
                    skipped_count += 1
                    continue

                # Encrypt the plaintext value
                encrypted_value = fernet.encrypt(row.value.encode()).decode()
                row.value = encrypted_value
                encrypted_count += 1
                _log(f"  Encrypted: {row.key}")

        db.commit()
        _log(f"Migration complete: {encrypted_count} values encrypted, {skipped_count} skipped")

    except Exception as e:
        db.rollback()
        _log(f"Migration failed: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    _log("Starting encryption migration...")
    migrate()
