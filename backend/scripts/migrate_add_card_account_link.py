#!/usr/bin/env python3
"""
Migration: Add linked_account_id to cards table.

Links debit cards to savings accounts (caja_ahorro).

Run with: python -m scripts.migrate_add_card_account_link
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
    print("Migration: Add linked_account_id to cards table")
    print("=" * 60)

    with engine.begin() as conn:
        dialect = engine.dialect.name

        if dialect == "postgresql":
            conn.execute(text("SET search_path TO public"))

            # Check if column already exists
            has_column = conn.execute(text("""
                SELECT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'cards' AND column_name = 'linked_account_id'
                )
            """)).scalar()

            if has_column:
                print("Column linked_account_id already exists. Skipping.")
            else:
                print("Adding linked_account_id column to cards...")
                conn.execute(text("""
                    ALTER TABLE cards ADD COLUMN linked_account_id INTEGER
                    REFERENCES accounts(id) ON DELETE SET NULL
                """))
                print("  ✓ Column added")

            # Ensure index exists
            has_index = conn.execute(text("""
                SELECT EXISTS (
                    SELECT 1 FROM pg_indexes
                    WHERE tablename = 'cards' AND indexname = 'ix_cards_linked_account_id'
                )
            """)).scalar()

            if not has_index:
                print("Creating index ix_cards_linked_account_id...")
                conn.execute(text("""
                    CREATE INDEX ix_cards_linked_account_id ON cards (linked_account_id)
                """))
                print("  ✓ Index created")
            else:
                print("Index ix_cards_linked_account_id already exists. Skipping.")

            # Verify
            verify = conn.execute(text("""
                SELECT c.column_name, c.is_nullable
                FROM information_schema.columns c
                WHERE c.table_name = 'cards' AND c.column_name = 'linked_account_id'
            """)).fetchone()

            if verify:
                print(f"\nVerification passed:")
                print(f"  Column: {verify[0]}")
                print(f"  Nullable: {verify[1]}")
            else:
                raise RuntimeError("Verification failed: column not found")

        else:
            print(f"Dialect '{dialect}' not PostgreSQL. Skipping schema changes.")
            print("SQLite/Alembic will handle this via models.")

    print("\n" + "=" * 60)
    print("Migration complete!")
    print("=" * 60)


if __name__ == "__main__":
    main()
