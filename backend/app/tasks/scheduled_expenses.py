from datetime import date, datetime
from sqlalchemy.orm import Session
from app.database import SessionLocal
from app.models import ScheduledExpense, Expense


def execute_due_installments():
    """
    Ejecuta cuotas programadas con scheduled_date <= hoy
    Debe correrse diariamente: cron 0 2 * * *
    """
    db = SessionLocal()
    try:
        today = date.today()

        due_scheduled = db.query(ScheduledExpense).filter(
            ScheduledExpense.status == "PENDING",
            ScheduledExpense.scheduled_date <= today
        ).all()

        executed_count = 0
        for scheduled in due_scheduled:
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

            scheduled.status = "EXECUTED"
            scheduled.executed_expense_id = expense.id
            scheduled.executed_at = datetime.utcnow()

            executed_count += 1

        db.commit()
        print(f"[SCHEDULED] Ejecutadas {executed_count} cuotas programadas")
        return executed_count

    except Exception as e:
        db.rollback()
        print(f"[SCHEDULED ERROR] {e}")
        raise
    finally:
        db.close()
