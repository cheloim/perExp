"""Backfill: create Tags from existing Cards and Accounts (group 'cuenta').

Creates one Tag per Card (name="{bank} {card_name}") and per Account
(name="{name}"), both in group 'cuenta', then assigns the corresponding
tag to every expense that has a card_id or account_id.

Dedup priority: (1) existing tag with same card_id/account_id, (2) name_hmac match.

Idempotent. Supports --dry-run.

Usage:
    python scripts/backfill_tags_from_cards_accounts.py [--dry-run] [--batch-size 500]
"""

import argparse
import sys

from app.database import SessionLocal, engine
from app.models import Account, Card, Expense, ExpenseTag, Tag
from app.services.encryption import compute_hmac
from app.services.tag_sync import pick_tag_color


def _build_card_tag_name(card: Card) -> str:
    bank = str(card.bank) if card.bank else ""
    card_name = str(card.card_name) if card.card_name else ""
    parts = [p for p in (bank, card_name) if p]
    return " ".join(parts).strip() or "Tarjeta sin nombre"


def _build_account_tag_name(account: Account) -> str:
    name = str(account.name) if account.name else ""
    return name or "Cuenta sin nombre"


def backfill(dry_run: bool = False, batch_size: int = 500):
    db = SessionLocal()
    try:
        Tag.__table__.create(bind=engine, checkfirst=True)
        ExpenseTag.__table__.create(bind=engine, checkfirst=True)

        users_seen: set[int] = set()
        tags_created = 0
        tags_reused = 0
        links_created = 0

        # --- Pass 1: Create tags from Cards ---
        cards = db.query(Card).all()
        print(f"Found {len(cards)} cards to process.")
        for card in cards:
            uid = card.user_id
            users_seen.add(uid)

            # Dedup by card_id
            existing = (
                db.query(Tag)
                .filter(Tag.user_id == uid, Tag.card_id == card.id)
                .first()
            )
            if existing:
                tags_reused += 1
                continue

            tag_name = _build_card_tag_name(card)
            name_hmac = compute_hmac(tag_name.strip().lower())

            # Dedup by name_hmac
            existing = (
                db.query(Tag)
                .filter(Tag.user_id == uid, Tag.name_hmac == name_hmac)
                .first()
            )
            if existing:
                if not existing.card_id:
                    existing.card_id = card.id
                    if existing.group_name != "cuenta":
                        existing.group_name = "cuenta"
                    if not dry_run:
                        db.flush()
                tags_reused += 1
                continue

            color = pick_tag_color(db, uid)
            tag = Tag(
                name=tag_name,
                name_hmac=name_hmac,
                color=color,
                group_name="cuenta",
                user_id=uid,
                card_id=card.id,
            )
            if not dry_run:
                db.add(tag)
                db.flush()
            tags_created += 1
            print(f"  [Card] Created tag: '{tag_name}' (user {uid})")

        # --- Pass 2: Create tags from Accounts ---
        accounts = db.query(Account).all()
        print(f"Found {len(accounts)} accounts to process.")
        for account in accounts:
            uid = account.user_id
            users_seen.add(uid)

            # Dedup by account_id
            existing = (
                db.query(Tag)
                .filter(Tag.user_id == uid, Tag.account_id == account.id)
                .first()
            )
            if existing:
                tags_reused += 1
                continue

            tag_name = _build_account_tag_name(account)
            name_hmac = compute_hmac(tag_name.strip().lower())

            # Dedup by name_hmac
            existing = (
                db.query(Tag)
                .filter(Tag.user_id == uid, Tag.name_hmac == name_hmac)
                .first()
            )
            if existing:
                if not existing.account_id:
                    existing.account_id = account.id
                    if existing.group_name != "cuenta":
                        existing.group_name = "cuenta"
                    if not dry_run:
                        db.flush()
                tags_reused += 1
                continue

            color = pick_tag_color(db, uid)
            tag = Tag(
                name=tag_name,
                name_hmac=name_hmac,
                color=color,
                group_name="cuenta",
                user_id=uid,
                account_id=account.id,
            )
            if not dry_run:
                db.add(tag)
                db.flush()
            tags_created += 1
            print(f"  [Account] Created tag: '{tag_name}' (user {uid})")

        if not dry_run:
            db.commit()

        # --- Pass 3: Assign tags to expenses ---
        print(f"\nAssigning tags to expenses (batch_size={batch_size})...")
        all_tags = db.query(Tag).filter(Tag.group_name == "cuenta").all()
        card_tag_map: dict[tuple[int, int], int] = {}
        account_tag_map: dict[tuple[int, int], int] = {}
        for t in all_tags:
            if t.card_id:
                card_tag_map[(t.user_id, t.card_id)] = t.id
            if t.account_id:
                account_tag_map[(t.user_id, t.account_id)] = t.id

        existing_pairs: set[tuple[int, int]] = set()
        rows = db.query(ExpenseTag.expense_id, ExpenseTag.tag_id).all()
        existing_pairs = {(r[0], r[1]) for r in rows}

        batch: list[ExpenseTag] = []

        expenses_with_card = db.query(Expense).filter(Expense.card_id.isnot(None)).all()
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

        expenses_with_account = (
            db.query(Expense)
            .filter(Expense.account_id.isnot(None), Expense.card_id.is_(None))
            .all()
        )
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
        print(f"  Tags reused:     {tags_reused}")
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
