"""Daily Celery task: execute due installments and send confirmation notifications."""

import logging
from collections import defaultdict
from datetime import date, datetime

from app.celery_app import celery_app
from app.database import SessionLocal
from app.models import Expense, ExpenseTag, ScheduledExpense
from app.services.task_tracker import record_task_run

logger = logging.getLogger(__name__)


@celery_app.task(name="app.tasks.scheduled_expenses.execute_due_installments")
def execute_due_installments():
    """
    Ejecuta cuotas programadas con scheduled_date <= hoy
    y envía una confirmación agrupada por usuario.

    Debe correrse diariamente: cron 0 2 * * *
    """
    db = SessionLocal()
    try:
        from app.services.notify import notify_user

        today = date.today()

        due_scheduled = (
            db.query(ScheduledExpense)
            .filter(ScheduledExpense.status == "PENDING", ScheduledExpense.scheduled_date <= today)
            .all()
        )

        executed_count = 0
        # Track executions per user for grouped confirmation
        user_executions: dict[int, list[dict]] = defaultdict(list)

        for scheduled in due_scheduled:
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

            from app.services.tag_sync import sync_category_tag

            sync_category_tag(db, expense, expense.category_id)

            from app.services.recurring_linker import link_to_recurring

            link_to_recurring(expense.id, scheduled.description, scheduled.user_id, db)

            if scheduled.expense_id:
                template_tags = (
                    db.query(ExpenseTag).filter(ExpenseTag.expense_id == scheduled.expense_id).all()
                )
                for et in template_tags:
                    db.add(ExpenseTag(expense_id=expense.id, tag_id=et.tag_id))

            scheduled.status = "EXECUTED"
            scheduled.executed_expense_id = expense.id
            scheduled.executed_at = datetime.utcnow()

            user_executions[scheduled.user_id].append(
                {
                    "description": scheduled.description,
                    "amount": scheduled.amount,
                    "installment_number": scheduled.installment_number,
                    "installment_total": scheduled.installment_total,
                }
            )

            executed_count += 1

        # Send grouped confirmation notifications per user
        for user_id, executions in user_executions.items():
            count = len(executions)
            total = sum(e["amount"] for e in executions)

            if count == 1:
                e = executions[0]
                inst = ""
                if (e.get("installment_total") or 0) > 1:
                    inst = f" ({e['installment_number']}/{e['installment_total']})"
                title = f"✅ Cuota{inst} registrada"
                body = f"{e['description']} — ${e['amount']:,.0f}"
            else:
                title = f"✅ {count} cuotas registradas"
                items = "\n".join(
                    f"  • {e['description']} — ${e['amount']:,.0f}" for e in executions[:5]
                )
                body = f"{items}\n\nTotal: ${total:,.0f}"
                if count > 5:
                    body += f"\n... y {count - 5} más"

            notify_user(
                db,
                user_id,
                "installment_executed",
                title,
                body,
                {"executed_count": count, "total_amount": total},
            )

        db.commit()
        logger.info(f"[SCHEDULED] Ejecutadas {executed_count} cuotas programadas")
        record_task_run("execute-due-installments-daily", success=True)
        return executed_count

    except Exception as e:
        db.rollback()
        logger.error(f"[SCHEDULED ERROR] {e}")
        record_task_run("execute-due-installments-daily", success=False)
        raise
    finally:
        db.close()
