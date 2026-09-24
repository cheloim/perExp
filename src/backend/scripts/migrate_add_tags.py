"""Migration: Create tags/expense_tags tables + add new FK columns.

Adds the Tags subsystem for Issue 199 and links scheduled/recurring expenses
to their template expense/tag for propagation.

Usage:
    python scripts/migrate_add_tags.py
"""

from sqlalchemy import text

from app.database import engine, SessionLocal
from app.models import Base, Tag, ExpenseTag


def migrate():
    db = SessionLocal()
    try:
        print("Creating tags and expense_tags tables...")
        Tag.__table__.create(bind=engine, checkfirst=True)
        ExpenseTag.__table__.create(bind=engine, checkfirst=True)

        print("Adding expense_id column to scheduled_expenses if missing...")
        db.execute(text(
            "DO $$ BEGIN "
            "  IF NOT EXISTS ("
            "    SELECT 1 FROM information_schema.columns "
            "    WHERE table_name='scheduled_expenses' AND column_name='expense_id'"
            "  ) THEN "
            "    ALTER TABLE scheduled_expenses ADD COLUMN expense_id INTEGER "
            "      REFERENCES expenses(id) ON DELETE SET NULL; "
            "    CREATE INDEX IF NOT EXISTS ix_scheduled_expenses_expense_id "
            "      ON scheduled_expenses(expense_id); "
            "  END IF; "
            "END $$;"
        ))

        print("Adding tag_id column to recurring_expenses if missing...")
        db.execute(text(
            "DO $$ BEGIN "
            "  IF NOT EXISTS ("
            "    SELECT 1 FROM information_schema.columns "
            "    WHERE table_name='recurring_expenses' AND column_name='tag_id'"
            "  ) THEN "
            "    ALTER TABLE recurring_expenses ADD COLUMN tag_id INTEGER "
            "      REFERENCES tags(id) ON DELETE SET NULL; "
            "    CREATE INDEX IF NOT EXISTS ix_recurring_expenses_tag_id "
            "      ON recurring_expenses(tag_id); "
            "  END IF; "
            "END $$;"
        ))

        db.commit()
        print("Done.")
    finally:
        db.close()


if __name__ == "__main__":
    migrate()
