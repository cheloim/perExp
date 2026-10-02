"""Add telegram_key_expires column to users table.

Idempotent: checks if column exists before adding.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text

from app.database import engine


def main():
    dialect = engine.dialect.name
    print(f"=== Migration: Add telegram_key_expires column ({dialect}) ===")

    if dialect == "postgresql":
        with engine.begin() as conn:
            # Check if column already exists
            result = conn.execute(
                text(
                    "SELECT 1 FROM information_schema.columns "
                    "WHERE table_name = 'users' AND column_name = 'telegram_key_expires'"
                )
            )
            if result.fetchone():
                print("  Column telegram_key_expires already exists, skipping.")
                return

            conn.execute(
                text("ALTER TABLE users ADD COLUMN telegram_key_expires TIMESTAMP NULL")
            )
            print("  Added telegram_key_expires column.")
    elif dialect == "sqlite":
        with engine.begin() as conn:
            conn.execute(
                text("ALTER TABLE users ADD COLUMN telegram_key_expires TIMESTAMP")
            )
            print("  Added telegram_key_expires column (sqlite).")
    else:
        print(f"  Unsupported dialect: {dialect}")
        return

    print("=== Migration complete ===")


if __name__ == "__main__":
    main()