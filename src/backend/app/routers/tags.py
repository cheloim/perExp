from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ExpenseTag, Tag, User
from app.routers.groups import get_group_user_ids
from app.schemas.tags import TagCreate, TagResponse, TagUpdate
from app.services.auth import get_current_user
from app.services.encryption import compute_hmac

router = APIRouter(prefix="/tags", tags=["tags"])

VALID_GROUPS = {"tarjeta", "cuenta", "otros"}
BLOCKED_GROUPS = {"categoria"}


def _tag_with_count(tag: Tag, count: int) -> dict:
    return {
        "id": tag.id,
        "name": tag.name,
        "color": tag.color,
        "group_name": tag.group_name,
        "card_id": tag.card_id,
        "account_id": tag.account_id,
        "category_id": tag.category_id,
        "expense_count": count,
    }


@router.get(
    "",
    response_model=list[TagResponse],
    summary="List user tags",
    description="Returns all tags for the user's family group with expense counts.",
)
def get_tags(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    uid_list = get_group_user_ids(current_user.id, db)
    tags = db.query(Tag).filter(Tag.user_id.in_(uid_list)).order_by(Tag.group_name, Tag.name).all()
    tag_ids = [t.id for t in tags]
    counts: dict[int, int] = {}
    if tag_ids:
        rows = (
            db.query(ExpenseTag.tag_id, func.count(ExpenseTag.expense_id))
            .filter(ExpenseTag.tag_id.in_(tag_ids))
            .group_by(ExpenseTag.tag_id)
            .all()
        )
        counts = {tag_id: cnt for tag_id, cnt in rows}
    return [_tag_with_count(t, counts.get(t.id, 0)) for t in tags]


@router.post(
    "",
    response_model=TagResponse,
    summary="Create a tag",
    description="Creates a new tag. Group 'categoria' is system-managed and cannot be created manually.",
)
def create_tag(
    tag: TagCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if tag.group_name in BLOCKED_GROUPS:
        raise HTTPException(400, "El grupo 'categoria' es gestionado por el sistema.")

    group = tag.group_name if tag.group_name in VALID_GROUPS else "otros"

    name_hmac = compute_hmac(tag.name.strip().lower())
    existing = (
        db.query(Tag)
        .filter(
            Tag.user_id == current_user.id,
            Tag.name_hmac == name_hmac,
            Tag.group_name != "categoria",
        )
        .first()
    )
    if existing:
        raise HTTPException(
            409,
            detail={
                "error": "tag_exists",
                "message": "Ya existe un tag con ese nombre.",
                "existing_id": existing.id,
            },
        )

    from app.services.tag_sync import pick_tag_color

    color = tag.color if tag.color != "#6366f1" else pick_tag_color(db, current_user.id)

    db_tag = Tag(
        name=tag.name,
        name_hmac=name_hmac,
        color=color,
        group_name=group,
        card_id=tag.card_id,
        account_id=tag.account_id,
        user_id=current_user.id,
    )
    db.add(db_tag)
    db.commit()
    db.refresh(db_tag)
    return _tag_with_count(db_tag, 0)


@router.put(
    "/{tag_id}",
    response_model=TagResponse,
    summary="Update a tag",
    description="Updates a tag's name, color, group, or linked card/account. Cannot change to 'categoria' group.",
)
def update_tag(
    tag_id: int,
    tag: TagUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    db_tag = db.query(Tag).filter(Tag.id == tag_id, Tag.user_id == current_user.id).first()
    if not db_tag:
        raise HTTPException(404, "Tag no encontrado")
    if db_tag.group_name == "categoria":
        raise HTTPException(400, "Los tags de categoría no se pueden editar directamente.")

    if tag.name is not None:
        new_hmac = compute_hmac(tag.name.strip().lower())
        dup = (
            db.query(Tag)
            .filter(
                Tag.user_id == current_user.id,
                Tag.name_hmac == new_hmac,
                Tag.id != tag_id,
                Tag.group_name != "categoria",
            )
            .first()
        )
        if dup:
            raise HTTPException(
                409,
                detail={
                    "error": "tag_exists",
                    "message": "Ya existe otro tag con ese nombre.",
                    "existing_id": dup.id,
                },
            )
        db_tag.name = tag.name
        db_tag.name_hmac = new_hmac
    if tag.color is not None:
        db_tag.color = tag.color
    if tag.group_name is not None:
        if tag.group_name in BLOCKED_GROUPS:
            raise HTTPException(400, "No se puede mover a grupo 'categoria'.")
        db_tag.group_name = tag.group_name if tag.group_name in VALID_GROUPS else "otros"
    if tag.card_id is not None:
        db_tag.card_id = tag.card_id
        if db_tag.group_name not in ("tarjeta", "otros"):
            db_tag.group_name = "tarjeta"
    if tag.account_id is not None:
        db_tag.account_id = tag.account_id
        if db_tag.group_name not in ("cuenta", "otros"):
            db_tag.group_name = "cuenta"

    db.commit()
    db.refresh(db_tag)
    count = (
        db.query(func.count(ExpenseTag.expense_id)).filter(ExpenseTag.tag_id == db_tag.id).scalar()
    )
    return _tag_with_count(db_tag, count)


@router.delete(
    "/{tag_id}",
    summary="Delete a tag",
    description="Deletes a tag and removes all expense-tag associations.",
)
def delete_tag(
    tag_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    db_tag = db.query(Tag).filter(Tag.id == tag_id, Tag.user_id == current_user.id).first()
    if not db_tag:
        raise HTTPException(404, "Tag no encontrado")
    if db_tag.group_name == "categoria":
        raise HTTPException(
            400, "Los tags de categoría se eliminan desde la gestión de categorías."
        )
    db.query(ExpenseTag).filter(ExpenseTag.tag_id == tag_id).delete()
    db.delete(db_tag)
    db.commit()
    return {"ok": True}
