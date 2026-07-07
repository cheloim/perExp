"""Daily task to notify users about uncategorized expenses."""

import json
import logging

from sqlalchemy import func

from app.celery_app import celery_app
from app.database import SessionLocal
from app.models import Expense, Notification, User

logger = logging.getLogger(__name__)


@celery_app.task(name="app.tasks.daily_uncategorized.daily_uncategorized_check")
def daily_uncategorized_check():
    """Check all active users for uncategorized expenses and create notifications."""
    db = SessionLocal()
    try:
        users = db.query(User).filter(User.is_active == True).all()  # noqa: E712
        notified = 0

        for user in users:
            count = (
                db.query(func.count(Expense.id))
                .filter(
                    Expense.user_id == user.id,
                    Expense.category_id.is_(None),
                )
                .scalar()
            )

            if count > 0:
                existing = (
                    db.query(Notification)
                    .filter(
                        Notification.user_id == user.id,
                        Notification.type == "uncategorized_expenses",
                        Notification.read == False,  # noqa: E712
                    )
                    .first()
                )

                if not existing:
                    notification = Notification(
                        user_id=user.id,
                        type="uncategorized_expenses",
                        title=f"⚠ {count} gasto{'s' if count != 1 else ''} sin categorí{'as' if count != 1 else 'a'}",
                        body="Asigná categorías para un mejor análisis de tus gastos.",
                        data=json.dumps({"count": count}),
                        read=False,
                    )
                    db.add(notification)
                    notified += 1

        db.commit()
        logger.info(f"Daily uncategorized check: notified {notified}/{len(users)} users")
    except Exception as e:
        logger.error(f"Daily uncategorized check failed: {e}")
        db.rollback()
    finally:
        db.close()
