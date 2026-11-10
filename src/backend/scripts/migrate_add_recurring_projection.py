"""Add expenses.is_recurring_projection (recurring auto-execution).

Idempotent bridge for the current GitHub migrations workflow, which runs
``src/backend/scripts/migrate_*.py`` before Alembic is automated. The equivalent
Alembic revision is 000000000003 and is safe to run after this script.

Run from the backend directory:
    python -m scripts.migrate_add_recurring_projection
"""

import os

from sqlalchemy import create_engine, text

DATABASE_URL = os.getenv(
    "DATABASE_URL", "postgresql://expenses_user:changeme@localhost:5432/expenses"
)


def main():
    engine = create_engine(DATABASE_URL)
    with engine.begin() as conn:
        conn.execute(
            text(
                "ALTER TABLE expenses "
                "ADD COLUMN IF NOT EXISTS is_recurring_projection "
                "BOOLEAN NOT NULL DEFAULT false"
            )
        )
    print("OK: expenses.is_recurring_projection")
    print("Done.")


if __name__ == "__main__":
    main()
