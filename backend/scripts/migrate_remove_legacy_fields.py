#!/usr/bin/env python3
"""
Migration script: Remove legacy fields (card, bank, person, group_id) from expenses and scheduled_expenses.

This script:
1. Backfills card_id on expenses/scheduled_expenses that have legacy text but no card_id
2. Creates cards for expenses that reference non-existent cards
3. Drops legacy columns (card, bank, person, group_id) from both tables

Run with: python -m scripts.migrate_remove_legacy_fields
"""

import os
import sys
from datetime import datetime

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

# Add parent dir to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.models import Base
from app.services.normalizers import normalize_bank


def get_engine():
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        raise RuntimeError("DATABASE_URL env var not set. Aborting.")
    if db_url.startswith("postgres://"):
        db_url = db_url.replace("postgres://", "postgresql://", 1)
    print(f"Connecting to: {db_url.split('@')[1] if '@' in db_url else db_url}")
    return create_engine(db_url)


def backfill_card_id(engine):
    """Backfill card_id on expenses and scheduled_expenses using legacy text fields."""
    Session = sessionmaker(bind=engine)
    db = Session()

    try:
        # Step 1: Find all unique (bank, card, person) combinations from expenses
        result = db.execute(text("""
            SELECT DISTINCT e.bank, e.card, e.person, e.user_id
            FROM expenses e
            WHERE e.card_id IS NULL
            AND (e.bank IS NOT NULL AND e.bank != '')
            AND (e.card IS NOT NULL AND e.card != '')
        """))
        expense_combos = result.fetchall()

        # Step 2: Find all unique (bank, card, person) combinations from scheduled_expenses
        result = db.execute(text("""
            SELECT DISTINCT s.bank, s.card, s.person, s.user_id
            FROM scheduled_expenses s
            WHERE s.card_id IS NULL
            AND (s.bank IS NOT NULL AND s.bank != '')
            AND (s.card IS NOT NULL AND s.card != '')
        """))
        scheduled_combos = result.fetchall()

        all_combos = set()
        for row in expense_combos:
            all_combos.add((row[0] or "", row[1] or "", row[2] or "", row[3]))
        for row in scheduled_combos:
            all_combos.add((row[0] or "", row[1] or "", row[2] or "", row[3]))

        if not all_combos:
            print("No legacy text data to migrate.")
            return

        print(f"Found {len(all_combos)} unique (bank, card, person) combinations to process.")

        # Step 3: For each combo, find or create a card
        created_cards = 0
        matched_cards = 0

        for bank, card_name, person, user_id in all_combos:
            if not card_name or card_name.lower() in ("efectivo", "transferencia", "cash"):
                continue

            # Try to find existing card
            existing = db.execute(text("""
                SELECT id FROM cards
                WHERE user_id = :user_id
                AND LOWER(TRIM(card_name)) = LOWER(TRIM(:card_name))
                AND LOWER(TRIM(bank)) = LOWER(TRIM(:bank))
                LIMIT 1
            """), {"user_id": user_id, "card_name": card_name, "bank": bank}).fetchone()

            if existing:
                card_id = existing[0]
                matched_cards += 1
            else:
                # Create new card
                db.execute(text("""
                    INSERT INTO cards (card_name, bank, holder, card_type, user_id, created_at)
                    VALUES (:card_name, :bank, :holder, 'credito', :user_id, :created_at)
                """), {
                    "card_name": card_name,
                    "bank": bank,
                    "holder": person or "",
                    "user_id": user_id,
                    "created_at": datetime.utcnow(),
                })
                db.flush()
                card_id = db.execute(text("SELECT LAST_INSERT_ID()")).scalar() or \
                          db.execute(text("SELECT id FROM cards WHERE user_id=:uid ORDER BY id DESC LIMIT 1"),
                                     {"uid": user_id}).scalar()
                created_cards += 1

            # Update expenses with this card_id
            db.execute(text("""
                UPDATE expenses SET card_id = :card_id
                WHERE card_id IS NULL
                AND user_id = :user_id
                AND LOWER(TRIM(COALESCE(bank, ''))) = LOWER(TRIM(:bank))
                AND LOWER(TRIM(COALESCE(card, ''))) = LOWER(TRIM(:card_name))
            """), {"card_id": card_id, "user_id": user_id, "bank": bank, "card_name": card_name})

            # Update scheduled_expenses with this card_id
            db.execute(text("""
                UPDATE scheduled_expenses SET card_id = :card_id
                WHERE card_id IS NULL
                AND user_id = :user_id
                AND LOWER(TRIM(COALESCE(bank, ''))) = LOWER(TRIM(:bank))
                AND LOWER(TRIM(COALESCE(card, ''))) = LOWER(TRIM(:card_name))
            """), {"card_id": card_id, "user_id": user_id, "bank": bank, "card_name": card_name})

        db.commit()
        print(f"Backfill complete: {matched_cards} matched existing cards, {created_cards} new cards created.")

    except Exception as e:
        db.rollback()
        print(f"Error during backfill: {e}")
        raise
    finally:
        db.close()


