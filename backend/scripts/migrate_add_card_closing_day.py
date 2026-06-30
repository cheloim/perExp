#!/usr/bin/env python3
"""
Migration: Add closing_day column to cards table.

This stores the approximate day of month a credit card closes (1-31).
Used as a fallback when no CardClosing records exist from imported statements.

Run with: python -m scripts.migrate_add_card_closing_day
"""

import os
import sys

from sqlalchemy import create_engine, text

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def get_engine():
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        # Try local SQLite
        db_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "expenses.db")
        if os.path.exists(db_path):
            return create_engine(f"sqlite:///{db_path}")
        raise RuntimeError("DATABASE_URL env var not set and no local expenses.db found.")
    if db_url.startswith("postgres://"):
        db_url = db_url.replace("postgres://", "postgresql://", 1)
    print(f"Connecting to: {db_url.split('@')[1] if '@' in db_url else db_url}")
    return create_engine(db_url)


def add_closing_day_column(engine):
    """Add closing_day column to cards table."""
    print("\n[Step 1/1] Adding closing_day column to cards...")

    with engine.begin() as conn:
        dialect = engine.dialect.name

        if dialect == "postgresql":
            exists = conn.execute(text("""
                SELECT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'cards' AND column_name = 'closing_day'
                )
            """)).scalar()
        elif dialect == "sqlite":
            result = conn.execute(text("PRAGMA table_info(cards)")).fetchall()
            exists = any(row[1] == "closing_day" for row in result)
        else:
            exists = False

        if exists:
            print("  closing_day column already exists. Skipping.")
            return

        conn.execute(text("ALTER TABLE cards ADD COLUMN closing_day INTEGER"))
        print("  Added closing_day INTEGER column to cards.")


def main():
    engine = get_engine()

    print("=" * 60)
    print("Migration: Add closing_day to cards")
    print("=" * 60)

    add_closing_day_column(engine)

    print("\n" + "=" * 60)
    print("Migration complete!")
    print("=" * 60)


if __name__ == "__main__":
    main()
