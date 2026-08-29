"""Migration: Add merchant_preferences table for user category learning."""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.database import engine
from sqlalchemy import text


def migrate():
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS merchant_preferences (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    merchant_key VARCHAR(255) NOT NULL,
                    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
                    confidence FLOAT DEFAULT 1.0,
                    usage_count INTEGER DEFAULT 1,
                    last_used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(user_id, merchant_key)
                )
                """
            )
        )

        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_merchant_preferences_user_id ON merchant_preferences(user_id)"
            )
        )

        print("✅ merchant_preferences table created successfully")


if __name__ == "__main__":
    migrate()
