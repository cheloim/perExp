"""Cleanup: remove legacy Card/Account entities after tag backfill.

After backfill_tags_from_cards_accounts creates cuenta tags and assigns them
to expenses, the old Card/Account tables are no longer needed. This script:
1. SETs NULL card_id/account_id on ALL referencing tables
2. Deletes all Card and Account rows

Usage:
    python scripts/cleanup_legacy_cards_accounts.py [--dry-run]
"""

import argparse
import sys

from sqlalchemy import text

from app.database import SessionLocal


# Tables with card_id FK → cards
CARD_TABLES = ["expenses", "tags", "card_closings", "scheduled_expenses", "recurring_expenses"]
# Tables with account_id FK → accounts
ACCOUNT_TABLES = ["expenses", "tags", "scheduled_expenses", "recurring_expenses"]


def cleanup(dry_run=False):
    db = SessionLocal()
    try:
        # Count before
        cards = db.execute(text("SELECT count(*) FROM cards")).scalar()
        accounts = db.execute(text("SELECT count(*) FROM accounts")).scalar()

        print(f"Before cleanup:")
        print(f"  Cards: {cards}, Accounts: {accounts}")

        for table in CARD_TABLES:
            count = db.execute(text(f"SELECT count(*) FROM {table} WHERE card_id IS NOT NULL")).scalar()
            if count:
                print(f"  {table} with card_id: {count}")

        for table in ACCOUNT_TABLES:
            count = db.execute(text(f"SELECT count(*) FROM {table} WHERE account_id IS NOT NULL")).scalar()
            if count:
                print(f"  {table} with account_id: {count}")

        linked = db.execute(text("SELECT count(*) FROM cards WHERE linked_account_id IS NOT NULL")).scalar()
        if linked:
            print(f"  cards with linked_account_id: {linked}")

        if dry_run:
            print("\n[DRY RUN] Would clean up all references and delete cards/accounts.")
            return

        # 1. Clear card_id FK references on ALL tables
        for table in CARD_TABLES:
            db.execute(text(f"UPDATE {table} SET card_id = NULL WHERE card_id IS NOT NULL"))

        # 2. Clear Card.linked_account_id before deleting accounts
        db.execute(text("UPDATE cards SET linked_account_id = NULL WHERE linked_account_id IS NOT NULL"))

        # 3. Clear account_id FK references on ALL tables
        for table in ACCOUNT_TABLES:
            db.execute(text(f"UPDATE {table} SET account_id = NULL WHERE account_id IS NOT NULL"))

        # 4. Delete cards and accounts
        db.execute(text("DELETE FROM cards"))
        db.execute(text("DELETE FROM accounts"))

        db.commit()

        # Verify
        cards_after = db.execute(text("SELECT count(*) FROM cards")).scalar()
        accounts_after = db.execute(text("SELECT count(*) FROM accounts")).scalar()
        print(f"\nCleanup complete:")
        print(f"  Cards: {cards} → {cards_after}")
        print(f"  Accounts: {accounts} → {accounts_after}")
        print(f"  All card_id/account_id references set to NULL")

    except Exception as e:
        db.rollback()
        print(f"ERROR: {e}", file=sys.stderr)
        raise
    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Cleanup legacy cards/accounts")
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing")
    args = parser.parse_args()
    cleanup(dry_run=args.dry_run)
