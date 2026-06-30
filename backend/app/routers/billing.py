from datetime import date

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User
from app.routers.groups import get_group_user_ids
from app.services.auth import get_current_user
from app.services.date_utils import (
    get_billing_period_for_card,
    get_billing_periods_history,
    get_current_billing_periods,
)

router = APIRouter(prefix="/billing", tags=["billing"])


class BillingPeriodResponse(BaseModel):
    card_id: int
    card_name: str
    bank: str
    holder: str
    period_start: date | None = None
    period_end: date | None = None
    label: str | None = None
    is_predicted: bool = False


class BillingPeriodDetail(BaseModel):
    start: date
    end: date
    label: str
    is_predicted: bool = False


@router.get("/current", response_model=list[BillingPeriodResponse])
def current_billing_periods(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get current billing period for each credit card."""
    return get_current_billing_periods(db, current_user.id)


@router.get("/periods", response_model=list[BillingPeriodDetail])
def billing_periods(
    card_id: int,
    count: int = Query(default=6, ge=1, le=24),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get last N billing periods for a specific card."""
    uid_list = get_group_user_ids(current_user.id, db)

    from app.models import Card

    card = db.query(Card).filter(Card.id == card_id, Card.user_id.in_(uid_list)).first()
    if not card:
        return []

    return get_billing_periods_history(card_id, count, db)


@router.get("/period-for-date", response_model=BillingPeriodResponse)
def period_for_date(
    card_id: int,
    ref_date: date = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get the billing period that contains a specific date for a card."""
    if ref_date is None:
        ref_date = date.today()

    uid_list = get_group_user_ids(current_user.id, db)

    from app.models import Card

    card = db.query(Card).filter(Card.id == card_id, Card.user_id.in_(uid_list)).first()
    if not card:
        return None

    period = get_billing_period_for_card(card_id, ref_date, db)
    if period:
        start, end = period
        from app.services.date_utils import _format_period_label

        return BillingPeriodResponse(
            card_id=card.id,
            card_name=card.card_name,
            bank=card.bank,
            holder=card.holder,
            period_start=start,
            period_end=end,
            label=_format_period_label(start, end),
        )

    return BillingPeriodResponse(
        card_id=card.id,
        card_name=card.card_name,
        bank=card.bank,
        holder=card.holder,
    )