def drop_legacy_columns(engine):
    """Drop legacy columns from expenses and scheduled_expenses."""
    dialect = engine.dialect.name

    with engine.begin() as conn:
        # Check which columns exist before trying to drop
        if dialect == "sqlite":
            # SQLite doesn't support DROP COLUMN in older versions
            # We need to check the version
            version = conn.execute(text("SELECT sqlite_version()")).scalar()
            major, minor, patch = [int(x) for x in version.split(".")]
            if major < 3 or (major == 3 and minor < 35):
                print(f"SQLite {version} doesn't support DROP COLUMN. Skipping column drops.")
                print("Consider migrating to PostgreSQL or upgrading SQLite to 3.35+")
                return

        columns_to_drop = [
            ("expenses", "card"),
            ("expenses", "bank"),
            ("expenses", "person"),
            ("expenses", "group_id"),
            ("scheduled_expenses", "card"),
            ("scheduled_expenses", "bank"),
            ("scheduled_expenses", "person"),
            ("scheduled_expenses", "group_id"),
        ]

        for table, column in columns_to_drop:
            try:
                if dialect == "sqlite":
                    conn.execute(text(f"ALTER TABLE {table} DROP COLUMN {column}"))
                elif dialect == "postgresql":
                    conn.execute(text(f"ALTER TABLE {table} DROP COLUMN IF EXISTS {column}"))
                else:
                    conn.execute(text(f"ALTER TABLE {table} DROP COLUMN {column}"))
                print(f"  Dropped {table}.{column}")
            except Exception as e:
                print(f"  Warning: Could not drop {table}.{column}: {e}")

    print("Legacy columns dropped.")


def verify_migration(engine):
    """Verify the migration was successful."""
    with engine.connect() as conn:
        # Check that expenses without card_id have no legacy data
        result = conn.execute(text("""
            SELECT COUNT(*) FROM expenses
            WHERE card_id IS NULL
            AND (card IS NOT NULL AND card != '' AND card != 'Efectivo')
        """))
        unmigrated = result.scalar()
        if unmigrated > 0:
            print(f"WARNING: {unmigrated} expenses still have legacy card data without card_id!")

        # Check total expenses
        total = conn.execute(text("SELECT COUNT(*) FROM expenses")).scalar()
        with_card = conn.execute(text("SELECT COUNT(*) FROM expenses WHERE card_id IS NOT NULL")).scalar()
        print(f"Expenses: {total} total, {with_card} with card_id, {total - with_card} without card_id")


def main():
    engine = get_engine()

    print("=" * 60)
    print("Migration: Remove Legacy Fields")
    print("=" * 60)

    print("\n[Step 1/3] Backfilling card_id from legacy text fields...")
    backfill_card_id(engine)

    print("\n[Step 2/3] Verifying migration...")
    verify_migration(engine)

    print("\n[Step 3/3] Dropping legacy columns...")
    drop_legacy_columns(engine)

    print("\n" + "=" * 60)
    print("Migration complete!")
    print("=" * 60)


if __name__ == "__main__":
    main()
