#!/usr/bin/env python3
"""
Migration: Create monthly_reports table with all columns.

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
            # Ensure public schema is in search path
            conn.execute(text("SET search_path TO public"))

            # Check if table already exists
            exists = conn.execute(text("""
                SELECT EXISTS (
                    SELECT 1 FROM information_schema.tables
                    WHERE table_schema = 'public' AND table_name = 'monthly_reports'
                )
            """)).scalar()

            if exists:
                print("Table already exists. Checking for columns...")

                # Ensure png_data column exists
                has_png = conn.execute(text("""
                    SELECT EXISTS (
                        SELECT 1 FROM information_schema.columns
                        WHERE table_name = 'monthly_reports' AND column_name = 'png_data'
                    )
                """)).scalar()
                if not has_png:
                    print("Adding png_data column...")
                    conn.execute(text("ALTER TABLE monthly_reports ADD COLUMN png_data BYTEA"))
                    print("png_data column added!")
                else:
                    print("png_data column already exists.")

                # Ensure pdf_data column exists
                has_pdf = conn.execute(text("""
                    SELECT EXISTS (
                        SELECT 1 FROM information_schema.columns
                        WHERE table_name = 'monthly_reports' AND column_name = 'pdf_data'
                    )
                """)).scalar()
                if not has_pdf:
                    print("Adding pdf_data column...")
                    conn.execute(text("ALTER TABLE monthly_reports ADD COLUMN pdf_data BYTEA"))
                    print("pdf_data column added!")
                else:
                    print("pdf_data column already exists.")

                # Ensure status column exists
                has_status = conn.execute(text("""
                    SELECT EXISTS (
                        SELECT 1 FROM information_schema.columns
                        WHERE table_name = 'monthly_reports' AND column_name = 'status'
                    )
                """)).scalar()
                if not has_status:
                    print("Adding status column...")
                    conn.execute(text("ALTER TABLE monthly_reports ADD COLUMN status VARCHAR(20) DEFAULT 'READY'"))
                    conn.execute(text("UPDATE monthly_reports SET status = 'READY' WHERE status IS NULL"))
                    print("status column added!")
                else:
                    print("status column already exists.")

                # Ensure error_message column exists
                has_error = conn.execute(text("""
                    SELECT EXISTS (
                        SELECT 1 FROM information_schema.columns
                        WHERE table_name = 'monthly_reports' AND column_name = 'error_message'
                    )
                """)).scalar()
                if not has_error:
                    print("Adding error_message column...")
                    conn.execute(text("ALTER TABLE monthly_reports ADD COLUMN error_message TEXT"))
                    print("error_message column added!")
                else:
                    print("error_message column already exists.")
            else:
                print("Creating monthly_reports table...")
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS monthly_reports (
                        id SERIAL PRIMARY KEY,
                        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                        month VARCHAR(7) NOT NULL,
                        status VARCHAR(20) DEFAULT 'READY',
                        report_data TEXT,
                        pdf_data BYTEA,
                        png_data BYTEA,
                        error_message TEXT,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        generated_at TIMESTAMP
                    )
                """))

                print("Creating index on user_id and month...")
                conn.execute(text("""
                    CREATE UNIQUE INDEX IF NOT EXISTS ix_monthly_reports_user_month
                    ON monthly_reports (user_id, month)
                """))

                print("Migration complete!")
        else:
            print(f"Skipping migration for dialect '{dialect}' (PostgreSQL only).")

    print("=" * 60)


if __name__ == "__main__":
    main()
