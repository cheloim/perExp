#!/usr/bin/env python3
"""
Migration: Database structure improvements.

1. Add UniqueConstraint on group_members(group_id, user_id)
2. Add card_id FK to card_closings (backfill from card/bank strings)
3. Fix nullable user_id → NOT NULL on expenses, analysis_history, investments, card_closings, categories
4. Add missing performance indexes
5. Add onboarding_completed to users
6. Drop whats_new_seen from users
7. Add encryption-related columns (telegram_chat_hash, description_search, expand encrypted columns)
8. Add card search columns (card_name_search, bank_search, holder_search)
9. Add scheduled expense search columns (description_search)
10. Migrate to HMAC columns and encrypt Account.name

Run with: python -m scripts.migrate_db_structure
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


def _constraint_exists(conn, constraint_name: str) -> bool:
    result = conn.execute(
        text(
            "SELECT EXISTS ("
            "  SELECT 1 FROM information_schema.table_constraints"
            "  WHERE constraint_name = :name"
            ")"
        ),
        {"name": constraint_name},
    )
    return result.scalar()


def _column_exists(conn, table_name: str, column_name: str) -> bool:
    """Check if a column exists in a table (PostgreSQL only)."""
    return conn.execute(
        text(
            "SELECT EXISTS ("
            "  SELECT 1 FROM information_schema.columns"
            "  WHERE table_name = :table AND column_name = :col"
            ")"
        ),
        {"table": table_name, "col": column_name},
    ).scalar()


def ensure_column(conn, table_name: str, column_name: str, column_type: str,
                  default: str | None = None, index: bool = False):
    """Add a column if it doesn't exist. Returns True if added."""
    if _column_exists(conn, table_name, column_name):
        print(f"  {table_name}.{column_name} already exists. Skipping.")
        return False
    default_clause = f" DEFAULT {default}" if default else ""
    conn.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_type}{default_clause}"))
    if index:
        idx_name = f"ix_{table_name}_{column_name}"
        conn.execute(text(f"CREATE INDEX {idx_name} ON {table_name} ({column_name})"))
    print(f"  Added {table_name}.{column_name} {column_type}.")
    return True


def drop_column(conn, table_name: str, column_name: str):
    """Drop a column if it exists. Returns True if dropped."""
    if not _column_exists(conn, table_name, column_name):
        print(f"    {table_name}.{column_name} already dropped. Skipping.")
        return False
    index_name = f"ix_{table_name}_{column_name}"
    try:
        conn.execute(text(f"DROP INDEX IF EXISTS {index_name}"))
    except Exception:
        pass
    conn.execute(text(f"ALTER TABLE {table_name} DROP COLUMN {column_name}"))
    print(f"    Dropped {table_name}.{column_name}")
    return True


def step1_unique_constraint(engine):
    """Add UNIQUE constraint on group_members(group_id, user_id)."""
    print("\n[Step 1/5] Adding unique constraint on group_members...")

    with engine.begin() as conn:
        dialect = engine.dialect.name

        if dialect == "postgresql":
            if _constraint_exists(conn, "uq_group_member"):
                print("  Constraint uq_group_member already exists. Skipping.")
            else:
                conn.execute(
                    text("""
                    ALTER TABLE group_members
                    ADD CONSTRAINT uq_group_member
                    UNIQUE (group_id, user_id)
                """)
                )
                print("  Added UNIQUE(group_id, user_id) constraint.")
        else:
            print("  Skipping — only supported on PostgreSQL.")


