"""API endpoints for recurring expenses (subscriptions)."""

from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import RecurringExpense
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
