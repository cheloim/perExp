#!/usr/bin/env python3
"""
Migration: Add budget system tables and columns.

Tables:
- budgets: Per-category monthly budgets
- budget_groups: 50/30/20 macro groups
- budget_events: Temporary event budgets

Columns:
- categories.budget_group: Maps categories to macro groups

Run with: python -m scripts.migrate_add_budgets
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
    print("Migration: Add budget system tables and columns")
    print("=" * 60)

    with engine.begin() as conn:
        dialect = engine.dialect.name

        if dialect == "postgresql":
            # ─── 1. Create budgets table ─────────────────────────────
            print("\n[1/5] Creating budgets table...")
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS budgets (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
                    amount DOUBLE PRECISION NOT NULL,
                    alert_threshold DOUBLE PRECISION DEFAULT 0.80,
                    rollover BOOLEAN DEFAULT FALSE,
                    is_active BOOLEAN DEFAULT TRUE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP
                )
            """))
            print("  budgets table OK")

            # ─── 2. Create budget_groups table ────────────────────────
            print("\n[2/5] Creating budget_groups table...")
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS budget_groups (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    name VARCHAR(20) NOT NULL,
                    display_name VARCHAR(50) NOT NULL,
                    percentage DOUBLE PRECISION NOT NULL,
                    amount DOUBLE PRECISION DEFAULT 0,
                    spent DOUBLE PRECISION DEFAULT 0,
                    is_active BOOLEAN DEFAULT TRUE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP
                )
            """))
            print("  budget_groups table OK")

            # ─── 3. Create budget_events table ────────────────────────
            print("\n[3/5] Creating budget_events table...")
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS budget_events (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    name VARCHAR(100) NOT NULL,
                    start_date DATE NOT NULL,
                    end_date DATE NOT NULL,
                    total_amount DOUBLE PRECISION NOT NULL,
                    spent DOUBLE PRECISION DEFAULT 0,
                    categories TEXT DEFAULT '[]',
                    is_active BOOLEAN DEFAULT TRUE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP
                )
            """))
            print("  budget_events table OK")

            # ─── 4. Add budget_group column to categories ─────────────
            print("\n[4/5] Adding budget_group column to categories...")
            has_column = conn.execute(text("""
                SELECT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'categories' AND column_name = 'budget_group'
                )
            """)).scalar()

            if not has_column:
                conn.execute(text("""
                    ALTER TABLE categories ADD COLUMN budget_group VARCHAR(20) DEFAULT 'necesidades'
                """))
                print("  budget_group column added")
            else:
                print("  budget_group column already exists")

            # ─── 5. Create indexes ────────────────────────────────────
            print("\n[5/5] Creating indexes...")
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_budgets_user_id ON budgets (user_id)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_budgets_category_id ON budgets (category_id)"))
            conn.execute(text("""
                CREATE UNIQUE INDEX IF NOT EXISTS uq_budget_user_cat
                ON budgets (user_id, category_id)
            """))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_budget_groups_user_id ON budget_groups (user_id)"))
            conn.execute(text("""
                CREATE UNIQUE INDEX IF NOT EXISTS uq_budget_group_user_name
                ON budget_groups (user_id, name)
            """))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_budget_events_user_id ON budget_events (user_id)"))
            print("  All indexes OK")

            # ─── Verification ─────────────────────────────────────────
            print("\n[Verification] Checking all tables and columns...")
            tables = ["budgets", "budget_groups", "budget_events"]
            for table in tables:
                exists = conn.execute(text(f"""
                    SELECT EXISTS (
                        SELECT 1 FROM information_schema.tables
                        WHERE table_schema = 'public' AND table_name = '{table}'
                    )
                """)).scalar()
                if exists:
                    print(f"  ✓ {table} exists")
                else:
                    print(f"  ✗ {table} MISSING!")
                    raise RuntimeError(f"Table {table} was not created")

            # Check budget_group column
            has_bg = conn.execute(text("""
                SELECT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'categories' AND column_name = 'budget_group'
                )
            """)).scalar()
            if has_bg:
                print("  ✓ categories.budget_group exists")
            else:
                print("  ✗ categories.budget_group MISSING!")
                raise RuntimeError("Column budget_group was not added")

            # ─── 6. Auto-assign categories to macro groups ────────────────
            print("\n[6/6] Auto-assigning categories to macro groups...")
            try:
                conn.execute(text("""
                    UPDATE categories SET budget_group = 'gustos'
                    WHERE budget_group = 'necesidades'
                    AND LOWER(name) LIKE ANY(ARRAY[
                        '%entretenimiento%', '%cine%', '%teatro%', '%concierto%',
                        '%streaming%', '%netflix%', '%spotify%', '%disney%',
                        '%ropa%', '%indumentaria%', '%calzado%',
                        '%café%', '%cafetería%', '%bar%', '%restaurante%', '%resto%',
                        '%gimnasio%', '%deporte%', '%fitness%',
                        '%suscripciones%', '%revistas%',
                        '%viajes%', '%hotel%', '%aerolínea%', '%turismo%',
                        '%mascotas%', '%vacaciones%'
                    ])
                """))
                conn.execute(text("""
                    UPDATE categories SET budget_group = 'ahorro'
                    WHERE budget_group = 'necesidades'
                    AND LOWER(name) LIKE ANY(ARRAY[
                        '%inversiones%', '%inversión%', '%ahorro%',
                        '%plazo fijo%', '%fci%', '%bonos%', '%acciones%',
                        '%dólar%', '%crypto%'
                    ])
                """))
                conn.commit()
                print("  Categories auto-assigned to groups")
            except Exception as e:
                print(f"  Warning: auto-assign failed ({e}), skipping")

            # ─── 7. Deactivate Ahorro group if feature flag is off ─────────
            print("\n[7/7] Checking Ahorro feature flag...")
            ahorro_enabled = os.getenv("BUDGET_AHORRO_ENABLED", "false").lower() == "true"
            if not ahorro_enabled:
                try:
                    with engine.begin() as conn2:
                        conn2.execute(text(
                            "UPDATE budget_groups SET is_active = false WHERE name = 'ahorro' AND is_active = true"
                        ))
                    print("  Ahorro group deactivated (BUDGET_AHORRO_ENABLED=false)")
                except Exception as e:
                    print(f"  Warning: Ahorro deactivation failed ({e}), skipping")
            else:
                print("  Ahorro enabled, skipping")

            print("\nMigration complete!")

        else:
            print(f"Skipping migration for dialect '{dialect}' (PostgreSQL only).")

    print("=" * 60)


if __name__ == "__main__":
    main()
