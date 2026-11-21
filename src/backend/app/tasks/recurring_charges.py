"""Daily task: materialize due charges of confirmed recurring expenses.

Recurring patterns have two stages:

- ``source="auto"``: a suggestion detected from history. It only advances its
  expected date; it must be confirmed before it can create expenses.
- ``source="manual"``: confirmed by the user. When the charge date arrives it
  becomes a real ``Expense`` (flagged as a projection until a statement import
  reconciles it), and the next charge date is advanced.
"""

import logging
from collections import defaultdict
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from app.celery_app import celery_app
from app.database import SessionLocal
from app.models import Expense, ExpenseTag, RecurringExpense, Tag
from app.services.encryption import compute_hmac
from app.services.money import format_money, format_totals
from app.services.recurring_schedule import (
    add_charge_period,
    advance_charge_date,
    find_matching_expense,
)
from app.services.task_lock import task_lock
from app.services.task_tracker import record_task_run

logger = logging.getLogger(__name__)

BUE = ZoneInfo("America/Argentina/Buenos_Aires")

# Oldest overdue occurrence we are willing to materialize. A task that was
# stopped for months must not create a pile of historical expenses.
BACKFILL_DAYS = 31
# Safety valve for a corrupt date/frequency combination.
MAX_OCCURRENCES_PER_RUN = 24


def _copy_recurring_tag(db, expense: Expense, recurring: RecurringExpense) -> None:
    if not recurring.tag_id:
        return
    tag = db.query(Tag).filter(Tag.id == recurring.tag_id).first()
    if not tag or tag.group_name == "categoria":
        return
    existing = (
        db.query(ExpenseTag)
        .filter(ExpenseTag.expense_id == expense.id, ExpenseTag.tag_id == tag.id)
        .first()
    )
    if not existing:
        db.add(ExpenseTag(expense_id=expense.id, tag_id=tag.id))


def _assign_payment_tag(db, expense: Expense) -> None:
    if not expense.card_id:
        return
    from app.models import Card
    from app.services.tag_sync import assign_tags_validated, get_or_create_payment_tag

    card = db.query(Card).filter(Card.id == expense.card_id).first()
    if not card:
        return
    tag = get_or_create_payment_tag(db, expense.user_id, card=card)
    assign_tags_validated(db, expense.id, [int(tag.id)], expense.user_id)


def _materialize_charge(
    db, recurring: RecurringExpense, charge_date: date
) -> tuple[str, Expense | None]:
    """Create or link the expense for one due charge.

    Returns ``(status, expense)`` where status is ``created``, ``linked`` or
    ``existing``. The operation is idempotent: an existing projection for the
    same recurring + date is never duplicated.
    """
    existing_projection = (
        db.query(Expense)
        .filter(
            Expense.user_id == recurring.user_id,
            Expense.recurring_expense_id == recurring.id,
            Expense.date == charge_date,
            Expense.is_recurring_projection == True,
        )
        .first()
    )
    if existing_projection:
        return "existing", existing_projection

    existing_real = find_matching_expense(
        db,
        recurring.user_id,
        charge_date,
        recurring.amount,
        recurring.description,
        projection=False,
        recurring_id=recurring.id,
    )
    if existing_real:
        if existing_real.recurring_expense_id is None:
            existing_real.recurring_expense_id = recurring.id
            db.flush()
            return "linked", existing_real
        return "existing", existing_real

    expense = Expense(
        date=charge_date,
        description=recurring.description,
        description_hmac=compute_hmac(recurring.description),
        amount=recurring.amount,
        currency=recurring.currency or "ARS",
        card_id=recurring.card_id,
        account_id=recurring.account_id,
        category_id=recurring.category_id,
        user_id=recurring.user_id,
        recurring_expense_id=recurring.id,
        is_recurring_projection=True,
        is_income=False,
    )
    db.add(expense)
    db.flush()

    from app.services.tag_sync import sync_category_tag

    sync_category_tag(db, expense, expense.category_id)
    _copy_recurring_tag(db, expense, recurring)
    _assign_payment_tag(db, expense)

    return "created", expense


