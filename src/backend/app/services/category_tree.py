"""Category tree integrity (issue #481).

``parent_id`` is user-supplied and was not validated at write time, so rows
can point into another user's tree and the hierarchical labels ("Padre >
Hijo") that feed the assistant, the monthly report and the Telegram bot would
then read foreign category names.

Writes now reject foreign parents (``routers/categories.py``), but rows
written before the fix may still carry them, so every parent resolution goes
through here: a parent only belongs to the tree when it shares its owner with
the child, and the walk is bounded so a cycle can never loop forever.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.models import Category


def parent_of(child: Category, db: Session) -> Category | None:
    """The child's parent, or None when absent or owned by someone else."""
    if not child.parent_id:
        return None
    parent = db.query(Category).filter(Category.id == child.parent_id).first()
    if parent is None or parent.user_id != child.user_id:
        return None
    return parent


def ancestors_of(cat: Category, db: Session) -> list[Category]:
    """The cat's ancestors, closest first: same-owner only and cycle-safe."""
    chain: list[Category] = []
    seen = {cat.id}
    node = cat
    while True:
        parent = parent_of(node, db)
        if parent is None or parent.id in seen:
            break
        chain.append(parent)
        seen.add(parent.id)
        node = parent
    return chain
