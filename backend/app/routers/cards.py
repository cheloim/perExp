from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Card, User
from app.routers.groups import get_group_user_ids
from app.services.auth import get_current_user

router = APIRouter(prefix="/cards", tags=["cards"])


def get_first_name(full_name: str) -> str:
    """Extract first name from full_name. 'Perez, Juan' -> 'Juan', 'Juan Perez' -> 'Juan'"""
    if not full_name:
        return ""
    if "," in full_name:
        return full_name.split(",")[1].strip().split()[0] if len(full_name.split(",")) > 1 else ""
    return full_name.strip().split()[0] if full_name.strip() else ""


class CardCreate(BaseModel):
    card_name: str
    bank: str = ""
    holder: str = ""
    card_type: str = "credito"  # credito, debito
    closing_day: int | None = None  # Day of month card closes (1-31)


class CardUpdate(BaseModel):
    card_name: str | None = None
    bank: str | None = None
    holder: str | None = None
    card_type: str | None = None
    closing_day: int | None = None


class CardResponse(BaseModel):
    id: int
    card_name: str
    bank: str
    holder: str
    card_type: str
    closing_day: int | None = None
    user_id: int
    created_at: datetime

    class Config:
        from_attributes = True


@router.get("", response_model=list[CardResponse])
def list_cards(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all cards for the current user and group"""
    uid_list = get_group_user_ids(current_user.id, db)
    cards = db.query(Card).filter(Card.user_id.in_(uid_list)).all()
    return cards


@router.post("", response_model=CardResponse, status_code=201)
def create_card(
    card: CardCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a new card"""
    card_name = card.card_name.strip()
    bank = card.bank.strip() if card.bank else ""

    if not card_name or not bank:
        raise HTTPException(status_code=400, detail="Nombre y banco son obligatorios")

    existing_by_fields = (
        db.query(Card)
        .filter(
            Card.user_id == current_user.id,
            func.lower(func.trim(Card.card_name)) == card_name.lower(),
            func.lower(func.trim(Card.bank)) == bank.lower(),
            Card.card_type == card.card_type,
        )
        .first()
    )

    if existing_by_fields:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Ya existe una tarjeta con esos datos",
                "existing_id": existing_by_fields.id,
                "existing_card_name": existing_by_fields.card_name,
                "existing_bank": existing_by_fields.bank,
                "existing_card_type": existing_by_fields.card_type,
            },
        )

    holder = card.holder.strip() if card.holder else ""
    if not holder:
        holder = get_first_name(current_user.full_name or "")

    db_card = Card(
        card_name=card_name,
        bank=bank,
        holder=holder,
        card_type=card.card_type,
        closing_day=card.closing_day,
        user_id=current_user.id,
    )
    db.add(db_card)
    db.commit()
    db.refresh(db_card)
    return db_card


@router.put("/{card_id}", response_model=CardResponse)
def update_card(
    card_id: int,
    card: CardUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update a card"""
    db_card = (
        db.query(Card)
        .filter(
            Card.id == card_id,
            Card.user_id == current_user.id,
        )
        .first()
    )

    if not db_card:
        raise HTTPException(status_code=404, detail="Card not found")

    update_data = card.model_dump(exclude_none=True)

    for key, value in update_data.items():
        if isinstance(value, str):
            value = value.strip()
        setattr(db_card, key, value)

    db.commit()
    db.refresh(db_card)
    return db_card


@router.delete("/{card_id}", status_code=204)
def delete_card(
    card_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a card"""
    db_card = (
        db.query(Card)
        .filter(
            Card.id == card_id,
            Card.user_id == current_user.id,
        )
        .first()
    )

    if not db_card:
        raise HTTPException(status_code=404, detail="Card not found")

    # Check if card has expenses
    from app.models import Expense

    has_expenses = (
        db.query(Expense)
        .filter(
            Expense.card_id == card_id,
            Expense.user_id == current_user.id,
        )
        .first()
    )
    if has_expenses:
        raise HTTPException(status_code=400, detail="Cannot delete card with associated expenses")

    db.delete(db_card)
    db.commit()
    return None


@router.post("/sync-holders")
def sync_card_holders(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Sync holders: auto-assign holder from user's full_name for cards without one"""
    cards = db.query(Card).filter(Card.user_id == current_user.id).all()
    updated = 0

    for card in cards:
        if card.holder:
            continue

        card.holder = get_first_name(current_user.full_name or "")
        if card.holder:
            updated += 1

    db.commit()
    return {"updated": updated, "total_cards": len(cards)}
