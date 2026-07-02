#!/usr/bin/env python3
"""
Migration: Create monthly_reports table with pdf_data column.

Run with: python -m scripts.migrate_add_monthly_reports
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


def main():
    engine = get_engine()

    print("=" * 60)
    print("Migration: Create monthly_reports table")
    print("=" * 60)

    with engine.begin() as conn:
        dialect = engine.dialect.name

        if dialect == "postgresql":
            # Check if table already exists
            exists = conn.execute(text("""
                SELECT EXISTS (
                    SELECT 1 FROM information_schema.tables
                    WHERE table_name = 'monthly_reports'
                )
            """)).scalar()

            if exists:
                print("Table already exists. Checking for pdf_data column...")
                has_pdf_data = conn.execute(text("""
                    SELECT EXISTS (
                        SELECT 1 FROM information_schema.columns
                        WHERE table_name = 'monthly_reports' AND column_name = 'pdf_data'
                    )
                """)).scalar()
                if not has_pdf_data:
                    print("Adding pdf_data column...")
                    conn.execute(text("""
                        ALTER TABLE monthly_reports ADD COLUMN pdf_data BYTEA
                    """))
                    print("pdf_data column added!")
                else:
                    print("pdf_data column already exists.")
            else:
                print("Creating monthly_reports table...")
                conn.execute(text("""
                    CREATE TABLE monthly_reports (
                        id SERIAL PRIMARY KEY,
                        user_id INTEGER NOT NULL REFERENCES users.id ON DELETE CASCADE,
                        month VARCHAR(7) NOT NULL,
                        report_data TEXT NOT NULL,
                        pdf_data BYTEA,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        generated_at TIMESTAMP
                    )
                """))

                print("Creating index on user_id and month...")
                conn.execute(text("""
                    CREATE UNIQUE INDEX ix_monthly_reports_user_month
                    ON monthly_reports (user_id, month)
                """))

                print("Migration complete!")
        else:
            print(f"Skipping migration for dialect '{dialect}' (PostgreSQL only).")

    print("=" * 60)


if __name__ == "__main__":
    main()
