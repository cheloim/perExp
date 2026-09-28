"""Budget alerts Celery task - checks budget thresholds and sends notifications."""

import logging
from datetime import date

from app.celery_app import celery_app
from app.database import SessionLocal
from app.models import Budget, BudgetGroup, Category, Notification, Setting, User
from app.services.budget_helpers import (
    get_group_user_ids as _get_group_user_ids,
)
from app.services.budget_helpers import (
    get_spending_for_category as _get_spending_for_category,
)
from app.services.budget_helpers import (
    get_spending_for_group as _get_spending_for_group,
)
from app.services.task_tracker import record_task_run

logger = logging.getLogger(__name__)


def _send_telegram_alert(chat_id: str, label: str, pct: float, spent: float, budget: float):
    """Send budget alert via Telegram for a category or macro group."""
    try:
        from app.telegram_bot import send_message_to_chat

        emoji = "🔴" if pct >= 1.0 else "🟡"
        remaining = budget - spent
        remaining_pct = (remaining / budget * 100) if budget > 0 else 0
        exceeded_msg = (
            "⚠️ Presupuesto excedido! Revisá tus gastos."
            if pct >= 1.0
            else f"⚠️ Te estás acercando al límite. Revisá tus gastos en {label}."
        )
        send_message_to_chat(
            chat_id,
            f"{emoji} <b>Alerta de Presupuesto — {label}</b>\n\n"
            f"💰 Gastado: ${spent:,.0f} de ${budget:,.0f}\n"
            f"📊 Uso: {pct:.0%}\n"
            f"💸 Te quedan: ${remaining:,.0f} ({remaining_pct:.0f}%)\n\n"
            f"{exceeded_msg}",
        )
    except Exception as e:
        logger.warning(f"[BUDGET ALERT] Failed to send Telegram alert: {e}")


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

        users = db.query(User).filter(User.telegram_chat_hash.isnot(None)).all()

        alerts_sent = 0
        for user in users:
            # Per-user toggle: skip if budget alerts disabled
            alert_setting = (
                db.query(Setting).filter(Setting.key == f"{user.id}:budget_alerts_enabled").first()
            )
            if alert_setting and alert_setting.value.lower() in ("false", "0", "no"):
                continue

            uid_list = _get_group_user_ids(user.id, db)

            # ─── Check macro groups (50/30/20) ────────────────────────
            groups = (
                db.query(BudgetGroup)
                .filter(BudgetGroup.user_id == user.id, BudgetGroup.is_active == True)
                .all()
            )

            for group in groups:
                spent = _get_spending_for_group(group.name, year, month, uid_list, db)
                group.spent = spent  # Update cached spent amount

                if group.amount <= 0:
                    continue

                pct = spent / group.amount

                # Check threshold
                if pct < 0.80:
                    continue

                # Check if notification already exists
                existing = (
                    db.query(Notification)
                    .filter(
                        Notification.user_id == user.id,
                        Notification.type == "budget_warning",
                        Notification.data.contains(f'"group_name": "{group.name}"'),
                        Notification.data.contains(f'"month": "{month_key}"'),
                        Notification.read == False,
                    )
                    .first()
                )

                if existing:
                    continue

                is_exceeded = pct >= 1.0
                status = "exceeded" if is_exceeded else "warning"
                display_names = {
                    "necesidades": "Necesidades",
                    "gustos": "Gustos",
                    "ahorro": "Ahorro",
                }

                notification = Notification(
                    user_id=user.id,
                    type="budget_warning",
                    title=f"{'🔴 Excedido' if is_exceeded else '🟡 Alerta'}: {display_names.get(group.name, group.name)}",
                    body=f"Presupuesto ${group.amount:,.0f} | Gastado ${spent:,.0f} ({pct:.0%})",
                    data=f'{{"group_name": "{group.name}", "month": "{month_key}", "budget_amount": {group.amount}, "spent_amount": {spent}, "percentage": {pct}, "status": "{status}"}}',
                    read=False,
                )
                db.add(notification)
                alerts_sent += 1

                if user.telegram_chat_id and user.telegram_chat_id != "[encrypted]":
                    _send_telegram_alert(
                        user.telegram_chat_id,
                        display_names.get(group.name, group.name),
                        pct,
                        spent,
                        group.amount,
                    )

            # ─── Check individual category budgets ─────────────────────
            budgets = (
                db.query(Budget).filter(Budget.user_id == user.id, Budget.is_active == True).all()
            )

            for budget in budgets:
                cat = db.query(Category).filter(Category.id == budget.category_id).first()
                if not cat:
                    continue

                spent = _get_spending_for_category(budget.category_id, year, month, uid_list, db)
                if budget.amount <= 0:
                    continue

                pct = spent / budget.amount

                if pct < budget.alert_threshold:
                    continue

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

                is_exceeded = pct >= 1.0
                status = "exceeded" if is_exceeded else "warning"

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

                if user.telegram_chat_id and user.telegram_chat_id != "[encrypted]":
                    _send_telegram_alert(
                        user.telegram_chat_id,
                        cat.name,
                        pct,
                        spent,
                        budget.amount,
                    )

        db.commit()
        logger.info(f"[BUDGET ALERTS] Sent {alerts_sent} alerts for {month_key}")
        record_task_run("check-budget-alerts-daily", success=True)

    except Exception as e:
        logger.error(f"[BUDGET ALERTS] Error: {e}")
        record_task_run("check-budget-alerts-daily", success=False)
        db.rollback()
    finally:
        db.close()
