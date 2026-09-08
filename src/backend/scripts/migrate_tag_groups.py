"""Migration: Tag groups (4-group model) + Category mirrors + classification.

Adds group_name and category_id to tags, classifies existing tags,
creates mirror tags for all categories (group A), and auto-links
unlinked payment tags to cards/accounts by name matching.

Usage:
    python scripts/migrate_tag_groups.py [--dry-run] [--batch-size 500]
"""

import argparse
import sys

from sqlalchemy import text

from app.database import SessionLocal, engine
from app.models import Account, Card, Category, Expense, ExpenseTag, Tag
from app.services.encryption import compute_hmac


def migrate_schema(db):
    """Add columns and indexes (idempotent)."""
    print("Adding group_name column to tags if missing...")
    db.execute(text(
        "DO $$ BEGIN "
        "  IF NOT EXISTS ("
        "    SELECT 1 FROM information_schema.columns "
        "    WHERE table_name='tags' AND column_name='group_name'"
        "  ) THEN "
        "    ALTER TABLE tags ADD COLUMN group_name VARCHAR(20) NOT NULL DEFAULT 'otros'; "
        "  END IF; "
        "END $$;"
    ))

    print("Adding category_id column to tags if missing...")
    db.execute(text(
        "DO $$ BEGIN "
        "  IF NOT EXISTS ("
        "    SELECT 1 FROM information_schema.columns "
        "    WHERE table_name='tags' AND column_name='category_id'"
        "  ) THEN "
        "    ALTER TABLE tags ADD COLUMN category_id INTEGER "
        "      REFERENCES categories(id) ON DELETE CASCADE; "
        "    CREATE INDEX IF NOT EXISTS ix_tags_category_id ON tags(category_id); "
        "  END IF; "
        "END $$;"
    ))

    print("Adding group_name index if missing...")
    db.execute(text(
        "DO $$ BEGIN "
        "  IF NOT EXISTS ("
        "    SELECT 1 FROM pg_indexes WHERE indexname='ix_tags_group_name'"
        "  ) THEN "
        "    CREATE INDEX ix_tags_group_name ON tags(group_name); "
        "  END IF; "
        "END $$;"
    ))

    print("Adding partial unique indexes for name collision safety...")
    db.execute(text(
        "DO $$ BEGIN "
        "  IF NOT EXISTS ("
        "    SELECT 1 FROM pg_indexes WHERE indexname='uq_tag_name_user_non_categoria'"
        "  ) THEN "
        "    CREATE UNIQUE INDEX uq_tag_name_user_non_categoria "
        "      ON tags(name_hmac, user_id) WHERE group_name != 'categoria'; "
        "  END IF; "
        "END $$;"
    ))
    db.execute(text(
        "DO $$ BEGIN "
        "  IF NOT EXISTS ("
        "    SELECT 1 FROM pg_indexes WHERE indexname='uq_tag_category_mirror'"
        "  ) THEN "
        "    CREATE UNIQUE INDEX uq_tag_category_mirror "
        "      ON tags(category_id, user_id) WHERE category_id IS NOT NULL; "
        "  END IF; "
        "END $$;"
    ))

    db.commit()
    print("Schema migration done.")


def classify_existing(db, dry_run=False):
    """Classify existing tags into groups based on links and name patterns."""
    print("Classifying existing tags...")
    tags = db.query(Tag).filter(Tag.group_name == "otros").all()
    updated = 0
    for t in tags:
        new_group = "otros"
        if t.card_id is not None:
            new_group = "tarjeta"
        elif t.account_id is not None:
            new_group = "cuenta"
        else:
            name_lower = (t.name or "").lower() if not hasattr(t.name, "decrypt") else str(t.name).lower()
            if name_lower.startswith("tarjeta "):
                new_group = "tarjeta"
            elif name_lower.startswith("cuenta "):
                new_group = "cuenta"
        if new_group != "otros":
            t.group_name = new_group
            updated += 1
    if not dry_run:
        db.commit()
    print(f"  Classified {updated} tags into payment groups.")


def auto_link_payment_tags(db, dry_run=False):
    """Try to link unlinked payment tags to cards/accounts by name matching."""
    print("Auto-linking payment tags to cards/accounts...")
    linked = 0

    unlinked_tarjeta = (
        db.query(Tag)
        .filter(Tag.group_name == "tarjeta", Tag.card_id.is_(None))
        .all()
    )
    for t in unlinked_tarjeta:
        t_name = str(t.name) if hasattr(t.name, "decrypt") else (t.name or "")
        t_name_lower = t_name.lower().replace("tarjeta ", "").strip()
        if not t_name_lower:
            continue
        cards = db.query(Card).filter(Card.user_id == t.user_id).all()
        for c in cards:
            c_name = str(c.card_name) if hasattr(c.card_name, "decrypt") else (c.card_name or "")
            c_bank = str(c.bank) if hasattr(c.bank, "decrypt") else (c.bank or "")
            combined = f"{c_bank} {c_name}".lower().strip()
            if t_name_lower in combined or combined in t_name_lower:
                t.card_id = c.id
                linked += 1
                break

    unlinked_cuenta = (
        db.query(Tag)
        .filter(Tag.group_name == "cuenta", Tag.account_id.is_(None))
        .all()
    )
    for t in unlinked_cuenta:
        t_name = str(t.name) if hasattr(t.name, "decrypt") else (t.name or "")
        t_name_lower = t_name.lower().replace("cuenta ", "").strip()
        if not t_name_lower:
            continue
        accounts = db.query(Account).filter(Account.user_id == t.user_id).all()
        for a in accounts:
            a_name = str(a.name) if hasattr(a.name, "decrypt") else (a.name or "")
            if t_name_lower in a_name.lower() or a_name.lower() in t_name_lower:
                t.account_id = a.id
                linked += 1
                break

    if not dry_run:
        db.commit()
    print(f"  Linked {linked} payment tags to cards/accounts.")


