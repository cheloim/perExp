"""Migration: Add recurring_expenses table for subscription tracking."""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.database import engine
from sqlalchemy import text


def migrate():
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS recurring_expenses (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    merchant_key VARCHAR(255) NOT NULL,
                    description VARCHAR(500) NOT NULL,
                    amount FLOAT NOT NULL,
                    currency VARCHAR(10) DEFAULT 'ARS',
                    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
                    card_id INTEGER REFERENCES cards(id) ON DELETE SET NULL,
                    account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
                    frequency VARCHAR(20) DEFAULT 'monthly',
                    next_charge_date DATE,
                    alert_days_before INTEGER DEFAULT 3,
                    is_active BOOLEAN DEFAULT TRUE,
                    last_seen_at TIMESTAMP,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP
                )
                """
            )
        )

        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_recurring_expenses_user_id ON recurring_expenses(user_id)"
            )
        )

        print("✅ recurring_expenses table created successfully")


if __name__ == "__main__":
    migrate()
