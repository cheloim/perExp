"""Backfill: create Tags from existing Cards and Accounts, assign to expenses.

Creates one Tag per Card (name="Tarjeta {bank} {card_name}") and per Account
(name="Cuenta {name}"), then assigns the corresponding tag to every expense
that has a card_id or account_id.

Idempotent: skips existing tags (matched by name_hmac). Supports --dry-run.

Usage:
    python scripts/backfill_tags_from_cards_accounts.py [--dry-run] [--batch-size 500]
"""

import argparse
import sys

from app.database import SessionLocal, engine
from app.models import Account, Card, Expense, ExpenseTag, Tag
from app.services.encryption import compute_hmac

TAG_COLORS = [
    "#6366f1",  # indigo
    "#8b5cf6",  # violet
    "#ec4899",  # pink
    "#f59e0b",  # amber
    "#10b981",  # emerald
    "#3b82f6",  # blue
    "#ef4444",  # red
    "#14b8a6",  # teal
    "#f97316",  # orange
    "#84cc16",  # lime
]


def _color_for_index(i: int) -> str:
    return TAG_COLORS[i % len(TAG_COLORS)]


def _build_card_tag_name(card: Card) -> str:
    bank = getattr(card.bank, "decrypt", lambda: card.bank)() if card.bank else ""
    card_name = getattr(card.card_name, "decrypt", lambda: card.card_name)()
    parts = []
    if bank:
        parts.append(str(bank))
    if card_name:
        parts.append(str(card_name))
    return f"Tarjeta {' '.join(parts)}".strip()


def _build_account_tag_name(account: Account) -> str:
    name = getattr(account.name, "decrypt", lambda: account.name)()
    return f"Cuenta {name}"


def backfill(dry_run: bool = False, batch_size: int = 500):
    db = SessionLocal()
    try:
        # Ensure tables exist
        Tag.__table__.create(bind=engine, checkfirst=True)
        ExpenseTag.__table__.create(bind=engine, checkfirst=True)

        users_seen: set[int] = set()
        tags_created = 0
        links_created = 0
        skipped_existing = 0

        # --- Pass 1: Create tags from Cards ---
        cards = db.query(Card).all()
        print(f"Found {len(cards)} cards to process.")
        color_idx = 0
        for card in cards:
            tag_name = _build_card_tag_name(card)
            name_hmac = compute_hmac(tag_name.strip().lower())
            existing = (
                db.query(Tag)
                .filter(Tag.user_id == card.user_id, Tag.name_hmac == name_hmac)
                .first()
            )
            if existing:
                skipped_existing += 1
                # Ensure card_id link is set
                if not existing.card_id:
                    existing.card_id = card.id
                    if not dry_run:
                        db.flush()
                continue

            tag = Tag(
                name=tag_name,
                name_hmac=name_hmac,
                color=_color_for_index(color_idx),
                user_id=card.user_id,
                card_id=card.id,
            )
            color_idx += 1
            if not dry_run:
                db.add(tag)
                db.flush()
            tags_created += 1
            users_seen.add(card.user_id)
            print(f"  [Card] Created tag: '{tag_name}' (user {card.user_id})")

        # --- Pass 2: Create tags from Accounts ---
        accounts = db.query(Account).all()
        print(f"Found {len(accounts)} accounts to process.")
        for account in accounts:
            tag_name = _build_account_tag_name(account)
            name_hmac = compute_hmac(tag_name.strip().lower())
            existing = (
                db.query(Tag)
                .filter(Tag.user_id == account.user_id, Tag.name_hmac == name_hmac)
                .first()
            )
            if existing:
                skipped_existing += 1
                if not existing.account_id:
                    existing.account_id = account.id
                    if not dry_run:
                        db.flush()
                continue

            tag = Tag(
                name=tag_name,
                name_hmac=name_hmac,
                color=_color_for_index(color_idx),
                user_id=account.user_id,
                account_id=account.id,
            )
            color_idx += 1
            if not dry_run:
                db.add(tag)
                db.flush()
            tags_created += 1
            users_seen.add(account.user_id)
            print(f"  [Account] Created tag: '{tag_name}' (user {account.user_id})")

        if not dry_run:
            db.commit()

        # --- Pass 3: Assign tags to expenses ---
        print(f"\nAssigning tags to expenses (batch_size={batch_size})...")
        # Build lookup: (user_id, card_id) -> tag_id and (user_id, account_id) -> tag_id
        all_tags = db.query(Tag).all()
        card_tag_map: dict[tuple[int, int], int] = {}
        account_tag_map: dict[tuple[int, int], int] = {}
        for t in all_tags:
            if t.card_id:
                card_tag_map[(t.user_id, t.card_id)] = t.id
            if t.account_id:
                account_tag_map[(t.user_id, t.account_id)] = t.id

        # Find expenses with card_id or account_id that don't have tags yet
        expenses_with_card = (
            db.query(Expense)
            .filter(Expense.card_id.isnot(None))
            .all()
        )
        expenses_with_account = (
            db.query(Expense)
            .filter(Expense.account_id.isnot(None), Expense.card_id.is_(None))
            .all()
        )

        # Get existing expense_tags to avoid duplicates
        existing_pairs: set[tuple[int, int]] = set()
        rows = db.query(ExpenseTag.expense_id, ExpenseTag.tag_id).all()
        existing_pairs = {(r[0], r[1]) for r in rows}

        batch: list[ExpenseTag] = []
        for exp in expenses_with_card:
            tag_id = card_tag_map.get((exp.user_id, exp.card_id))
            if tag_id and (exp.id, tag_id) not in existing_pairs:
                batch.append(ExpenseTag(expense_id=exp.id, tag_id=tag_id))
                existing_pairs.add((exp.id, tag_id))
                if len(batch) >= batch_size:
                    if not dry_run:
                        db.add_all(batch)
                        db.commit()
                    links_created += len(batch)
                    print(f"  Committed {links_created} expense-tag links...")
                    batch = []

        for exp in expenses_with_account:
            tag_id = account_tag_map.get((exp.user_id, exp.account_id))
            if tag_id and (exp.id, tag_id) not in existing_pairs:
                batch.append(ExpenseTag(expense_id=exp.id, tag_id=tag_id))
                existing_pairs.add((exp.id, tag_id))
                if len(batch) >= batch_size:
                    if not dry_run:
                        db.add_all(batch)
                        db.commit()
                    links_created += len(batch)
                    print(f"  Committed {links_created} expense-tag links...")
                    batch = []

        if batch:
            if not dry_run:
                db.add_all(batch)
                db.commit()
            links_created += len(batch)

        print(f"\n{'[DRY RUN] ' if dry_run else ''}Summary:")
        print(f"  Tags created:    {tags_created}")
        print(f"  Tags existing:   {skipped_existing}")
        print(f"  Links created:   {links_created}")
        print(f"  Users processed: {len(users_seen)}")

    except Exception as e:
        db.rollback()
        print(f"ERROR: {e}", file=sys.stderr)
        raise
    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Backfill tags from cards/accounts")
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing")
    parser.add_argument("--batch-size", type=int, default=500, help="Commit batch size")
    args = parser.parse_args()
    backfill(dry_run=args.dry_run, batch_size=args.batch_size)
