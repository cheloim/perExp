"""Migration: Add WhatsApp columns to users table.

Adds:
- whatsapp_phone (encrypted)
- whatsapp_phone_hash (indexed, unique)
- whatsapp_key (indexed, unique)

Idempotent — safe to run multiple times.
"""

import logging
import sys

from sqlalchemy import inspect, text

# Add backend to path
sys.path.insert(0, "/app" if __import__("os").path.exists("/app") else ".")

from app.database import SessionLocal, engine
from app.models import User  # noqa: F401 — ensures model is registered

logger = logging.getLogger(__name__)


def migrate():
    """Add WhatsApp columns to users table if they don't exist."""
    inspector = inspect(engine)
    columns = {col["name"] for col in inspector.get_columns("users")}

    db = SessionLocal()
    try:
        # Add whatsapp_phone column
        if "whatsapp_phone" not in columns:
            logger.info("[MIGRATE] Adding whatsapp_phone column")
            db.execute(text("ALTER TABLE users ADD COLUMN whatsapp_phone VARCHAR"))
            db.commit()
        else:
            logger.info("[MIGRATE] whatsapp_phone column already exists")

        # Add whatsapp_phone_hash column
        if "whatsapp_phone_hash" not in columns:
            logger.info("[MIGRATE] Adding whatsapp_phone_hash column")
            db.execute(text("ALTER TABLE users ADD COLUMN whatsapp_phone_hash VARCHAR(64)"))
            db.commit()

            # Create unique index
            db.execute(text(
                "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_whatsapp_phone_hash "
                "ON users (whatsapp_phone_hash)"
            ))
            db.commit()
        else:
            logger.info("[MIGRATE] whatsapp_phone_hash column already exists")

        # Add whatsapp_key column
        if "whatsapp_key" not in columns:
            logger.info("[MIGRATE] Adding whatsapp_key column")
            db.execute(text("ALTER TABLE users ADD COLUMN whatsapp_key VARCHAR(12)"))
            db.commit()

            # Create unique index
            db.execute(text(
                "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_whatsapp_key "
                "ON users (whatsapp_key)"
            ))
            db.commit()
        else:
            logger.info("[MIGRATE] whatsapp_key column already exists")

        logger.info("[MIGRATE] WhatsApp migration complete")

    except Exception as e:
        logger.error("[MIGRATE] Migration failed: %s", e)
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    migrate()
