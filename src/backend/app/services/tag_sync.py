"""Central tag synchronization service.

Single point of truth for:
- Category ↔ Tag A mirror (dual-write)
- Tag assignment with single-select enforcement per group (B/C)
- Group-aware tag validation

Called by all expense write paths (API, bots, imports, scheduled execution).
"""

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import Category, Expense, ExpenseTag, Tag
from app.services.encryption import compute_hmac

VALID_GROUPS = {"categoria", "tarjeta", "cuenta", "otros"}
SYSTEM_GROUPS = {"categoria", "tarjeta", "cuenta"}
SINGLE_SELECT_GROUPS = {"tarjeta", "cuenta"}


def get_or_create_mirror_tag(db: Session, category: Category) -> Tag:
    """Get or create the mirror Tag (group A) for a Category."""
    existing = (
        db.query(Tag)
        .filter(
            Tag.user_id == category.user_id,
            Tag.category_id == category.id,
            Tag.group_name == "categoria",
        )
        .first()
    )
    if existing:
        if existing.name != category.name or existing.color != category.color:
            existing.name = category.name
            existing.name_hmac = compute_hmac(category.name.strip().lower())
            existing.color = category.color
        return existing

    tag = Tag(
        name=category.name,
        name_hmac=compute_hmac(category.name.strip().lower()),
        color=category.color,
        group_name="categoria",
        user_id=category.user_id,
        category_id=category.id,
    )
    db.add(tag)
    db.flush()
    return tag


def remove_mirror_tag(db: Session, category_id: int):
    """Delete the mirror tag for a Category (CASCADE removes expense_tags)."""
    db.query(Tag).filter(Tag.category_id == category_id, Tag.group_name == "categoria").delete()
    db.flush()


def sync_category_tag(db: Session, expense: Expense, category_id: int | None):
    """Sync the mirror A-tag on an expense when its category changes.

    Removes existing A-tag, assigns new one if category_id is set.
    """
    db.query(ExpenseTag).filter(ExpenseTag.expense_id == expense.id).join(
        Tag, Tag.id == ExpenseTag.tag_id
    ).filter(Tag.group_name == "categoria").delete(synchronize_session=False)

    if category_id is not None:
        category = db.query(Category).filter(Category.id == category_id).first()
        if category:
            mirror = get_or_create_mirror_tag(db, category)
            existing = (
                db.query(ExpenseTag)
                .filter(
                    ExpenseTag.expense_id == expense.id,
                    ExpenseTag.tag_id == mirror.id,
                )
                .first()
            )
            if not existing:
                db.add(ExpenseTag(expense_id=expense.id, tag_id=mirror.id))


def assign_tags_validated(
    db: Session,
    expense_id: int,
    tag_ids: list[int],
    user_id: int,
    uid_list: list[int] | None = None,
) -> list[Tag]:
    """Validate and assign tags to an expense with group enforcement.

    - Groups tarjeta/cuenta: single-select (replaces existing in that group)
    - Group categoria: blocked (assigned only via sync_category_tag)
    - Group otros: multi-select
    - Ownership: tag must belong to uid_list (group-wide)
    """
    if not tag_ids:
        return []

    check_ids = uid_list or [user_id]
    tags = db.query(Tag).filter(Tag.id.in_(tag_ids), Tag.user_id.in_(check_ids)).all()
    found_ids = {t.id for t in tags}
    missing = set(tag_ids) - found_ids
    if missing:
        from fastapi import HTTPException

        raise HTTPException(404, f"Tags no encontrados: {missing}")

    for tag in tags:
        if tag.group_name == "categoria":
            from fastapi import HTTPException

            raise HTTPException(
                400,
                "Los tags de categoría se asignan automáticamente vía la categoría del gasto.",
            )

    for tag in tags:
        if tag.group_name in SINGLE_SELECT_GROUPS:
            existing_in_group = (
                db.query(ExpenseTag)
                .join(Tag, Tag.id == ExpenseTag.tag_id)
                .filter(
                    ExpenseTag.expense_id == expense_id,
                    Tag.group_name == tag.group_name,
                    Tag.id != tag.id,
                )
                .all()
            )
            for et in existing_in_group:
                db.delete(et)

    for tag in tags:
        existing = (
            db.query(ExpenseTag)
            .filter(
                ExpenseTag.expense_id == expense_id,
                ExpenseTag.tag_id == tag.id,
            )
            .first()
        )
        if not existing:
            db.add(ExpenseTag(expense_id=expense_id, tag_id=tag.id))

    db.flush()
    return tags


def remove_tags_by_group(db: Session, expense_id: int, group_name: str):
    """Remove all tags of a specific group from an expense."""
    db.query(ExpenseTag).filter(ExpenseTag.expense_id == expense_id).join(
        Tag, Tag.id == ExpenseTag.tag_id
    ).filter(Tag.group_name == group_name).delete(synchronize_session=False)
    db.flush()


def count_tags_by_group(db: Session, user_id: int) -> dict[str, int]:
    """Count tags per group for a user."""
    rows = (
        db.query(Tag.group_name, func.count(Tag.id))
        .filter(Tag.user_id == user_id)
        .group_by(Tag.group_name)
        .all()
    )
    return {g: c for g, c in rows}
