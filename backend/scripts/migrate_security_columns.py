#!/usr/bin/env python3
"""
Migration: Add security columns (MFA, email verification, forced password change, audit logs).

Run with: python -m scripts.migrate_security_columns

Idempotent — safe to run multiple times. Checks existence before adding.
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


def column_exists(conn, table: str, column: str) -> bool:
    result = conn.execute(
        text(
            "SELECT EXISTS ("
            "  SELECT 1 FROM information_schema.columns"
            "  WHERE table_name = :table AND column_name = :column"
            ")"
        ),
        {"table": table, "column": column},
    )
    return result.scalar()


def table_exists(conn, table: str) -> bool:
    result = conn.execute(
        text(
            "SELECT EXISTS ("
            "  SELECT 1 FROM information_schema.tables"
            "  WHERE table_schema = 'public' AND table_name = :table"
            ")"
        ),
        {"table": table},
    )
    return result.scalar()


def index_exists(conn, index_name: str) -> bool:
    result = conn.execute(
        text(
            "SELECT EXISTS ("
            "  SELECT 1 FROM pg_indexes"
            "  WHERE indexname = :name"
            ")"
        ),
        {"name": index_name},
    )
    return result.scalar()


def main():
    engine = get_engine()

    print("=" * 60)
    print("Migration: Security columns (MFA, email verification, etc.)")
    print("=" * 60)

    with engine.begin() as conn:
        dialect = engine.dialect.name
        if dialect != "postgresql":
            print(f"Skipping migration for dialect '{dialect}' (PostgreSQL only).")
            return

        # --- users table columns ---
        columns_to_add = [
            ("users", "mfa_secret", "VARCHAR(32)"),
            ("users", "mfa_enabled", "BOOLEAN DEFAULT FALSE"),
            ("users", "email_verified", "BOOLEAN DEFAULT FALSE"),
            ("users", "email_verification_token", "VARCHAR(64)"),
            ("users", "force_password_change", "BOOLEAN DEFAULT FALSE"),
        ]

        for table, column, col_type in columns_to_add:
            if column_exists(conn, table, column):
                print(f"  {table}.{column} already exists. Skipping.")
            else:
                print(f"  Adding {table}.{column}...")
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {col_type}"))

        # --- index on email_verification_token ---
        idx_name = "ix_users_email_verification_token"
        if index_exists(conn, idx_name):
            print(f"  Index {idx_name} already exists. Skipping.")
        else:
            print(f"  Creating index {idx_name}...")
            conn.execute(text(f"CREATE INDEX {idx_name} ON users (email_verification_token)"))

        # --- audit_logs table ---
        if table_exists(conn, "audit_logs"):
            print("  audit_logs table already exists. Skipping.")
        else:
            print("  Creating audit_logs table...")
            conn.execute(
                text(
                    "CREATE TABLE IF NOT EXISTS audit_logs ("
                    "    id SERIAL PRIMARY KEY,"
                    "    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,"
                    "    action VARCHAR(50) NOT NULL,"
                    "    ip_address VARCHAR(45),"
                    "    user_agent VARCHAR(500),"
                    "    details TEXT,"
                    "    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP"
                    ")"
                )
            )
            print("  Creating index ix_audit_logs_user_id...")
            conn.execute(text("CREATE INDEX ix_audit_logs_user_id ON audit_logs (user_id)"))

        # --- backfill existing users ---
        unverified = conn.execute(
            text("SELECT COUNT(*) FROM users WHERE email_verified = false")
        ).scalar()
        if unverified > 0:
            print(f"  Auto-verifying {unverified} existing users...")
            conn.execute(text("UPDATE users SET email_verified = true WHERE email_verified = false"))

        needs_password_change = conn.execute(
            text(
                "SELECT COUNT(*) FROM users"
                " WHERE hashed_password IS NOT NULL AND force_password_change = false"
            )
        ).scalar()
        if needs_password_change > 0:
            print(f"  Flagging {needs_password_change} users for forced password change...")
            conn.execute(
                text(
                    "UPDATE users SET force_password_change = true"
                    " WHERE hashed_password IS NOT NULL AND force_password_change = false"
                )
            )

    print("=" * 60)
    print("Migration complete!")
    print("=" * 60)


if __name__ == "__main__":
    main()
