"""
Script to add performance indices to all tables.
Run from the backend directory: python -m app.add_indices
"""

import os

from sqlalchemy import create_engine, text

DATABASE_URL = os.getenv(
    "DATABASE_URL", "postgresql://expenses_user:changeme@localhost:5432/expenses"
)

INDICES = [
    # Expenses - composite (existing)
    ("ix_expenses_user_date", "expenses", ["user_id", "date"]),
    ("ix_expenses_user_category", "expenses", ["user_id", "category_id"]),
    ("ix_expenses_user_installment", "expenses", ["user_id", "installment_group_id"]),
    # Expenses - individual FK
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


def main():
    engine = create_engine(DATABASE_URL)
    with engine.connect() as conn:
        for idx_name, table, columns in INDICES:
            cols = ", ".join(columns)
            sql = f"CREATE INDEX IF NOT EXISTS {idx_name} ON {table} ({cols})"
            print(f"Creating index: {idx_name}...")
            conn.execute(text(sql))
        conn.commit()
    print("Done! All indices created.")


if __name__ == "__main__":
    main()
