"""Migration: Consolidate tarjeta→cuenta, canonical names, dedup, fix orphan mirrors.

Fixes inconsistencies from the Issue 199 tags migration:
1. Renames group_name='tarjeta' → 'cuenta'
2. Strips "Tarjeta "/"Cuenta " prefixes from tag names (canonical: "{bank} {card_name}")
3. Deduplicates tags by (user_id, card_id) and (user_id, account_id)
4. Repairs mirror tags orphaned by the Bug B (update_expense wiping mirrors)

Usage:
    python scripts/migrate_fix_tag_groups.py [--dry-run] [--batch-size 500]
"""

import argparse
import sys

from sqlalchemy import text

from app.database import SessionLocal
from app.models import ExpenseTag, Tag
from app.services.encryption import compute_hmac


def rename_tarjeta_group(db, dry_run=False):
    """Rename group_name='tarjeta' → 'cuenta'."""
    print("Renaming group 'tarjeta' → 'cuenta'...")
    result = db.execute(
        text("UPDATE tags SET group_name='cuenta' WHERE group_name='tarjeta'")
    )
    count = result.rowcount
    if not dry_run:
        db.commit()
    print(f"  Renamed {count} tags.")


def strip_name_prefixes(db, dry_run=False):
    """Strip 'Tarjeta '/'Cuenta ' prefixes from tag names, recalculate hmac."""
    print("Stripping name prefixes...")
    tags = (
        db.query(Tag)
        .filter(
            Tag.group_name == "cuenta",
            Tag.card_id.isnot(None) | Tag.account_id.isnot(None),
        )
        .all()
    )
    updated = 0
    for t in tags:
        name = str(t.name) if hasattr(t.name, "decrypt") else (t.name or "")
        new_name = name
        if t.card_id and name.lower().startswith("tarjeta "):
            new_name = name[8:].strip()
        elif t.account_id and name.lower().startswith("cuenta "):
            new_name = name[7:].strip()
        if new_name and new_name != name:
            new_hmac = compute_hmac(new_name.strip().lower())
            collision = (
                db.query(Tag)
                .filter(
                    Tag.user_id == t.user_id,
                    Tag.name_hmac == new_hmac,
                    Tag.id != t.id,
                    Tag.group_name != "categoria",
                )
                .first()
            )
            if not collision:
                t.name = new_name
                t.name_hmac = new_hmac
                updated += 1
    if not dry_run:
        db.commit()
    print(f"  Renamed {updated} tags.")


def deduplicate_by_link(db, dry_run=False):
    """Deduplicate tags by (user_id, card_id) and (user_id, account_id)."""
    print("Deduplicating tags by card/account link...")
    removed = 0

    for link_col in ("card_id", "account_id"):
        col = getattr(Tag, link_col)
        linked = db.query(Tag).filter(col.isnot(None), Tag.group_name == "cuenta").all()
        seen: dict[tuple[int, int], Tag] = {}
        for t in linked:
            key = (t.user_id, getattr(t, link_col))
            if key in seen:
                survivor = seen[key]
                if t.id == survivor.id:
                    continue
                # Collect expense_ids from duplicate before deleting
                dup_expense_ids = [
                    r[0] for r in db.query(ExpenseTag.expense_id).filter(ExpenseTag.tag_id == t.id).all()
                ]
                survivor_expense_ids = set(
                    r[0] for r in db.query(ExpenseTag.expense_id).filter(ExpenseTag.tag_id == survivor.id).all()
                )
                if not dry_run:
                    # Delete duplicate tag (CASCADE removes its expense_tags)
                    db.query(ExpenseTag).filter(ExpenseTag.tag_id == t.id).delete(synchronize_session=False)
                    db.delete(t)
                    db.flush()
                    # Re-link expenses that didn't already have the survivor
                    for eid in dup_expense_ids:
                        if eid not in survivor_expense_ids:
                            db.add(ExpenseTag(expense_id=eid, tag_id=survivor.id))
                removed += 1
            else:
                seen[key] = t
    if not dry_run:
        db.commit()
    print(f"  Removed {removed} duplicate tags.")


def deduplicate_by_name(db, dry_run=False):
    """Deduplicate non-categoria tags by (user_id, name_hmac), keeping the linked one."""
    print("Deduplicating tags by name_hmac (non-categoria)...")
    tags = db.query(Tag).filter(Tag.group_name != "categoria").all()
    seen: dict[tuple[int, str], Tag] = {}
    removed = 0
    for t in tags:
        key = (t.user_id, t.name_hmac)
        if key in seen:
            survivor = seen[key]
            if t.id == survivor.id:
                continue
            # Prefer the one with a card/account link
            has_link = t.card_id or t.account_id
            survivor_has_link = survivor.card_id or survivor.account_id
            if has_link and not survivor_has_link:
                # Swap: t is better
                survivor, t = t, survivor
                seen[key] = survivor
            # Collect expense_ids from duplicate before deleting
            dup_expense_ids = [
                r[0] for r in db.query(ExpenseTag.expense_id).filter(ExpenseTag.tag_id == t.id).all()
            ]
            survivor_expense_ids = set(
                r[0] for r in db.query(ExpenseTag.expense_id).filter(ExpenseTag.tag_id == survivor.id).all()
            )
            if not dry_run:
                db.query(ExpenseTag).filter(ExpenseTag.tag_id == t.id).delete(synchronize_session=False)
                db.delete(t)
                db.flush()
                for eid in dup_expense_ids:
                    if eid not in survivor_expense_ids:
                        db.add(ExpenseTag(expense_id=eid, tag_id=survivor.id))
            removed += 1
        else:
            seen[key] = t
    if not dry_run:
        db.commit()
    print(f"  Removed {removed} name-duplicate tags.")


def repair_orphan_mirrors(db, dry_run=False):
    """Re-create mirror expense_tags for expenses that lost them (Bug B)."""
    print("Repairing orphan mirror tags...")
    from app.models import Category, Expense
    from app.services.tag_sync import get_or_create_mirror_tag

    expenses = (
        db.query(Expense)
        .filter(Expense.category_id.isnot(None))
        .all()
    )
    repaired = 0
    for e in expenses:
        existing_mirror_link = (
            db.query(ExpenseTag)
            .join(Tag, Tag.id == ExpenseTag.tag_id)
            .filter(
                ExpenseTag.expense_id == e.id,
                Tag.group_name == "categoria",
                Tag.category_id == e.category_id,
            )
            .first()
        )
        if existing_mirror_link:
            continue
        cat = db.query(Category).filter(Category.id == e.category_id).first()
        if not cat:
            continue
        mirror = get_or_create_mirror_tag(db, cat)
        if mirror is None:
            continue
        if not dry_run:
            db.add(ExpenseTag(expense_id=e.id, tag_id=mirror.id))
        repaired += 1
    if not dry_run:
        db.commit()
    print(f"  Repaired {repaired} orphan mirror links.")


def backfill(dry_run=False, batch_size=500):
    db = SessionLocal()
    try:
        rename_tarjeta_group(db, dry_run)
        strip_name_prefixes(db, dry_run)
        deduplicate_by_link(db, dry_run)
        deduplicate_by_name(db, dry_run)
        repair_orphan_mirrors(db, dry_run)

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
    parser = argparse.ArgumentParser(description="Fix tag groups migration")
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing")
    parser.add_argument("--batch-size", type=int, default=500)
    args = parser.parse_args()
    backfill(dry_run=args.dry_run, batch_size=args.batch_size)
