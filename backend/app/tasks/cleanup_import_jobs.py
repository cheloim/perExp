"""
Cleanup expired import jobs (TTL: 24 hours)
"""

import json
import logging
from datetime import datetime, timedelta

from app.database import SessionLocal

logger = logging.getLogger(__name__)
from app.celery_app import celery_app
from app.models import ImportJob, Notification


@celery_app.task(name="app.tasks.cleanup_import_jobs.cleanup_expired_import_jobs")
def cleanup_expired_import_jobs():
    """
    Elimina import jobs con más de 24 horas.
    También elimina las notificaciones asociadas.
    Debe ejecutarse diariamente via scheduler.
    """
    db = SessionLocal()
    try:
        cutoff = datetime.utcnow() - timedelta(hours=24)

        expired = db.query(ImportJob).filter(ImportJob.created_at < cutoff).all()

        count = 0
        expired_job_ids = {job.id for job in expired}

        # Only query notifications older than cutoff that are import-related
        notifications = (
            db.query(Notification)
            .filter(
                Notification.type.in_(["import_ready", "import_failed"]),
                Notification.created_at < cutoff,
            )
            .all()
        )

        # Build lookup: job_id -> list of notifications
        notif_by_job = {}
        for notif in notifications:
            try:
                data = json.loads(notif.data)
                job_id = data.get("job_id")
                if job_id in expired_job_ids:
                    notif_by_job.setdefault(job_id, []).append(notif)
            except Exception:
                pass

        # Delete notifications and jobs
        for job in expired:
            for notif in notif_by_job.get(job.id, []):
                db.delete(notif)
            db.delete(job)
            count += 1

        db.commit()
        logger.info("[CLEANUP] Eliminados %d import jobs expirados (TTL: 24h)", count)
        return count

    except Exception as e:
        db.rollback()
        logger.error("[CLEANUP ERROR] %s", e)
        raise
    finally:
        db.close()
