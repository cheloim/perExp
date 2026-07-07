#!/usr/bin/env python3
"""
Migration: Database structure improvements.

1. Add UniqueConstraint on group_members(group_id, user_id)
2. Add card_id FK to card_closings (backfill from card/bank strings)
3. Fix nullable user_id → NOT NULL on expenses, analysis_history, investments, card_closings, categories
4. Add missing performance indexes

Run with: python -m scripts.migrate_db_structure
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


def _constraint_exists(conn, constraint_name: str) -> bool:
    result = conn.execute(
        text(
            "SELECT EXISTS ("
            "  SELECT 1 FROM information_schema.table_constraints"
            "  WHERE constraint_name = :name"
            ")"
        ),
        {"name": constraint_name},
    )
    return result.scalar()


def step1_unique_constraint(engine):
    """Add UNIQUE constraint on group_members(group_id, user_id)."""
    print("\n[Step 1/4] Adding unique constraint on group_members...")

    with engine.begin() as conn:
        dialect = engine.dialect.name

        if dialect == "postgresql":
            if _constraint_exists(conn, "uq_group_member"):
                print("  Constraint uq_group_member already exists. Skipping.")
            else:
                conn.execute(text("""
                    ALTER TABLE group_members
                    ADD CONSTRAINT uq_group_member
                    UNIQUE (group_id, user_id)
                """))
                print("  Added UNIQUE(group_id, user_id) constraint.")
        else:
            print("  Skipping — only supported on PostgreSQL.")


def step2_card_closing_card_id(engine):
    """Add card_id column to card_closings and backfill from card/bank strings."""
    print("\n[Step 2/4] Adding card_id to card_closings...")

    with engine.begin() as conn:
        dialect = engine.dialect.name

        # Check if column already exists
        if dialect == "postgresql":
            exists = conn.execute(text("""
                SELECT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'card_closings' AND column_name = 'card_id'
                )
            """)).scalar()
        else:
            exists = False

        if exists:
            print("  card_id column already exists. Backfilling...")
        else:
            conn.execute(text("ALTER TABLE card_closings ADD COLUMN card_id INTEGER"))
            print("  Added card_id column.")

        # Backfill: match card_closings to cards by (user_id, card_name, bank)
        result = conn.execute(text("""
            UPDATE card_closings cc
            SET card_id = c.id
            FROM cards c
            WHERE cc.card_id IS NULL
            AND cc.user_id = c.user_id
            AND LOWER(TRIM(cc.card)) = LOWER(TRIM(c.card_name))
            AND LOWER(TRIM(COALESCE(cc.bank, ''))) = LOWER(TRIM(COALESCE(c.bank, '')))
        """))
        print(f"  Backfilled {result.rowcount} card_closings with card_id.")

        # Add FK constraint
        if dialect == "postgresql":
            try:
                conn.execute(text("""
                    ALTER TABLE card_closings
                    ADD CONSTRAINT fk_card_closings_card_id
                    FOREIGN KEY (card_id) REFERENCES cards(id)
                """))
                print("  Added FK constraint.")
            except Exception as e:
                print(f"  FK constraint warning: {e}")


def step3_nullable_user_id(engine):
    """Fix nullable user_id columns to NOT NULL."""
    print("\n[Step 3/4] Fixing nullable user_id columns...")

    with engine.begin() as conn:
        dialect = engine.dialect.name

        tables = ["expenses", "analysis_history", "investments", "card_closings"]

        for table in tables:
            # Backfill NULL user_id with first seed user
            result = conn.execute(text(f"""
                UPDATE {table}
                SET user_id = (
                    SELECT id FROM users ORDER BY id LIMIT 1
                )
                WHERE user_id IS NULL
            """))
            if result.rowcount > 0:
                print(f"  {table}: backfilled {result.rowcount} rows with seed user_id.")

            # Set NOT NULL
            if dialect == "postgresql":
                try:
                    conn.execute(text(f"""
                        ALTER TABLE {table}
                        ALTER COLUMN user_id SET NOT NULL
                    """))
                    print(f"  {table}.user_id → NOT NULL.")
                except Exception as e:
                    print(f"  {table}: could not set NOT NULL — {e}")
            elif dialect == "sqlite":
                print(f"  {table}: skipping NOT NULL (SQLite limited ALTER TABLE support).")


def step4_indexes(engine):
    """Add missing performance indexes."""
    print("\n[Step 4/4] Adding missing indexes...")

    indices = [
        # Expenses - individual FK indexes
        ("ix_expenses_user_id", "expenses", ["user_id"]),
        ("ix_expenses_card_id", "expenses", ["card_id"]),
        ("ix_expenses_category_id", "expenses", ["category_id"]),
        ("ix_expenses_account_id", "expenses", ["account_id"]),
        ("ix_expenses_is_income", "expenses", ["is_income"]),
        # Cards
        ("ix_cards_user_id", "cards", ["user_id"]),
        ("ix_cards_card_type", "cards", ["card_type"]),
        # Categories
        ("ix_categories_user_id", "categories", ["user_id"]),
        ("ix_categories_parent_id", "categories", ["parent_id"]),
        # Accounts
        ("ix_accounts_user_id", "accounts", ["user_id"]),
        # Group members
        ("ix_group_members_user_id", "group_members", ["user_id"]),
        ("ix_group_members_group_id", "group_members", ["group_id"]),
        ("ix_group_members_user_status", "group_members", ["user_id", "status"]),
        # Notifications
        ("ix_notifications_user_read", "notifications", ["user_id", "read"]),
        # Investments
        ("ix_investments_user_id", "investments", ["user_id"]),
        ("ix_investments_user_ticker_broker", "investments", ["user_id", "ticker", "broker"]),
        # Analysis history
        ("ix_analysis_history_user_id", "analysis_history", ["user_id"]),
        # Card closings
        ("ix_card_closings_user_id", "card_closings", ["user_id"]),
        # Scheduled expenses
        ("ix_scheduled_expenses_user_id", "scheduled_expenses", ["user_id"]),
        ("ix_scheduled_expenses_user_status", "scheduled_expenses", ["user_id", "status"]),
    ]

    with engine.begin() as conn:
        for idx_name, table, columns in indices:
            cols = ", ".join(columns)
            sql = f"CREATE INDEX IF NOT EXISTS {idx_name} ON {table} ({cols})"
            try:
                conn.execute(text(sql))
                print(f"  Created {idx_name}.")
            except Exception as e:
                print(f"  {idx_name}: {e}")


def main():
    engine = get_engine()

    print("=" * 60)
    print("Migration: Database Structure Improvements")
    print("=" * 60)

    step1_unique_constraint(engine)
    step2_card_closing_card_id(engine)
    step3_nullable_user_id(engine)
    step4_indexes(engine)

    print("\n" + "=" * 60)
    print("Migration complete!")
    print("=" * 60)


if __name__ == "__main__":
    main()
