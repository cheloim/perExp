"""Migration: add telegram_key_expires column to users table.

This column was added to the User model but the production database
doesn't have it yet. The backend fails to start without it.

Idempotent: uses IF NOT EXISTS.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text

from app.database import SessionLocal


def migrate():
    db = SessionLocal()
    try:
        # Check if column already exists
        result = db.execute(
            text("""
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'users' 
                AND column_name = 'telegram_key_expires'
            """)
        ).fetchone()

        if result:
            print("✓ telegram_key_expires column already exists")
            return

        # Add the column
        db.execute(text("ALTER TABLE users ADD COLUMN telegram_key_expires TIMESTAMP"))
        db.commit()
        print("✓ Added telegram_key_expires column to users table")

    except Exception as e:
        print(f"✗ Error: {e}")
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    migrate()