"""Migration: Add category_suggestions table for AI auto-categorization."""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.database import engine
from sqlalchemy import text


def migrate():
    with engine.begin() as conn:
        # Create category_suggestions table
        conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS category_suggestions (
                    id SERIAL PRIMARY KEY,
                    expense_id INTEGER NOT NULL REFERENCES expenses(id) ON DELETE CASCADE UNIQUE,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    suggested_category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
                    confidence FLOAT NOT NULL,
                    status VARCHAR(20) DEFAULT 'pending',
                    source VARCHAR(20) DEFAULT 'llm',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
        )

        # Create indexes
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_category_suggestions_user_id ON category_suggestions(user_id)"
            )
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_category_suggestions_expense_id ON category_suggestions(expense_id)"
            )
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_category_suggestions_status ON category_suggestions(status)"
            )
        )

        print("✅ category_suggestions table created successfully")


if __name__ == "__main__":
    migrate()
