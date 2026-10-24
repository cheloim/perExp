"""Daily scan for miscategorized expenses (issue #414).

Internal only: findings land in ``categorization_reviews`` for analyst review,
never in the user-facing suggestion flow, notifications or chat.

Forward-only by design: only expenses created in the last
``SCAN_LOOKBACK_DAYS`` are reviewed, so the pre-existing dataset is never
re-processed. The scan is opt-in through the ``categorization_review_enabled``
setting (global flag or per user); it is off unless explicitly enabled.
"""

import logging

from app.celery_app import celery_app
from app.database import SessionLocal
from app.models import User
from app.services import categorization_review as review_service
from app.services import get_setting
from app.services.task_tracker import record_task_run

logger = logging.getLogger(__name__)

TASK_NAME = "categorization-review-scan-daily"
SETTING_KEY = "categorization_review_enabled"


@celery_app.task(name="app.tasks.categorization_review.categorization_review_scan")
def categorization_review_scan():
    """Review the recently created expenses of opted-in users."""
    db = SessionLocal()
    try:
        users = db.query(User).filter(User.is_active == True).all()  # noqa: E712
        scanned = 0
        persisted = 0
        for user in users:
            if get_setting(db, SETTING_KEY, user.id) != "true":
                continue
            result = review_service.scan_user(db, user)
            scanned += result["scanned"]
            persisted += result["persisted"]

        logger.info(
            "Categorization review: %s gastos revisados, %s revisiones nuevas",
            scanned,
            persisted,
        )
        record_task_run(TASK_NAME, success=True)
    except Exception as e:
        logger.error(f"Categorization review task failed: {e}")
        record_task_run(TASK_NAME, success=False)
        db.rollback()
    finally:
        db.close()