def step2_card_closing_card_id(engine):
    """Add card_id column to card_closings and backfill from card/bank strings."""
    print("\n[Step 2/5] Adding card_id to card_closings...")

    with engine.begin() as conn:
        dialect = engine.dialect.name

        added = ensure_column(conn, "card_closings", "card_id", "INTEGER")
        if not added:
            print("  card_id column already exists. Backfilling...")

        # Backfill: match card_closings to cards by (user_id, card_name, bank)
        result = conn.execute(
            text("""
            UPDATE card_closings cc
            SET card_id = c.id
            FROM cards c
            WHERE cc.card_id IS NULL
            AND cc.user_id = c.user_id
            AND LOWER(TRIM(cc.card)) = LOWER(TRIM(c.card_name))
            AND LOWER(TRIM(COALESCE(cc.bank, ''))) = LOWER(TRIM(COALESCE(c.bank, '')))
        """)
        )
        print(f"  Backfilled {result.rowcount} card_closings with card_id.")

        # Add FK constraint (idempotent)
        if dialect == "postgresql":
            try:
                result = conn.execute(
                    text("SELECT 1 FROM pg_constraint WHERE conname = 'fk_card_closings_card_id'")
                )
                if result.fetchone():
                    print("  FK constraint already exists, skipping.")
                else:
                    conn.execute(
                        text("""
                        ALTER TABLE card_closings
                        ADD CONSTRAINT fk_card_closings_card_id
                        FOREIGN KEY (card_id) REFERENCES cards(id)
                    """)
                    )
                    print("  Added FK constraint.")
            except Exception as e:
                print(f"  FK constraint warning: {e}")


def step3_nullable_user_id(engine):
    """Fix nullable user_id columns to NOT NULL."""
    print("\n[Step 3/5] Fixing nullable user_id columns...")

    with engine.begin() as conn:
        dialect = engine.dialect.name

        tables = ["expenses", "analysis_history", "investments", "card_closings"]

        for table in tables:
            # Backfill NULL user_id with first seed user
            result = conn.execute(
                text(f"""
                UPDATE {table}
                SET user_id = (
                    SELECT id FROM users ORDER BY id LIMIT 1
                )
                WHERE user_id IS NULL
            """)
            )
            if result.rowcount > 0:
                print(f"  {table}: backfilled {result.rowcount} rows with seed user_id.")

            # Set NOT NULL
            if dialect == "postgresql":
                try:
                    conn.execute(
                        text(f"""
                        ALTER TABLE {table}
                        ALTER COLUMN user_id SET NOT NULL
                    """)
                    )
                    print(f"  {table}.user_id → NOT NULL.")
                except Exception as e:
                    print(f"  {table}: could not set NOT NULL — {e}")
            elif dialect == "sqlite":
                print(f"  {table}: skipping NOT NULL (SQLite limited ALTER TABLE support).")


