"""Daily Celery task to send notifications for upcoming installment payments (cuotas).

Sends alerts N days before a scheduled_date for PENDING installments.
Default: 3 days (configurable per user via Setting {user_id}:notify_installments_days_before).
"""

import json
import logging
from datetime import datetime
from zoneinfo import ZoneInfo

from app.celery_app import celery_app
from app.database import SessionLocal
from app.models import Notification, ScheduledExpense, Setting
from app.services.task_tracker import record_task_run

logger = logging.getLogger(__name__)

BUE = ZoneInfo("America/Argentina/Buenos_Aires")

DEFAULT_DAYS_BEFORE = 3


@celery_app.task(name="app.tasks.check_upcoming_installments.check_upcoming_installments")
def check_upcoming_installments():
    """Send notifications for PENDING installments due soon.

    Deduplication: skips if an unread notification already exists for this
    scheduled_id + scheduled_date combination.
    """
    db = SessionLocal()
    try:
        from app.services.notify import notify_user

        today = datetime.now(BUE).date()

        # Get all pending installments with scheduled_date in the future
        upcoming = (
            db.query(ScheduledExpense)
            .filter(
                ScheduledExpense.status == "PENDING",
                ScheduledExpense.scheduled_date.isnot(None),
            )
            .all()
        )

        notified = 0
        for se in upcoming:
            if se.scheduled_date is None:
                continue

            days_until = (se.scheduled_date - today).days
            if days_until < 0:
                continue

            # Get per-user days_before setting
            days_before = _get_days_before(se.user_id, db)
            if days_until > days_before:
                continue

            # Dedupe: skip if already notified for this scheduled_id + date
            existing = (
                db.query(Notification)
                .filter(
                    Notification.user_id == se.user_id,
                    Notification.type == "upcoming_installment",
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
                    if data.get("scheduled_id") == se.id and data.get(
                        "scheduled_date"
                    ) == str(se.scheduled_date):
                        already_notified = True
                        break
                except (json.JSONDecodeError, TypeError):
                    continue

            if already_notified:
                continue

            # Build message
            installment_label = ""
            if (se.installment_total or 0) > 1:
                installment_label = f" ({se.installment_number}/{se.installment_total})"

            if days_until == 0:
                title = f"💳 Cuota{installment_label} — vence hoy"
                body = f"{se.description} — ${se.amount:,.0f} vence hoy."
            elif days_until == 1:
                title = f"💳 Cuota{installment_label} — vence mañana"
                body = f"{se.description} — ${se.amount:,.0f} vence mañana."
            else:
                title = f"💳 Cuota{installment_label} — vence en {days_until} días"
                body = (
                    f"{se.description} — ${se.amount:,.0f} "
                    f"vence el {se.scheduled_date.strftime('%d/%m/%Y')}."
                )

            notify_user(
                db,
                se.user_id,
                "upcoming_installment",
                title,
                body,
                {
                    "scheduled_id": se.id,
                    "scheduled_date": str(se.scheduled_date),
                    "amount": se.amount,
                    "description": se.description,
                    "installment_number": se.installment_number,
                    "installment_total": se.installment_total,
                },
            )
            notified += 1

        db.commit()
        logger.info(f"Check upcoming installments: sent {notified} notifications")
        record_task_run("check-upcoming-installments-daily", success=True)
        return {"notified": notified}

    except Exception as e:
        logger.error(f"Check upcoming installments failed: {e}")
        record_task_run("check-upcoming-installments-daily", success=False)
        db.rollback()
        raise
    finally:
        db.close()


from sqlalchemy.orm import Session


def _get_days_before(user_id: int, db: Session) -> int:
    """Get the per-user days_before setting, default DEFAULT_DAYS_BEFORE."""
    setting = (
        db.query(Setting)
        .filter(Setting.key == f"{user_id}:notify_installments_days_before")
        .first()
    )
    if setting:
        try:
            return int(setting.value)
        except (ValueError, TypeError):
            pass
    return DEFAULT_DAYS_BEFORE
