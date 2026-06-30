from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Expense, ScheduledExpense, User
from app.routers.groups import get_group_user_ids
from app.services.auth import get_current_user
from app.services.date_utils import add_months

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

    scheduled = q.order_by(ScheduledExpense.scheduled_date).all()

    # If filtering by group, also project remaining installments
    if installment_group_id and status == "PENDING":
        existing_nums = {s.installment_number for s in scheduled}
        if scheduled:
            inst_total = scheduled[0].installment_total
            card_id = scheduled[0].card_id
            account_id = scheduled[0].account_id
            description = scheduled[0].description
            amount = scheduled[0].amount
            currency = scheduled[0].currency
            user_id = scheduled[0].user_id
        else:
            # Get info from Expenses
            exp = (
                db.query(Expense)
                .filter(
                    Expense.user_id.in_(uid_list),
                    Expense.installment_group_id == installment_group_id,
                )
                .order_by(Expense.installment_number.desc())
                .first()
            )
            if exp:
                inst_total = exp.installment_total or 0
                card_id = exp.card_id
                account_id = exp.account_id
                description = exp.description
                amount = abs(exp.amount)
                currency = exp.currency
                user_id = exp.user_id
            else:
                return scheduled

        # Find the last scheduled or paid date
        last_date = None
        if scheduled:
            last_date = max(s.scheduled_date for s in scheduled)
        else:
            last_exp = (
                db.query(Expense)
                .filter(
                    Expense.user_id.in_(uid_list),
                    Expense.installment_group_id == installment_group_id,
                )
                .order_by(Expense.date.desc())
                .first()
            )
            if last_exp:
                last_date = last_exp.date

        if last_date:
            # Project missing installments as virtual scheduled expenses
            next_date = add_months(last_date, 1)
            for i in range(1, inst_total + 1):
                if i in existing_nums:
                    continue
                projected_date = add_months(
                    next_date, i - (min(existing_nums) if existing_nums else 1)
                )
                # Only add if date is in the future
                if projected_date > date.today():
                    scheduled.append(
                        ScheduledExpense(
                            id=-i,  # Virtual ID (negative to avoid collision)
                            installment_group_id=installment_group_id,
                            installment_number=i,
                            installment_total=inst_total,
                            scheduled_date=projected_date,
                            amount=amount,
                            currency=currency,
                            description=description,
                            card_id=card_id,
                            account_id=account_id,
                            status="PENDING",
                            user_id=user_id,
                        )
                    )

    return scheduled


@router.post("/{id}/execute")
def execute_scheduled_expense(
    id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    uid_list = get_group_user_ids(current_user.id, db)
    scheduled = (
        db.query(ScheduledExpense)
        .filter(ScheduledExpense.id == id, ScheduledExpense.user_id.in_(uid_list))
        .first()
    )

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
        card_id=scheduled.card_id,
        account_id=scheduled.account_id,
        category_id=scheduled.category_id,
        transaction_id=scheduled.transaction_id,
        installment_number=scheduled.installment_number,
        installment_total=scheduled.installment_total,
        installment_group_id=scheduled.installment_group_id,
        user_id=scheduled.user_id,
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
    scheduled = (
        db.query(ScheduledExpense)
        .filter(ScheduledExpense.id == id, ScheduledExpense.user_id.in_(uid_list))
        .first()
    )

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
    scheduled = (
        db.query(ScheduledExpense)
        .filter(ScheduledExpense.id == id, ScheduledExpense.user_id.in_(uid_list))
        .first()
    )

    if not scheduled:
        raise HTTPException(404)
    if scheduled.status != "PENDING":
        raise HTTPException(400, "Solo se pueden cancelar cuotas pendientes")

    scheduled.status = "CANCELLED"
    db.commit()

    return {"ok": True}
