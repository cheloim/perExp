"""Cleanup: remove legacy Card/Account entities after tag backfill.

After backfill_tags_from_cards_accounts creates cuenta tags and assigns them
to expenses, the old Card/Account tables are no longer needed. This script:
1. SETs NULL card_id/account_id on expenses (tags already hold the link)
2. SETs NULL card_id/account_id on tags (the tag name IS the identity now)
3. Deletes all Card and Account rows

Usage:
    python scripts/cleanup_legacy_cards_accounts.py [--dry-run]
"""

import argparse
import sys

from sqlalchemy import text

from app.database import SessionLocal


def cleanup(dry_run=False):
    db = SessionLocal()
    try:
        # Count before
        cards = db.execute(text("SELECT count(*) FROM cards")).scalar()
        accounts = db.execute(text("SELECT count(*) FROM accounts")).scalar()
        exp_card = db.execute(text("SELECT count(*) FROM expenses WHERE card_id IS NOT NULL")).scalar()
        exp_acc = db.execute(text("SELECT count(*) FROM expenses WHERE account_id IS NOT NULL")).scalar()
        tag_card = db.execute(text("SELECT count(*) FROM tags WHERE card_id IS NOT NULL")).scalar()
        tag_acc = db.execute(text("SELECT count(*) FROM tags WHERE account_id IS NOT NULL")).scalar()

        print(f"Before cleanup:")
        print(f"  Cards: {cards}, Accounts: {accounts}")
        print(f"  Expenses with card_id: {exp_card}, account_id: {exp_acc}")
        print(f"  Tags with card_id: {tag_card}, account_id: {tag_acc}")

        if dry_run:
            print("\n[DRY RUN] Would clean up all references and delete cards/accounts.")
            return

        # 1. Clear FK references on expenses
        db.execute(text("UPDATE expenses SET card_id = NULL WHERE card_id IS NOT NULL"))
        db.execute(text("UPDATE expenses SET account_id = NULL WHERE account_id IS NOT NULL"))

        # 2. Clear FK references on tags
        db.execute(text("UPDATE tags SET card_id = NULL WHERE card_id IS NOT NULL"))
        db.execute(text("UPDATE tags SET account_id = NULL WHERE account_id IS NOT NULL"))

        # 3. Delete cards and accounts
        db.execute(text("DELETE FROM cards"))
        db.execute(text("DELETE FROM accounts"))

        db.commit()

        # Verify
        cards_after = db.execute(text("SELECT count(*) FROM cards")).scalar()
        accounts_after = db.execute(text("SELECT count(*) FROM accounts")).scalar()
        print(f"\nCleanup complete:")
        print(f"  Cards: {cards} → {cards_after}")
        print(f"  Accounts: {accounts} → {accounts_after}")
        print(f"  All expense card_id/account_id set to NULL")
        print(f"  All tag card_id/account_id set to NULL")

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
