"""Add last_login column to users table."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text

from app.database import engine


def main():
    dialect = engine.dialect.name
    print(f"=== Migration: Add last_login column to users ({dialect}) ===")

    with engine.begin() as conn:
        if dialect == "postgresql":
            # Check if column already exists
            result = conn.execute(
                text(
                    "SELECT 1 FROM information_schema.columns "
                    "WHERE table_name = 'users' AND column_name = 'last_login'"
                )
            )
            if result.fetchone():
                print("  Column last_login already exists, skipping.")
                return

            conn.execute(text("ALTER TABLE users ADD COLUMN last_login TIMESTAMP NULL"))
            print("  Added last_login column.")
        elif dialect == "sqlite":
            conn.execute(text("ALTER TABLE users ADD COLUMN last_login TIMESTAMP"))
            print("  Added last_login column (sqlite).")
        else:
            print(f"  Unsupported dialect: {dialect}")
            return

    print("=== Migration complete ===")


if __name__ == "__main__":
    main()
