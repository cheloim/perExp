"""Daily Celery task to send notifications for upcoming recurring charges.

Uses notify_user() which writes in-app Notification + sends Telegram
based on per-user channel settings.
"""

import json
import logging
from datetime import datetime
from zoneinfo import ZoneInfo

from app.celery_app import celery_app
from app.database import SessionLocal
from app.models import Notification, RecurringExpense
from app.services.task_tracker import record_task_run

logger = logging.getLogger(__name__)

BUE = ZoneInfo("America/Argentina/Buenos_Aires")


@celery_app.task(name="app.tasks.check_upcoming_recurring.check_upcoming_recurring")
def check_upcoming_recurring():
    """Send notifications for recurring charges due soon.

    Uses the notify_user service for channel resolution (in-app + Telegram).
    Deduplication: skips if an unread notification already exists for this
    recurring_id + charge_date combination.
    """
    db = SessionLocal()
    try:
        from app.services.notify import notify_user

        today = datetime.now(BUE).date()

        upcoming = (
            db.query(RecurringExpense)
            .filter(
                RecurringExpense.is_active == True,  # noqa: E712
                RecurringExpense.next_charge_date.isnot(None),
            )
            .all()
        )

        notified = 0
        for rec in upcoming:
            if rec.next_charge_date is None:
                continue

            days_until = (rec.next_charge_date - today).days
            if days_until < 0 or days_until > rec.alert_days_before:
                continue

            # Dedupe: skip if already notified for this charge date
            existing = (
                db.query(Notification)
                .filter(
                    Notification.user_id == rec.user_id,
                    Notification.type == "upcoming_recurring",
                    Notification.read == False,  # noqa: E712
                )
                .all()
            )

            already_notified = False
            for n in existing:
                try:
                    data = json.loads(n.data)
                    if not isinstance(data, dict):
                        continue
                    if data.get("recurring_id") == rec.id and data.get("charge_date") == str(
                        rec.next_charge_date
                    ):
                        already_notified = True
                        break
                except (json.JSONDecodeError, TypeError):
                    continue

            if already_notified:
                continue

            # Build message
            if days_until == 0:
                title = f"🔔 {rec.merchant_key} — cobro hoy"
                body = f"Se cobra ${rec.amount:,.0f} hoy."
            elif days_until == 1:
                title = f"🔔 {rec.merchant_key} — cobro mañana"
                body = f"Se cobra ${rec.amount:,.0f} mañana."
            else:
                title = f"🔔 {rec.merchant_key} — cobro en {days_until} días"
                body = (
                    f"Se cobra ${rec.amount:,.0f} el {rec.next_charge_date.strftime('%d/%m/%Y')}."
                )

            notify_user(
                db,
                rec.user_id,
                "upcoming_recurring",
                title,
                body,
                {
                    "recurring_id": rec.id,
                    "charge_date": str(rec.next_charge_date),
                    "amount": rec.amount,
                    "merchant": rec.merchant_key,
                },
            )
            notified += 1

        db.commit()
        logger.info(f"Check upcoming recurring: sent {notified} notifications")
        record_task_run("check-upcoming-recurring-daily", success=True)
        return {"notified": notified}

    except Exception as e:
        logger.error(f"Check upcoming recurring failed: {e}")
        record_task_run("check-upcoming-recurring-daily", success=False)
        db.rollback()
        raise
    finally:
        db.close()
