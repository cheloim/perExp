"""
Script to add performance indices to the expenses table.
Run from the backend directory: python -m app.add_indices
"""

import os
from sqlalchemy import create_engine, text

DATABASE_URL = os.getenv(
    "DATABASE_URL", "postgresql://expenses_user:changeme@localhost:5432/expenses"
)

INDICES = [
    ("ix_expenses_user_date", "expenses", ["user_id", "date"]),
    ("ix_expenses_user_category", "expenses", ["user_id", "category_id"]),
    ("ix_expenses_user_installment", "expenses", ["user_id", "installment_group_id"]),
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
