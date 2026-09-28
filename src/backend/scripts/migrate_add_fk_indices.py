"""Add missing foreign key indices for query performance.

Idempotent: uses CREATE INDEX IF NOT EXISTS, safe to run multiple times.
Auto-discovered by CI pipeline (scripts/migrate_*.py).
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text

from app.database import engine

# New indices to add (table, columns, index name)
# These were identified as missing FK indices causing slow joins.
NEW_INDICES = [
    ("scheduled_expenses", ["card_id"], "ix_scheduled_expenses_card_id"),
    ("scheduled_expenses", ["account_id"], "ix_scheduled_expenses_account_id"),
    ("recurring_expenses", ["user_id"], "ix_recurring_expenses_user_id"),
    ("recurring_expenses", ["category_id"], "ix_recurring_expenses_category_id"),
    ("recurring_expenses", ["card_id"], "ix_recurring_expenses_card_id"),
    ("recurring_expenses", ["account_id"], "ix_recurring_expenses_account_id"),
    ("recurring_expenses", ["tag_id"], "ix_recurring_expenses_tag_id"),
    ("card_closings", ["card_id"], "ix_card_closings_card_id"),
    ("expenses", ["budget_event_id"], "ix_expenses_budget_event_id"),
    ("category_suggestions", ["suggested_category_id"], "ix_category_suggestions_suggested_cat_id"),
]


def main():
    dialect = engine.dialect.name
    print(f"=== Migration: Add FK indices ({dialect}) ===")

    if dialect != "postgresql":
        print(f"  Skipping — only runs on PostgreSQL (dialect: {dialect})")
        return

    created = 0
    skipped = 0

    with engine.begin() as conn:
        for table, columns, idx_name in NEW_INDICES:
            cols = ", ".join(columns)
            # Check if table exists first
            table_exists = conn.execute(
                text(
                    "SELECT 1 FROM information_schema.tables "
                    "WHERE table_name = :table AND table_schema = 'public'"
                ),
                {"table": table},
            ).fetchone()
            if not table_exists:
                print(f"  Table {table} not found, skipping {idx_name}")
                skipped += 1
                continue

            # CREATE INDEX IF NOT EXISTS is idempotent
            sql = f"CREATE INDEX IF NOT EXISTS {idx_name} ON {table} ({cols})"
            conn.execute(text(sql))
            print(f"  Ensured index: {idx_name} ON {table}({cols})")
            created += 1

    print(f"=== Migration complete ({created} indices ensured, {skipped} skipped) ===")


if __name__ == "__main__":
    main()
