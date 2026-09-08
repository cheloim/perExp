from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ExpenseTag, Tag, User
from app.schemas.tags import TagCreate, TagResponse, TagUpdate
from app.services.auth import get_current_user
from app.services.encryption import compute_hmac

router = APIRouter(prefix="/tags", tags=["tags"])


def _tag_with_count(tag: Tag, count: int) -> dict:
    return {
        "id": tag.id,
        "name": tag.name,
        "color": tag.color,
        "card_id": tag.card_id,
        "account_id": tag.account_id,
        "expense_count": count,
    }


@router.get(
    "",
    response_model=list[TagResponse],
    summary="List user tags",
    description="Returns all tags belonging to the current user with expense counts.",
)
def get_tags(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    tags = db.query(Tag).filter(Tag.user_id == current_user.id).order_by(Tag.name).all()
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
    description="Creates a new tag for the current user. Duplicate names (case-insensitive) are rejected with 409.",
)
def create_tag(
    tag: TagCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    name_hmac = compute_hmac(tag.name.strip().lower())
    existing = (
        db.query(Tag).filter(Tag.user_id == current_user.id, Tag.name_hmac == name_hmac).first()
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
    db_tag = Tag(
        name=tag.name,
        name_hmac=name_hmac,
        color=tag.color,
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
    description="Updates an existing tag's name, color, or linked card/account.",
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
    if tag.name is not None:
        new_hmac = compute_hmac(tag.name.strip().lower())
        dup = (
            db.query(Tag)
            .filter(
                Tag.user_id == current_user.id,
                Tag.name_hmac == new_hmac,
                Tag.id != tag_id,
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
    if tag.card_id is not None:
        db_tag.card_id = tag.card_id
    if tag.account_id is not None:
        db_tag.account_id = tag.account_id
    db.commit()
    db.refresh(db_tag)
    count = (
        db.query(func.count(ExpenseTag.expense_id)).filter(ExpenseTag.tag_id == db_tag.id).scalar()
    )
    return _tag_with_count(db_tag, count)


@router.delete(
    "/{tag_id}",
    summary="Delete a tag",
    description="Deletes a tag and removes all expense-tag associations. Does not delete the linked card/account.",
)
def delete_tag(
    tag_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    db_tag = db.query(Tag).filter(Tag.id == tag_id, Tag.user_id == current_user.id).first()
    if not db_tag:
        raise HTTPException(404, "Tag no encontrado")
    db.query(ExpenseTag).filter(ExpenseTag.tag_id == tag_id).delete()
    db.delete(db_tag)
    db.commit()
    return {"ok": True}
