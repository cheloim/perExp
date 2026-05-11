"""
Cleanup expired import jobs (TTL: 24 hours)
"""
import json
from datetime import datetime, timedelta

from app.database import SessionLocal
from app.models import ImportJob, Notification


def cleanup_expired_import_jobs():
    """
    Elimina import jobs con más de 24 horas.
    También elimina las notificaciones asociadas.
    Debe ejecutarse diariamente via scheduler.
    """
    db = SessionLocal()
    try:
        cutoff = datetime.utcnow() - timedelta(hours=24)

        expired = db.query(ImportJob).filter(
            ImportJob.created_at < cutoff
        ).all()

        count = 0
        for job in expired:
            # Eliminar notificación asociada (import_ready o import_failed)
            notifications = db.query(Notification).filter(
                Notification.type.in_(['import_ready', 'import_failed'])
            ).all()

            for notif in notifications:
                try:
                    data = json.loads(notif.data)
                    if data.get('job_id') == job.id:
                        db.delete(notif)
                except Exception:
                    pass  # Ignorar errores de parseo JSON

            db.delete(job)
            count += 1

        db.commit()
        print(f"[CLEANUP] Eliminados {count} import jobs expirados (TTL: 24h)")
        return count

    except Exception as e:
        db.rollback()
        print(f"[CLEANUP ERROR] {e}")
        raise
    finally:
        db.close()