def step4_indexes(engine):
    """Add missing performance indexes."""
    print("\n[Step 4/5] Adding missing indexes...")

    indices = [
        # Expenses - individual FK indexes
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

    with engine.begin() as conn:
        for idx_name, table, columns in indices:
            cols = ", ".join(columns)
            sql = f"CREATE INDEX IF NOT EXISTS {idx_name} ON {table} ({cols})"
            try:
                conn.execute(text(sql))
                print(f"  Created {idx_name}.")
            except Exception as e:
                print(f"  {idx_name}: {e}")


def step5_onboarding_completed(engine):
    """Add onboarding_completed column to users table."""
    print("\n[Step 5/5] Adding onboarding_completed to users...")

    with engine.begin() as conn:
        if engine.dialect.name != "postgresql":
            print("  Skipping — only supported on PostgreSQL.")
            return
        ensure_column(conn, "users", "onboarding_completed", "BOOLEAN", default="FALSE")


def step6_drop_whats_new_seen(engine):
    """Drop whats_new_seen column from users table."""
    print("\n[Step 6] Dropping whats_new_seen column...")

    with engine.begin() as conn:
        if engine.dialect.name != "postgresql":
            print("  Skipping — only supported on PostgreSQL.")
            return
        drop_column(conn, "users", "whats_new_seen")


def step7_encryption_columns(engine):
    """Add columns needed for field-level encryption."""
    print("\n[Step 7/10] Adding encryption-related columns...")

    with engine.begin() as conn:
        if engine.dialect.name != "postgresql":
            print("  Skipping — only supported on PostgreSQL.")
            return

        # Add telegram_chat_hash to users
        if ensure_column(conn, "users", "telegram_chat_hash", "VARCHAR(64)"):
            conn.execute(
                text(
                    "CREATE UNIQUE INDEX ix_users_telegram_chat_hash ON users (telegram_chat_hash) WHERE telegram_chat_hash IS NOT NULL"
                )
            )
            print("  Added unique index on telegram_chat_hash.")

        # Add description_search to expenses
        if ensure_column(conn, "expenses", "description_search", "VARCHAR"):
            conn.execute(
                text("CREATE INDEX ix_expenses_description_search ON expenses (description_search)")
            )
            print("  Added index on description_search.")

        # Expand column sizes for encrypted data
        print("  Expanding column sizes for encrypted data...")

        # audit_logs.ip_address: VARCHAR(45) -> TEXT
        conn.execute(text("ALTER TABLE audit_logs ALTER COLUMN ip_address TYPE TEXT"))
        print("    audit_logs.ip_address -> TEXT")

        # audit_logs.user_agent: VARCHAR(500) -> TEXT
        conn.execute(text("ALTER TABLE audit_logs ALTER COLUMN user_agent TYPE TEXT"))
        print("    audit_logs.user_agent -> TEXT")

        # users.mfa_secret: VARCHAR(32) -> TEXT
        conn.execute(text("ALTER TABLE users ALTER COLUMN mfa_secret TYPE TEXT"))
        print("    users.mfa_secret -> TEXT")

        # users.telegram_chat_id: TEXT (already TEXT, but let's be safe)
        # users.full_name: TEXT (already TEXT)
        # cards columns: TEXT (already TEXT)
        # expenses columns: TEXT (already TEXT)
        # investments.notes: TEXT (already TEXT)
        # monthly_reports.report_data: TEXT (already TEXT)


def step8_card_search_columns(engine):
    """Add search columns for encrypted Card fields."""
    print("\n[Step 8/10] Adding Card search columns...")

    with engine.begin() as conn:
        if engine.dialect.name != "postgresql":
            print("  Skipping — only supported on PostgreSQL.")
            return

        for column in ["card_name_search", "bank_search", "holder_search"]:
            ensure_column(conn, "cards", column, "VARCHAR", index=True)


def step9_scheduled_expense_search_columns(engine):
    """Add search columns for encrypted ScheduledExpense fields."""
    print("\n[Step 9/10] Adding ScheduledExpense search columns...")

    with engine.begin() as conn:
        if engine.dialect.name != "postgresql":
            print("  Skipping — only supported on PostgreSQL.")
            return

        if ensure_column(conn, "scheduled_expenses", "description_search", "VARCHAR"):
            conn.execute(
                text(
                    "CREATE INDEX ix_scheduled_expenses_description_search ON scheduled_expenses (description_search)"
                )
            )
            print("  Added index on description_search.")


def step10_hmac_migration(engine):
    """Migrate from search columns to HMAC columns and encrypt Account.name."""
    print("\n[Step 10/10] Migrating to HMAC columns and encrypting Account.name...")

    with engine.begin() as conn:
        dialect = engine.dialect.name

        if dialect != "postgresql":
            print("  Skipping — only supported on PostgreSQL.")
            return

        # 1. Drop old search columns (idempotent)
        print("  Dropping old search columns...")
        for table, column in [
            ("expenses", "description_search"),
            ("scheduled_expenses", "description_search"),
            ("cards", "card_name_search"),
            ("cards", "bank_search"),
            ("cards", "holder_search"),
        ]:
            drop_column(conn, table, column)

        # 2. Add new HMAC columns (idempotent)
        print("  Adding new HMAC columns...")
        for table, column in [
            ("expenses", "description_hmac"),
            ("scheduled_expenses", "description_hmac"),
            ("cards", "card_name_hmac"),
            ("cards", "bank_hmac"),
            ("accounts", "name_hmac"),
        ]:
            ensure_column(conn, table, column, "VARCHAR(64)", index=True)

        # 3. Encrypt Account.name column (migrate from plain String to encrypted)
        print("  Encrypting Account.name column...")
        from app.services.encryption import encrypt_value, is_encrypted

        accounts = conn.execute(
            text("SELECT id, name FROM accounts WHERE name IS NOT NULL")
        ).fetchall()

        encrypted_count = 0
        for account_id, name in accounts:
            if name and not is_encrypted(name):
                encrypted_name = encrypt_value(name)
                conn.execute(
                    text("UPDATE accounts SET name = :name WHERE id = :id"),
                    {"name": encrypted_name, "id": account_id},
                )
                encrypted_count += 1

        if encrypted_count > 0:
            print(f"    Encrypted {encrypted_count} account names.")
        else:
            print("    All account names already encrypted.")

        # 4. Populate HMAC columns from encrypted data
        print("  Populating HMAC columns from encrypted data...")
        from app.services.encryption import compute_hmac, decrypt_value

        # Expenses: description_hmac
        expenses = conn.execute(
            text(
                "SELECT id, description FROM expenses WHERE description IS NOT NULL AND description_hmac IS NULL"
            )
        ).fetchall()

        hmac_count = 0
        for expense_id, description in expenses:
            if description:
                try:
                    decrypted = decrypt_value(description)
                    hmac_value = compute_hmac(decrypted)
                    conn.execute(
                        text("UPDATE expenses SET description_hmac = :hmac WHERE id = :id"),
                        {"hmac": hmac_value, "id": expense_id},
                    )
                    hmac_count += 1
                except Exception as e:
                    print(f"    Warning: Could not process expense {expense_id}: {e}")

        print(f"    Populated {hmac_count} expense description_hmac values.")

        # Scheduled expenses: description_hmac
        scheduled = conn.execute(
            text(
                "SELECT id, description FROM scheduled_expenses WHERE description IS NOT NULL AND description_hmac IS NULL"
            )
        ).fetchall()

        hmac_count = 0
        for se_id, description in scheduled:
            if description:
                try:
                    decrypted = decrypt_value(description)
                    hmac_value = compute_hmac(decrypted)
                    conn.execute(
                        text(
                            "UPDATE scheduled_expenses SET description_hmac = :hmac WHERE id = :id"
                        ),
                        {"hmac": hmac_value, "id": se_id},
                    )
                    hmac_count += 1
                except Exception as e:
                    print(f"    Warning: Could not process scheduled expense {se_id}: {e}")

        print(f"    Populated {hmac_count} scheduled_expenses description_hmac values.")

        # Cards: card_name_hmac and bank_hmac
        cards = conn.execute(
            text("SELECT id, card_name, bank FROM cards WHERE card_name_hmac IS NULL")
        ).fetchall()

        hmac_count = 0
        for card_id, card_name, bank in cards:
            try:
                if card_name:
                    decrypted_name = decrypt_value(card_name)
                    conn.execute(
                        text("UPDATE cards SET card_name_hmac = :hmac WHERE id = :id"),
                        {"hmac": compute_hmac(decrypted_name.lower()), "id": card_id},
                    )
                if bank:
                    decrypted_bank = decrypt_value(bank)
                    conn.execute(
                        text("UPDATE cards SET bank_hmac = :hmac WHERE id = :id"),
                        {"hmac": compute_hmac(decrypted_bank.lower()), "id": card_id},
                    )
                hmac_count += 1
            except Exception as e:
                print(f"    Warning: Could not process card {card_id}: {e}")

        print(f"    Populated {hmac_count} card HMAC values.")

        # Accounts: name_hmac
        accounts = conn.execute(
            text("SELECT id, name FROM accounts WHERE name IS NOT NULL AND name_hmac IS NULL")
        ).fetchall()

        hmac_count = 0
        for account_id, name in accounts:
            if name:
                try:
                    decrypted = decrypt_value(name)
                    hmac_value = compute_hmac(decrypted.strip().lower())
                    conn.execute(
                        text("UPDATE accounts SET name_hmac = :hmac WHERE id = :id"),
                        {"hmac": hmac_value, "id": account_id},
                    )
                    hmac_count += 1
                except Exception as e:
                    print(f"    Warning: Could not process account {account_id}: {e}")

        print(f"    Populated {hmac_count} account name_hmac values.")


def main():
    engine = get_engine()

    print("=" * 60)
    print("Migration: Database Structure Improvements")
    print("=" * 60)

    step1_unique_constraint(engine)
    step2_card_closing_card_id(engine)
    step3_nullable_user_id(engine)
    step4_indexes(engine)
    step5_onboarding_completed(engine)
    step6_drop_whats_new_seen(engine)
    step7_encryption_columns(engine)
    step8_card_search_columns(engine)
    step9_scheduled_expense_search_columns(engine)
    step10_hmac_migration(engine)
    step11_recurring_source_column(engine)
    step12_admin_panel(engine)
    step13_platform_logs(engine)
    step14_recurring_expense_link(engine)
    step15_whats_new_dismissed_version(engine)
    step16_google_oauth_columns(engine)

    print("\n" + "=" * 60)
    print("Migration complete!")
    print("=" * 60)


def step11_recurring_source_column(engine):
    """Add source column to recurring_expenses and auto_detected_banner_dismissed_at to users."""
    with engine.begin() as conn:
        if engine.dialect.name != "postgresql":
            print("  Skipping — only supported on PostgreSQL.")
            return

        print("[Step 11/11] Adding recurring source column and user banner dismissed...")

        if ensure_column(conn, "recurring_expenses", "source", "VARCHAR(20)", default="'manual'"):
            conn.execute(
                text("CREATE INDEX ix_recurring_expenses_source ON recurring_expenses (source)")
            )
            print("  Added index on source.")

        ensure_column(conn, "users", "auto_detected_banner_dismissed_at", "TIMESTAMP NULL")


def step12_admin_panel(engine):
    """Add admin fields to users, create impersonation tables, generate admin slug."""
    import secrets

    with engine.begin() as conn:
        dialect = engine.dialect.name
        if dialect != "postgresql":
            print("  Skipping — only supported on PostgreSQL.")
            return

        print("[Step 12/12] Adding admin panel support...")

        # 1. Add admin columns to users
        for col, col_type in [
            ("is_admin", "BOOLEAN DEFAULT FALSE"),
            ("is_blocked", "BOOLEAN DEFAULT FALSE"),
            ("blocked_at", "TIMESTAMP NULL"),
            ("blocked_reason", "TEXT NULL"),
        ]:
            ensure_column(conn, "users", col, col_type)

        # 2. Set is_admin=True for admin@nikofin.com
        seed_email = os.getenv("SEED_USER_EMAIL", "admin@nikofin.com")
        result = conn.execute(
            text("UPDATE users SET is_admin = TRUE WHERE email = :email AND is_admin = FALSE"),
            {"email": seed_email},
        )
        if result.rowcount > 0:
            print(f"  Set is_admin=True for {seed_email}.")
        else:
            print(f"  {seed_email} already is admin or not found.")

        # 3. Create impersonation_sessions table
        conn.execute(
            text("""
            CREATE TABLE IF NOT EXISTS impersonation_sessions (
                id SERIAL PRIMARY KEY,
                admin_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                target_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                status VARCHAR(20) DEFAULT 'pending',
                token VARCHAR(512),
                expires_at TIMESTAMP,
                ended_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT NOW()
            )
        """)
        )
        conn.execute(
            text("""
            CREATE INDEX IF NOT EXISTS ix_impersonation_sessions_admin_id
            ON impersonation_sessions (admin_id)
        """)
        )
        print("  Created impersonation_sessions table.")

        # 4. Create impersonation_messages table
        conn.execute(
            text("""
            CREATE TABLE IF NOT EXISTS impersonation_messages (
                id SERIAL PRIMARY KEY,
                session_id INTEGER NOT NULL REFERENCES impersonation_sessions(id) ON DELETE CASCADE,
                sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                message TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT NOW()
            )
        """)
        )
        conn.execute(
            text("""
            CREATE INDEX IF NOT EXISTS ix_impersonation_messages_session_id
            ON impersonation_messages (session_id)
        """)
        )
        print("  Created impersonation_messages table.")

        # 5. Generate admin_panel_slug if not exists
        existing = conn.execute(
            text("SELECT value FROM settings WHERE key = 'admin_panel_slug'")
        ).scalar()
        if existing:
            print(f"  admin_panel_slug already exists: {existing}")
        else:
            slug = secrets.token_urlsafe(24)[:32]
            conn.execute(
                text("INSERT INTO settings (key, value) VALUES ('admin_panel_slug', :slug)"),
                {"slug": slug},
            )
            print(f"  Generated admin_panel_slug: {slug}")


def step13_platform_logs(engine):
    """Create platform_logs table for centralized WARNING+ log storage."""
    with engine.begin() as conn:
        dialect = engine.dialect.name
        if dialect != "postgresql":
            print("  Skipping — only supported on PostgreSQL.")
            return

        print("[Step 13/13] Creating platform_logs table...")

        conn.execute(
            text("""
            CREATE TABLE IF NOT EXISTS platform_logs (
                id SERIAL PRIMARY KEY,
                level VARCHAR(10) NOT NULL,
                module VARCHAR(100) NOT NULL,
                message TEXT NOT NULL,
                details TEXT,
                created_at TIMESTAMP DEFAULT NOW()
            )
        """)
        )
        conn.execute(
            text("""
            CREATE INDEX IF NOT EXISTS ix_platform_logs_level_created
            ON platform_logs (level, created_at)
        """)
        )
        conn.execute(
            text("""
            CREATE INDEX IF NOT EXISTS ix_platform_logs_created_at
            ON platform_logs (created_at)
        """)
        )
        print("  Created platform_logs table with indexes.")


def step14_recurring_expense_link(engine):
    """Add recurring_expense_id FK to expenses table."""
    with engine.begin() as conn:
        if engine.dialect.name != "postgresql":
            print("  Skipping — only supported on PostgreSQL.")
            return

        print("[Step 14/14] Adding recurring_expense_id to expenses...")

        if ensure_column(conn, "expenses", "recurring_expense_id", "INTEGER"):
            conn.execute(
                text("""
                ALTER TABLE expenses
                ADD CONSTRAINT fk_expenses_recurring_expense_id
                FOREIGN KEY (recurring_expense_id) REFERENCES recurring_expenses(id)
                ON DELETE RESTRICT
            """)
            )
            conn.execute(
                text(
                    "CREATE INDEX ix_expenses_recurring_expense_id ON expenses (recurring_expense_id)"
                )
            )
            print("  Added FK (RESTRICT) and index.")


def step15_whats_new_dismissed_version(engine):
    """Add whats_new_dismissed_version column to users table."""
    print("\n[Step 15] Adding whats_new_dismissed_version to users...")

    with engine.begin() as conn:
        if engine.dialect.name != "postgresql":
            print("  Skipping — only supported on PostgreSQL.")
            return
        ensure_column(conn, "users", "whats_new_dismissed_version", "VARCHAR(20)")


def step16_google_oauth_columns(engine):
    """Add google_refresh_token and google_refresh_token_hmac to users table."""
    print("\n[Step 16] Adding Google OAuth columns to users...")

    with engine.begin() as conn:
        if engine.dialect.name != "postgresql":
            print("  Skipping — only supported on PostgreSQL.")
            return

        ensure_column(conn, "users", "google_refresh_token", "TEXT")
        ensure_column(conn, "users", "google_refresh_token_hmac", "VARCHAR(64)", index=True)


if __name__ == "__main__":
    main()
