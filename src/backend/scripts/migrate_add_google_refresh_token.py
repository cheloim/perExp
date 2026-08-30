"""Migration: Add Google refresh token columns to users table.

Adds:
- google_refresh_token (encrypted)
- google_refresh_token_hmac (indexed)

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
    """Add Google refresh token columns to users table if they don't exist."""
    inspector = inspect(engine)
    columns = {col["name"] for col in inspector.get_columns("users")}

    db = SessionLocal()
    try:
        # Add google_refresh_token column
        if "google_refresh_token" not in columns:
            logger.info("[MIGRATE] Adding google_refresh_token column")
            db.execute(text("ALTER TABLE users ADD COLUMN google_refresh_token VARCHAR"))
            db.commit()
        else:
            logger.info("[MIGRATE] google_refresh_token column already exists")

        # Add google_refresh_token_hmac column
        if "google_refresh_token_hmac" not in columns:
            logger.info("[MIGRATE] Adding google_refresh_token_hmac column")
            db.execute(text(
                "ALTER TABLE users ADD COLUMN google_refresh_token_hmac VARCHAR(64)"
            ))
            db.commit()

            # Create index
            db.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_users_google_refresh_token_hmac "
                "ON users (google_refresh_token_hmac)"
            ))
            db.commit()
        else:
            logger.info("[MIGRATE] google_refresh_token_hmac column already exists")

        logger.info("[MIGRATE] Google refresh token migration complete")

    except Exception as e:
        logger.error("[MIGRATE] Migration failed: %s", e)
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    migrate()
