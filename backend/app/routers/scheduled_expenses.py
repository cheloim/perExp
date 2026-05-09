from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime, date
from app.database import get_db
from app.models import ScheduledExpense, Expense, User, Category
from app.services.auth import get_current_user
from app.routers.groups import get_group_user_ids

router = APIRouter(prefix="/scheduled-expenses", tags=["scheduled-expenses"])


@router.get("")
def get_scheduled_expenses(
    status: str = "PENDING",
    installment_group_id: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    uid_list = get_group_user_ids(current_user.id, db)
    q = db.query(ScheduledExpense).filter(ScheduledExpense.user_id.in_(uid_list))

    if status:
        q = q.filter(ScheduledExpense.status == status)
    if installment_group_id:
        q = q.filter(ScheduledExpense.installment_group_id == installment_group_id)

    return q.order_by(ScheduledExpense.scheduled_date).all()


@router.post("/{id}/execute")
def execute_scheduled_expense(
    id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    uid_list = get_group_user_ids(current_user.id, db)
    scheduled = db.query(ScheduledExpense).filter(
        ScheduledExpense.id == id,
        ScheduledExpense.user_id.in_(uid_list)
    ).first()

    if not scheduled:
        raise HTTPException(404, "Cuota programada no encontrada")

    if scheduled.status != "PENDING":
        raise HTTPException(400, f"La cuota ya fue {scheduled.status.lower()}")

    # Crear expense
    expense = Expense(
        date=scheduled.scheduled_date,
        description=scheduled.description,
        amount=scheduled.amount,
        currency=scheduled.currency,
        card=scheduled.card,
        bank=scheduled.bank,
        person=scheduled.person,
        card_id=scheduled.card_id,
        account_id=scheduled.account_id,
        category_id=scheduled.category_id,
        transaction_id=scheduled.transaction_id,
        installment_number=scheduled.installment_number,
        installment_total=scheduled.installment_total,
        installment_group_id=scheduled.installment_group_id,
        user_id=scheduled.user_id,
        group_id=scheduled.group_id,
    )
    db.add(expense)
    db.flush()

    # Actualizar scheduled
    scheduled.status = "EXECUTED"
    scheduled.executed_expense_id = expense.id
    scheduled.executed_at = datetime.utcnow()

    db.commit()
    db.refresh(expense)

    return {"expense": expense, "scheduled": scheduled}


@router.put("/{id}")
def update_scheduled_expense(
    id: int,
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    uid_list = get_group_user_ids(current_user.id, db)
    scheduled = db.query(ScheduledExpense).filter(
        ScheduledExpense.id == id,
        ScheduledExpense.user_id.in_(uid_list)
    ).first()

    if not scheduled:
        raise HTTPException(404)
    if scheduled.status != "PENDING":
        raise HTTPException(400, "Solo se pueden editar cuotas pendientes")

    # Permitir editar: scheduled_date, amount, description, category_id
    allowed = ["scheduled_date", "amount", "description", "category_id"]
    for field in allowed:
        if field in payload:
            setattr(scheduled, field, payload[field])

    db.commit()
    db.refresh(scheduled)
    return scheduled


@router.delete("/{id}")
def cancel_scheduled_expense(
    id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    uid_list = get_group_user_ids(current_user.id, db)
    scheduled = db.query(ScheduledExpense).filter(
        ScheduledExpense.id == id,
        ScheduledExpense.user_id.in_(uid_list)
    ).first()

    if not scheduled:
        raise HTTPException(404)
    if scheduled.status != "PENDING":
        raise HTTPException(400, "Solo se pueden cancelar cuotas pendientes")

    scheduled.status = "CANCELLED"
    db.commit()

    return {"ok": True}