def _format_executions(executions: list[dict]) -> tuple[str, str]:
    if len(executions) == 1:
        item = executions[0]
        title = "✅ Cobro recurrente registrado"
        body = f"{item['description']} — {format_money(item['amount'], item['currency'])} ({item['date']})"
        return title, body

    title = f"✅ {len(executions)} cobros recurrentes registrados"
    lines = [
        f"  • {item['description']} — {format_money(item['amount'], item['currency'])} ({item['date']})"
        for item in executions[:5]
    ]
    body = "\n".join(lines)
    if len(executions) > 5:
        body += f"\n... y {len(executions) - 5} más"
    body += f"\n\nTotal: {format_totals((item['amount'], item['currency']) for item in executions)}"
    return title, body


def _process_due_recurring(db, today: date | None = None) -> dict[str, int]:
    """Process every active recurring expense whose charge date has arrived."""
    today = today or datetime.now(BUE).date()
    oldest_allowed = today - timedelta(days=BACKFILL_DAYS)

    counts = {
        "created": 0,
        "linked": 0,
        "existing": 0,
        "skipped_old": 0,
        "advanced_only": 0,
    }
    executions_by_user: dict[int, list[dict]] = defaultdict(list)

    due = (
        db.query(RecurringExpense)
        .filter(
            RecurringExpense.is_active == True,
            RecurringExpense.next_charge_date.isnot(None),
            RecurringExpense.next_charge_date <= today,
        )
        .order_by(RecurringExpense.next_charge_date)
        .all()
    )

    for recurring in due:
        if recurring.source != "manual":
            recurring.next_charge_date = advance_charge_date(
                recurring.next_charge_date, recurring.frequency, today
            )
            counts["advanced_only"] += 1
            continue

        charge_date = recurring.next_charge_date
        occurrences = 0
        while charge_date <= today and occurrences < MAX_OCCURRENCES_PER_RUN:
            occurrences += 1
            if charge_date >= oldest_allowed:
                status, _expense = _materialize_charge(db, recurring, charge_date)
                counts[status] += 1
                if status == "created":
                    executions_by_user[recurring.user_id].append(
                        {
                            "recurring_id": recurring.id,
                            "description": recurring.description,
                            "amount": recurring.amount,
                            "currency": recurring.currency,
                            "date": charge_date.strftime("%d/%m/%Y"),
                        }
                    )
            else:
                counts["skipped_old"] += 1
            charge_date = add_charge_period(charge_date, recurring.frequency)

        if charge_date <= today:
            # Hit the safety cap: jump to the next future date instead of
            # leaving the record due forever.
            charge_date = advance_charge_date(charge_date, recurring.frequency, today)
        recurring.next_charge_date = charge_date

    if executions_by_user:
        from app.services.notify import notify_user

        for user_id, executions in executions_by_user.items():
            title, body = _format_executions(executions)
            notify_user(
                db,
                user_id,
                "recurring_executed",
                title,
                body,
                {
                    "count": len(executions),
                    "total_amount": sum(item["amount"] for item in executions),
                    "recurring_ids": [item["recurring_id"] for item in executions],
                },
            )

    db.commit()
    return counts


@celery_app.task(name="app.tasks.recurring_charges.execute_due_recurring")
def execute_due_recurring():
    with task_lock("recurring-charges-daily", ttl=3600) as acquired:
        if not acquired:
            return {}
        return _execute_due_recurring_impl()


def _execute_due_recurring_impl():
    """Celery entry point for the daily recurring charge execution."""
    db = SessionLocal()
    try:
        counts = _process_due_recurring(db)
        logger.info("[RECURRING] %s", counts)
        record_task_run("execute-due-recurring-daily", success=True)
        return counts
    except Exception as e:
        db.rollback()
        logger.error("[RECURRING ERROR] %s", e)
        record_task_run("execute-due-recurring-daily", success=False)
        raise
    finally:
        db.close()
