from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from datetime import datetime
from app.database import get_db
from app.models import Card, User
from app.services.auth import get_current_user

router = APIRouter(prefix="/cards", tags=["cards"])


class CardCreate(BaseModel):
    name: str
    bank: str = ""
    last4_digits: str | None = None
    card_type: str = "credito"  # credito, debito


class CardUpdate(BaseModel):
    name: str | None = None
    bank: str | None = None
    last4_digits: str | None = None
    card_type: str | None = None


class CardResponse(BaseModel):
    id: int
    name: str
    bank: str
    last4_digits: str | None
    card_type: str
    user_id: int
    created_at: datetime

    class Config:
        from_attributes = True


@router.get("", response_model=list[CardResponse])
def list_cards(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all cards for the current user"""
    cards = db.query(Card).filter(Card.user_id == current_user.id).all()
    return cards


@router.post("", response_model=CardResponse, status_code=201)
def create_card(
    card: CardCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a new card"""
    db_card = Card(
        name=card.name,
        bank=card.bank,
        last4_digits=card.last4_digits,
        card_type=card.card_type,
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
    db_card = db.query(Card).filter(
        Card.id == card_id,
        Card.user_id == current_user.id,
    ).first()

    if not db_card:
        raise HTTPException(status_code=404, detail="Card not found")

    update_data = card.model_dump(exclude_none=True)
    for key, value in update_data.items():
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
    db_card = db.query(Card).filter(
        Card.id == card_id,
        Card.user_id == current_user.id,
    ).first()

    if not db_card:
        raise HTTPException(status_code=404, detail="Card not found")

    # Check if card has expenses
    from app.models import Expense
    has_expenses = db.query(Expense).filter(Expense.card_id == card_id).first()
    if has_expenses:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete card with associated expenses"
        )

    db.delete(db_card)
    db.commit()
    return None
