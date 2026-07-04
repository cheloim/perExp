"""Budget alerts Celery task - checks budget thresholds and sends notifications."""

from calendar import monthrange
from datetime import date

from app.celery_app import celery_app
from app.database import SessionLocal
from app.models import Budget, Category, Expense, Notification, User


def _get_spending_for_category(
    category_id: int, year: int, month: int, uid_list: list[int], db
) -> float:
    """Get total spending for a category in a given month (including children)."""
    from app.models import Category as CatModel

    cat_ids = [category_id]
    children = db.query(CatModel).filter(CatModel.parent_id == category_id).all()
    cat_ids.extend([c.id for c in children])

    start = date(year, month, 1)
    end = date(year, month, monthrange(year, month)[1])

    total = (
        db.query(Expense)
        .filter(
            Expense.user_id.in_(uid_list),
            Expense.category_id.in_(cat_ids),
            Expense.date >= start,
            Expense.date <= end,
            Expense.is_income == False,
        )
        .with_entities(Expense.amount)
        .all()
    )
    return sum(abs(t[0]) for t in total)


def _get_group_user_ids(user_id: int, db) -> list[int]:
    """Get all user IDs in the same family group."""
    from app.models import GroupMember

    member = db.query(GroupMember).filter(GroupMember.user_id == user_id).first()
    if not member:
        return [user_id]
    return [
        m.user_id
        for m in db.query(GroupMember).filter(GroupMember.group_id == member.group_id).all()
    ]


def _send_telegram_alert(chat_id: str, category_name: str, pct: float, spent: float, budget: float):
    """Send budget alert via Telegram."""
    try:
        from app.telegram_bot import send_message_to_chat

        emoji = "🔴" if pct >= 1.0 else "🟡"
        send_message_to_chat(
            chat_id,
            f"{emoji} *Alerta de Presupuesto*\n\n"
            f"*{category_name}*\n"
            f"Gastado: ${spent:,.0f} / ${budget:,.0f}\n"
            f"Porcentaje: {pct:.0%}\n\n"
            f"{'⚠️ Presupuesto excedido!' if pct >= 1.0 else '⚠️ Te acercás al límite.'}",
        )
    except Exception as e:
        print(f"[BUDGET ALERT] Failed to send Telegram alert: {e}")


@celery_app.task(name="app.tasks.budgets.check_budget_alerts")
def check_budget_alerts():
    """
    Check budget thresholds and send notifications + Telegram alerts.
    Runs daily at 10:00 UTC (07:00 ARS).
    """
    db = SessionLocal()
    try:
        today = date.today()
        year, month = today.year, today.month
        month_key = f"{year}-{month:02d}"

        # Get all users with Telegram connected
        users = db.query(User).filter(User.telegram_chat_id.isnot(None)).all()

        alerts_sent = 0
        for user in users:
            uid_list = _get_group_user_ids(user.id, db)

            # Get all active budgets for this user
            budgets = (
                db.query(Budget)
                .filter(Budget.user_id == user.id, Budget.is_active == True)
                .all()
            )

            for budget in budgets:
                cat = db.query(Category).filter(Category.id == budget.category_id).first()
                if not cat:
                    continue

                spent = _get_spending_for_category(budget.category_id, year, month, uid_list, db)
                if budget.amount <= 0:
                    continue

                pct = spent / budget.amount

                # Check if threshold exceeded
                if pct < budget.alert_threshold:
                    continue

                # Check if notification already exists for this category+month
                existing = (
                    db.query(Notification)
                    .filter(
                        Notification.user_id == user.id,
                        Notification.type == "budget_warning",
                        Notification.data.contains(f'"category_id": {budget.category_id}'),
                        Notification.data.contains(f'"month": "{month_key}"'),
                        Notification.read == False,
                    )
                    .first()
                )

                if existing:
                    continue

                # Determine notification type
                is_exceeded = pct >= 1.0
                status = "exceeded" if is_exceeded else "warning"

                # Create notification
                notification = Notification(
                    user_id=user.id,
                    type="budget_warning",
                    title=f"{'🔴 Excedido' if is_exceeded else '🟡 Alerta'}: {cat.name}",
                    body=f"Presupuesto ${budget.amount:,.0f} | Gastado ${spent:,.0f} ({pct:.0%})",
                    data=f'{{"category_id": {budget.category_id}, "category_name": "{cat.name}", "month": "{month_key}", "budget_amount": {budget.amount}, "spent_amount": {spent}, "percentage": {pct}, "status": "{status}"}}',
                    read=False,
                )
                db.add(notification)
                alerts_sent += 1

                # Send Telegram alert (only at 80%+)
                if user.telegram_chat_id:
                    _send_telegram_alert(
                        user.telegram_chat_id,
                        cat.name,
                        pct,
                        spent,
                        budget.amount,
                    )

        db.commit()
        print(f"[BUDGET ALERTS] Sent {alerts_sent} alerts for {month_key}")

    except Exception as e:
        print(f"[BUDGET ALERTS] Error: {e}")
        db.rollback()
    finally:
        db.close()
