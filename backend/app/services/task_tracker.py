"""Track Celery task execution timestamps and status."""

import logging
from datetime import datetime
from zoneinfo import ZoneInfo

logger = logging.getLogger(__name__)

BUE = ZoneInfo("America/Argentina/Buenos_Aires")


def record_task_run(task_name: str, success: bool = True):
    """Record task execution timestamp and status in settings table.

    Args:
        task_name: The schedule name (e.g., 'execute-due-installments-daily')
        success: Whether the task completed successfully
    """
    from app.database import SessionLocal
    from app.models import Setting

    now = datetime.now(BUE).isoformat()
    status = "success" if success else "error"

    db = SessionLocal()
    try:
        for key, value in [
            (f"task_last_run:{task_name}", now),
            (f"task_last_status:{task_name}", status),
        ]:
            setting = db.query(Setting).filter(Setting.key == key).first()
            if setting:
                setting.value = value
            else:
                db.add(Setting(key=key, value=value))
        db.commit()
    except Exception as e:
        logger.warning(f"Failed to record task run for {task_name}: {e}")
    finally:
        db.close()
