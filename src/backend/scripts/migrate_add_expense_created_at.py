#!/usr/bin/env python3
"""
Migration: Add created_at column to expenses table.

This column is required for Issue #201 (48-hour expense editing window).
Existing rows will have NULL created_at, which means they won't be editable
via the 48h window (only new expenses created after migration).

Run with: python -m scripts.migrate_add_expense_created_at
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
    print("Migration: Add created_at column to expenses")
    print("=" * 60)

    with engine.begin() as conn:
        dialect = engine.dialect.name

        if dialect == "postgresql":
            # ─── 1. Check if column already exists ──────────────────────
            print("\n[1/3] Checking if created_at column exists...")
            has_column = conn.execute(
                text("""
                SELECT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'expenses' AND column_name = 'created_at'
                )
            """)
            ).scalar()

            if has_column:
                print("  created_at column already exists, skipping")
                print("\nMigration complete!")
                return

            # ─── 2. Add created_at column ───────────────────────────────
            print("\n[2/3] Adding created_at column...")
            conn.execute(
                text("""
                ALTER TABLE expenses
                ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            """)
            )
            print("  created_at column added")

            # ─── 3. Create index ────────────────────────────────────────
            print("\n[3/3] Creating index...")
            conn.execute(
                text("CREATE INDEX IF NOT EXISTS ix_expenses_created_at ON expenses (created_at)")
            )
            print("  index created")

            # ─── Verification ──────────────────────────────────────────
            print("\n[Verification] Checking column...")
            exists = conn.execute(
                text("""
                SELECT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'expenses' AND column_name = 'created_at'
                )
            """)
            ).scalar()
            if exists:
                print("  ✓ expenses.created_at exists")
            else:
                print("  ✗ expenses.created_at MISSING!")
                raise RuntimeError("Column created_at was not added")

            # Count rows with/without created_at
            total = conn.execute(text("SELECT COUNT(*) FROM expenses")).scalar()
            with_ca = conn.execute(
                text("SELECT COUNT(*) FROM expenses WHERE created_at IS NOT NULL")
            ).scalar()
            without_ca = total - with_ca
            print(f"  Total expenses: {total}")
            print(f"  With created_at: {with_ca}")
            print(f"  Without created_at (NULL, not editable): {without_ca}")

            print("\nMigration complete!")

        else:
            print(f"Skipping migration for dialect '{dialect}' (PostgreSQL only).")

    print("=" * 60)


if __name__ == "__main__":
    main()
