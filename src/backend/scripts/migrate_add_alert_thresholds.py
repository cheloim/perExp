"""Add alert_thresholds columns to budgets and budget_groups (issue #171).

Idempotent: safe to run multiple times.
Run from the backend directory: python -m scripts.migrate_add_alert_thresholds
"""

import os

from sqlalchemy import create_engine, text

DATABASE_URL = os.getenv(
    "DATABASE_URL", "postgresql://expenses_user:changeme@localhost:5432/expenses"
)

COLUMNS = [
    ("budgets", "alert_thresholds"),
    ("budget_groups", "alert_thresholds"),
]


def main():
    engine = create_engine(DATABASE_URL)
    with engine.connect() as conn:
        for table, column in COLUMNS:
            conn.execute(text(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {column} TEXT"))
            conn.commit()
            print(f"OK: {table}.{column}")
    print("Done.")


if __name__ == "__main__":
    main()
