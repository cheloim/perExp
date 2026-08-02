"""API endpoints for recurring expenses (subscriptions)."""

from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import RecurringExpense, User
from app.services.auth import get_current_user

router = APIRouter(prefix="/recurring", tags=["recurring"])


class RecurringResponse(BaseModel):
    id: int
    merchant_key: str
    description: str
    amount: float
    currency: str
    category_id: int | None = None
    card_id: int | None = None
    account_id: int | None = None
    frequency: str
    next_charge_date: date | None = None
    alert_days_before: int
    is_active: bool
    source: str = "manual"
    last_seen_at: datetime | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class RecurringUpdate(BaseModel):
    amount: float | None = None
    frequency: str | None = None
    next_charge_date: date | None = None
    alert_days_before: int | None = None
    is_active: bool | None = None
    category_id: int | None = None


class RecurringCreate(BaseModel):
    merchant_key: str
    description: str
    amount: float
    currency: str = "ARS"
    category_id: int | None = None
    card_id: int | None = None
    account_id: int | None = None
    frequency: str = "monthly"
    next_charge_date: date | None = None
    alert_days_before: int = 3


@router.get("", response_model=list[RecurringResponse])
def list_recurring(
    status: str = "active",
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """List recurring expenses. Status: active, paused, all."""
    q = db.query(RecurringExpense).filter(
        RecurringExpense.user_id == current_user.id,
    )
    if status == "active":
        q = q.filter(RecurringExpense.is_active == True)  # noqa: E712
    elif status == "paused":
        q = q.filter(RecurringExpense.is_active == False)  # noqa: E712

    return q.order_by(RecurringExpense.next_charge_date.asc().nullslast()).all()


@router.get("/auto-detected", response_model=list[RecurringResponse])
def list_auto_detected(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """List auto-detected recurring expenses (source=auto, active)."""
    return (
        db.query(RecurringExpense)
        .filter(
            RecurringExpense.user_id == current_user.id,
            RecurringExpense.source == "auto",
            RecurringExpense.is_active == True,  # noqa: E712
        )
        .order_by(RecurringExpense.created_at.desc())
        .all()
    )


@router.post("", response_model=RecurringResponse, status_code=201)
def create_recurring(
    data: RecurringCreate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Create a new recurring expense."""
    new = RecurringExpense(
        user_id=current_user.id,
        merchant_key=data.merchant_key,
        description=data.description,
        amount=data.amount,
        currency=data.currency,
        category_id=data.category_id,
        card_id=data.card_id,
        account_id=data.account_id,
        frequency=data.frequency,
        next_charge_date=data.next_charge_date,
        alert_days_before=data.alert_days_before,
        source="manual",
    )
    db.add(new)
    db.commit()
    db.refresh(new)
    return new


@router.put("/{recurring_id}", response_model=RecurringResponse)
def update_recurring(
    recurring_id: int,
    data: RecurringUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Update a recurring expense."""
    rec = (
        db.query(RecurringExpense)
        .filter(
            RecurringExpense.id == recurring_id,
            RecurringExpense.user_id == current_user.id,
        )
        .first()
    )
    if not rec:
        raise HTTPException(status_code=404, detail="Gasto recurrente no encontrado")

    update_data = data.model_dump(exclude_none=True)
    for k, v in update_data.items():
        setattr(rec, k, v)

    db.commit()
    db.refresh(rec)
    return rec


@router.post("/{recurring_id}/confirm", response_model=RecurringResponse)
def confirm_recurring(
    recurring_id: int,
    data: RecurringUpdate | None = None,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Confirm an auto-detected recurring expense (changes source to manual)."""
    rec = (
        db.query(RecurringExpense)
        .filter(
            RecurringExpense.id == recurring_id,
            RecurringExpense.user_id == current_user.id,
        )
        .first()
    )
    if not rec:
        raise HTTPException(status_code=404, detail="Gasto recurrente no encontrado")

    # Apply any edits if provided
    if data:
        update_data = data.model_dump(exclude_none=True)
        for k, v in update_data.items():
            setattr(rec, k, v)

    rec.source = "manual"
    db.commit()
    db.refresh(rec)
    return rec


@router.post("/{recurring_id}/pause")
def pause_recurring(
    recurring_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Toggle pause/resume for a recurring expense."""
    rec = (
        db.query(RecurringExpense)
        .filter(
            RecurringExpense.id == recurring_id,
            RecurringExpense.user_id == current_user.id,
        )
        .first()
    )
    if not rec:
        raise HTTPException(status_code=404, detail="Gasto recurrente no encontrado")

    rec.is_active = not rec.is_active
    db.commit()

    status = "activado" if rec.is_active else "pausado"
    return {"detail": f"Recurrente {status}", "is_active": rec.is_active}


@router.delete("/{recurring_id}")
def delete_recurring(
    recurring_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Permanently delete a recurring expense."""
    rec = (
        db.query(RecurringExpense)
        .filter(
            RecurringExpense.id == recurring_id,
            RecurringExpense.user_id == current_user.id,
        )
        .first()
    )
    if not rec:
        raise HTTPException(status_code=404, detail="Gasto recurrente no encontrado")

    db.delete(rec)
    db.commit()
    return {"detail": "Recurrente eliminado"}


@router.put("/dismiss-banner")
def dismiss_auto_detected_banner(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Dismiss the auto-detected recurring expenses banner."""
    user = db.query(User).filter(User.id == current_user.id).first()
    if user:
        user.auto_detected_banner_dismissed_at = datetime.utcnow()
        db.commit()
    return {"detail": "Banner dismissed"}
