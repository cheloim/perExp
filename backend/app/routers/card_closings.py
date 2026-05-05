from typing import List, Optional

import pandas as pd
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import CardClosing
from app.schemas import CardClosingResponse

router = APIRouter(prefix="/card-closings", tags=["card-closings"])


@router.get("", response_model=List[CardClosingResponse])
def get_card_closings(db: Session = Depends(get_db)):
    return db.query(CardClosing).order_by(CardClosing.closing_date.desc()).all()


@router.post("", response_model=CardClosingResponse)
def create_card_closing(
    card: str,
    bank: str,
    closing_date: str,
    next_closing_date: Optional[str] = None,
    due_date: Optional[str] = None,
    db: Session = Depends(get_db),
):
    closing = CardClosing(
        card=card,
        bank=bank,
        closing_date=pd.to_datetime(closing_date, dayfirst=True).date(),
        next_closing_date=pd.to_datetime(next_closing_date, dayfirst=True).date() if next_closing_date else None,
        due_date=pd.to_datetime(due_date, dayfirst=True).date() if due_date else None,
    )
    db.add(closing)
    db.commit()
    db.refresh(closing)
    return closing
