#!/usr/bin/env python3
"""
Migration: Add reset_token and reset_token_expires columns to users table.

Run with: python -m scripts.migrate_add_reset_token
"""

import os
import sys

from sqlalchemy import create_engine, text

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def get_engine():
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        raise RuntimeError("DATABASE_URL env var not set. Aborting.")
    if db_url.startswith("postgres://"):
        db_url = db_url.replace("postgres://", "postgresql://", 1)
    print(f"Connecting to: {db_url.split('@')[1] if '@' in db_url else db_url}")
    return create_engine(db_url)


def main():
    engine = get_engine()

    print("=" * 60)
    print("Migration: Add password reset token columns to users")
    print("=" * 60)

    with engine.begin() as conn:
        dialect = engine.dialect.name

        if dialect == "postgresql":
            # Check if columns already exist
            exists = conn.execute(text("""
                SELECT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'users' AND column_name = 'reset_token'
                )
            """)).scalar()

            if exists:
                print("Columns already exist. Skipping.")
            else:
                print("Adding reset_token column...")
                conn.execute(text("""
                    ALTER TABLE users
                    ADD COLUMN reset_token VARCHAR(64) UNIQUE
                """))

                print("Adding reset_token_expires column...")
                conn.execute(text("""
                    ALTER TABLE users
                    ADD COLUMN reset_token_expires TIMESTAMP
                """))

                print("Creating index on reset_token...")
                conn.execute(text("""
                    CREATE INDEX ix_users_reset_token ON users (reset_token)
                """))

                print("Migration complete!")
        else:
            print(f"Skipping migration for dialect '{dialect}' (PostgreSQL only).")

    print("=" * 60)


if __name__ == "__main__":
    main()
