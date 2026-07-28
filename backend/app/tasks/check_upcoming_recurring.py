"""Daily task to alert about upcoming recurring charges."""

import json
import logging
from datetime import date, timedelta

from app.celery_app import celery_app
from app.database import SessionLocal
from app.models import Notification, RecurringExpense, User

logger = logging.getLogger(__name__)


@celery_app.task(name="app.tasks.check_upcoming_recurring.check_upcoming_recurring")
def check_upcoming_recurring():
    """Send alerts for upcoming recurring charges (within alert_days_before)."""
    db = SessionLocal()
    try:
        users = db.query(User).filter(User.is_active == True).all()  # noqa: E712
        total_notified = 0

        for user in users:
            upcoming = (
                db.query(RecurringExpense)
                .filter(
                    RecurringExpense.user_id == user.id,
                    RecurringExpense.is_active == True,  # noqa: E712
                    RecurringExpense.next_charge_date <= date.today() + timedelta(days=3),
                    RecurringExpense.next_charge_date >= date.today(),
                )
                .all()
            )

            if not upcoming:
                continue

            # Build notification
            items = []
            for r in upcoming:
                days = (r.next_charge_date - date.today()).days
                items.append(
                    {
                        "id": r.id,
                        "description": r.description,
                        "amount": r.amount,
                        "next_date": r.next_charge_date.isoformat(),
                        "days_until": days,
                    }
                )

            notification = Notification(
                user_id=user.id,
                type="upcoming_recurring",
                title=f"📅 {len(upcoming)} cargo{'s' if len(upcoming) != 1 else ''} próximo{'s' if len(upcoming) != 1 else ''}",
                body=", ".join(r.description for r in upcoming),
                data=json.dumps(items),
                read=False,
            )
            db.add(notification)
            total_notified += 1

        db.commit()
        logger.info("Check upcoming recurring: notified %d users", total_notified)
    except Exception as e:
        logger.error("Check upcoming recurring task failed: %s", e)
        db.rollback()
    finally:
        db.close()
