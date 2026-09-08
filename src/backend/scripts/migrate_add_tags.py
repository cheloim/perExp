"""Migration: Create tags and expense_tags tables.

Adds the Tags subsystem for Issue 199 — replacing cards/accounts as the
primary classification on expenses.

Usage:
    python scripts/migrate_add_tags.py
"""

from app.database import engine
from app.models import Base, Tag, ExpenseTag


def migrate():
    print("Creating tags and expense_tags tables...")
    Tag.__table__.create(bind=engine, checkfirst=True)
    ExpenseTag.__table__.create(bind=engine, checkfirst=True)
    print("Done. Tables created (or already existed).")


if __name__ == "__main__":
    migrate()
