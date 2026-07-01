import pandas as pd
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Card, CardClosing, User
from app.schemas import CardClosingResponse
from app.services.auth import get_current_user

router = APIRouter(prefix="/card-closings", tags=["card-closings"])


@router.get("", response_model=list[CardClosingResponse])
def get_card_closings(
    card_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(CardClosing).filter(CardClosing.user_id == current_user.id)
    if card_id is not None:
        q = q.filter(CardClosing.card_id == card_id)
    return q.order_by(CardClosing.closing_date.desc()).all()


@router.post("", response_model=CardClosingResponse)
def create_card_closing(
    card: str,
    bank: str,
    closing_date: str,
    next_closing_date: str | None = None,
    due_date: str | None = None,
    card_id: int | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    resolved_card_id = card_id

    # Auto-match card by name + bank if card_id not provided
    if not resolved_card_id and card and bank:
        matched = (
            db.query(Card)
            .filter(
                Card.user_id == current_user.id,
                Card.card_name.ilike(f"%{card}%"),
                Card.bank.ilike(f"%{bank}%"),
            )
            .first()
        )
        if matched:
            resolved_card_id = matched.id

    closing = CardClosing(
        card_id=resolved_card_id,
        card=card,
        bank=bank,
        closing_date=pd.to_datetime(closing_date, dayfirst=True).date(),
        next_closing_date=pd.to_datetime(next_closing_date, dayfirst=True).date()
        if next_closing_date
        else None,
        due_date=pd.to_datetime(due_date, dayfirst=True).date() if due_date else None,
        user_id=current_user.id,
    )
    db.add(closing)
    db.commit()
    db.refresh(closing)
    return closing
