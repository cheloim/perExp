"""Budget alerts Celery task - checks budget thresholds and sends notifications.

Uses the shared notify_user() service so the per-user channel preference
(inapp/telegram/both/none) and the budget_alerts_enabled toggle are honored.
Alerts fire once per budget/group per month, at the highest newly crossed
level (default 75%/90%/100%).
"""

import logging
from datetime import date

from app.celery_app import celery_app
from app.database import SessionLocal
from app.models import Budget, BudgetGroup, Category, Setting, User
from app.services.budget_helpers import (
    existing_alert_levels,
    get_alert_levels,
    highest_new_alert_level,
)
from app.services.budget_helpers import (
    get_group_user_ids as _get_group_user_ids,
)
from app.services.budget_helpers import (
    get_spending_for_category as _get_spending_for_category,
)
from app.services.budget_helpers import (
    get_spending_for_group as _get_spending_for_group,
)
from app.services.notify import notify_user
from app.services.task_tracker import record_task_run

logger = logging.getLogger(__name__)

DISPLAY_NAMES = {
    "necesidades": "Necesidades",
    "gustos": "Gustos",
    "ahorro": "Ahorro",
}


def _alerts_disabled(db, user_id: int) -> bool:
    setting = db.query(Setting).filter(Setting.key == f"{user_id}:budget_alerts_enabled").first()
    return bool(setting and setting.value.lower() in ("false", "0", "no"))


@celery_app.task(name="app.tasks.budgets.check_budget_alerts")
def check_budget_alerts():
    """
    Check budget thresholds and send notifications via configured channels.
    Runs daily at 10:00 UTC (07:00 ARS).
    """
    db = SessionLocal()
    try:
        today = date.today()
        year, month = today.year, today.month
        month_key = f"{year}-{month:02d}"

        users = db.query(User).filter(User.is_active == True).all()  # noqa: E712

        alerts_sent = 0
        for user in users:
            if _alerts_disabled(db, user.id):
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
                label = DISPLAY_NAMES.get(group.name, group.name)
                existing_levels = existing_alert_levels(
                    db, user.id, month_key, group_name=group.name
                )
                level = highest_new_alert_level(pct, get_alert_levels(group), existing_levels)
                if level is None:
                    continue

                is_exceeded = pct >= 1.0 or level >= 1.0
                status = "exceeded" if is_exceeded else "warning"
                notify_user(
                    db,
                    user.id,
                    "budget_warning",
                    f"{'🔴 Excedido' if is_exceeded else '🟡 Alerta'}: {label}",
                    f"Presupuesto ${group.amount:,.0f} | Gastado ${spent:,.0f} ({pct:.0%})",
                    {
                        "group_name": group.name,
                        "month": month_key,
                        "budget_amount": group.amount,
                        "spent_amount": spent,
                        "percentage": pct,
                        "status": status,
                        "level": level,
                    },
                )
                alerts_sent += 1

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
                existing_levels = existing_alert_levels(
                    db, user.id, month_key, category_id=budget.category_id
                )
                level = highest_new_alert_level(pct, get_alert_levels(budget), existing_levels)
                if level is None:
                    continue

                is_exceeded = pct >= 1.0 or level >= 1.0
                status = "exceeded" if is_exceeded else "warning"
                notify_user(
                    db,
                    user.id,
                    "budget_warning",
                    f"{'🔴 Excedido' if is_exceeded else '🟡 Alerta'}: {cat.name}",
                    f"Presupuesto ${budget.amount:,.0f} | Gastado ${spent:,.0f} ({pct:.0%})",
                    {
                        "category_id": budget.category_id,
                        "category_name": cat.name,
                        "month": month_key,
                        "budget_amount": budget.amount,
                        "spent_amount": spent,
                        "percentage": pct,
                        "status": status,
                        "level": level,
                    },
                )
                alerts_sent += 1

        db.commit()
        logger.info(f"[BUDGET ALERTS] Sent {alerts_sent} alerts for {month_key}")
        record_task_run("check-budget-alerts-daily", success=True)

    except Exception as e:
        logger.error(f"[BUDGET ALERTS] Error: {e}")
        record_task_run("check-budget-alerts-daily", success=False)
        db.rollback()
    finally:
        db.close()
