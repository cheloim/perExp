"""Null out category parent links that cross users (issue #481).

``parent_id`` was never validated at write time, so rows can point into
another user's tree: the hierarchical labels ("Padre > Hijo") fed the
assistant, the monthly report and the Telegram bot with foreign category
names. Writes are validated now and reads only follow same-owner parents, but
the links themselves are still corrupt — this drops them.

Run once against the target database:

    python scripts/migrate_fix_foreign_category_parents.py           # dry run
    python scripts/migrate_fix_foreign_category_parents.py --apply

Cycles are out of scope here: writes reject them now and reads walk them
cycle-safe, so they cannot hurt anything.
"""

from __future__ import annotations

import argparse

from sqlalchemy.orm import Session

from app.models import Category


def fix_foreign_parents(db: Session, apply: bool = False) -> list[tuple[int, int]]:
    """Return (child_id, parent_id) links whose owners differ.

    With ``apply``, the links are set to NULL. Without it, nothing is written.
    """
    from sqlalchemy.orm import aliased

    parent = aliased(Category)
    broken = (
        db.query(Category.id, Category.parent_id)
        .join(parent, parent.id == Category.parent_id)
        .filter(parent.user_id != Category.user_id)
        .all()
    )
    links = [(int(child_id), int(parent_id)) for child_id, parent_id in broken]
    if apply and links:
        for child_id, _ in links:
            db.query(Category).filter(Category.id == child_id).update(
                {"parent_id": None}, synchronize_session=False
            )
        db.commit()
    return links


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--apply", action="store_true", help="Write the fixes (default: dry run)")
    args = parser.parse_args()

    from app.database import SessionLocal

    db = SessionLocal()
    try:
        links = fix_foreign_parents(db, apply=args.apply)
    finally:
        db.close()

    verb = "Fixing" if args.apply else "Would fix"
    print(f"{verb} {len(links)} cross-user parent link(s)")
    for child_id, parent_id in links:
        print(f"  category {child_id} -> parent {parent_id}")
    if not args.apply and links:
        print("Dry run: re-run with --apply to write.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
