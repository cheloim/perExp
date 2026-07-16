#!/usr/bin/env python3
"""
Migration: Add onboarding_completed column to users table.

Run with: python -m scripts.migrate_onboarding_completed

Idempotent — safe to run multiple times.
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


def column_exists(conn, table: str, column: str) -> bool:
    result = conn.execute(
        text(
            "SELECT EXISTS ("
            "  SELECT 1 FROM information_schema.columns"
            "  WHERE table_name = :table AND column_name = :column"
            ")"
        ),
        {"table": table, "column": column},
    )
    return result.scalar()


def main():
    engine = get_engine()

    with engine.begin() as conn:
        # Add onboarding_completed to users
        if not column_exists(conn, "users", "onboarding_completed"):
            print("Adding onboarding_completed to users...")
            conn.execute(
                text("ALTER TABLE users ADD COLUMN onboarding_completed BOOLEAN DEFAULT FALSE")
            )
            print("  ✓ Added onboarding_completed")
        else:
            print("  ✓ onboarding_completed already exists")

    print("\nDone!")


if __name__ == "__main__":
    main()