def create_category_mirrors(db, dry_run=False):
    """Create mirror tags (group A) for all existing categories."""
    print("Creating category mirror tags...")
    categories = db.query(Category).all()
    created = 0
    skipped = 0

    for cat in categories:
        existing = (
            db.query(Tag)
            .filter(
                Tag.user_id == cat.user_id,
                Tag.category_id == cat.id,
                Tag.group_name == "categoria",
            )
            .first()
        )
        if existing:
            skipped += 1
            continue

        name = cat.name if not hasattr(cat.name, "decrypt") else str(cat.name)
        tag = Tag(
            name=name,
            name_hmac=compute_hmac(name.strip().lower()),
            color=cat.color or "#6366f1",
            group_name="categoria",
            user_id=cat.user_id,
            category_id=cat.id,
        )
        db.add(tag)
        created += 1

    if not dry_run:
        db.commit()
    print(f"  Created {created} mirror tags, skipped {skipped} existing.")


def assign_mirror_tags_to_expenses(db, dry_run=False, batch_size=500):
    """Assign mirror A-tags to expenses that have category_id."""
    print("Assigning mirror tags to categorized expenses...")
    mirror_tags = db.query(Tag).filter(
        Tag.group_name == "categoria", Tag.category_id.isnot(None)
    ).all()
    cat_to_tag = {t.category_id: t.id for t in mirror_tags}

    expenses = (
        db.query(Expense)
        .filter(Expense.category_id.isnot(None))
        .all()
    )

    existing_links = set(
        db.query(ExpenseTag.expense_id, ExpenseTag.tag_id)
        .join(Tag, Tag.id == ExpenseTag.tag_id)
        .filter(Tag.group_name == "categoria")
        .all()
    )

    batch = []
    linked = 0
    for e in expenses:
        tag_id = cat_to_tag.get(e.category_id)
        if tag_id and (e.id, tag_id) not in existing_links:
            batch.append(ExpenseTag(expense_id=e.id, tag_id=tag_id))
            existing_links.add((e.id, tag_id))
            if len(batch) >= batch_size:
                if not dry_run:
                    db.add_all(batch)
                    db.commit()
                linked += len(batch)
                print(f"  Committed {linked} mirror links...")
                batch = []

    if batch:
        if not dry_run:
            db.add_all(batch)
            db.commit()
        linked += len(batch)

    print(f"  Assigned {linked} mirror tag links.")


def remove_category_name_collisions(db, dry_run=False):
    """Remove demo tags whose names collide with category names (dev data)."""
    print("Checking for category-name collisions in free tags...")
    categories = db.query(Category).all()
    cat_names = set()
    for c in categories:
        name = str(c.name) if hasattr(c.name, "decrypt") else (c.name or "")
        cat_names.add(name.strip().lower())

    free_tags = db.query(Tag).filter(
        Tag.group_name.in_(["otros", "tarjeta", "cuenta"]),
        Tag.category_id.is_(None),
    ).all()

    removed = 0
    for t in free_tags:
        t_name = str(t.name) if hasattr(t.name, "decrypt") else (t.name or "")
        if t_name.strip().lower() in cat_names and t.card_id is None and t.account_id is None:
            if not dry_run:
                db.query(ExpenseTag).filter(ExpenseTag.tag_id == t.id).delete()
                db.delete(t)
            removed += 1

    if not dry_run:
        db.commit()
    print(f"  Removed {removed} colliding free tags.")


def backfill(dry_run=False, batch_size=500):
    db = SessionLocal()
    try:
        migrate_schema(db)
        classify_existing(db, dry_run)
        auto_link_payment_tags(db, dry_run)
        create_category_mirrors(db, dry_run)
        assign_mirror_tags_to_expenses(db, dry_run, batch_size)
        remove_category_name_collisions(db, dry_run)

        print(f"\n{'[DRY RUN] ' if dry_run else ''}Migration complete.")
        from sqlalchemy import func
        total = db.query(func.count(Tag.id)).scalar()
        by_group = db.query(Tag.group_name, func.count(Tag.id)).group_by(Tag.group_name).all()
        print(f"  Total tags: {total}")
        for g, c in by_group:
            print(f"    {g}: {c}")
    except Exception as e:
        db.rollback()
        print(f"ERROR: {e}", file=sys.stderr)
        raise
    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Tag groups migration")
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing")
    parser.add_argument("--batch-size", type=int, default=500)
    args = parser.parse_args()
    backfill(dry_run=args.dry_run, batch_size=args.batch_size)
