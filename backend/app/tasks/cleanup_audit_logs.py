"""Cleanup old audit logs and impersonation messages."""

import logging
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from app.celery_app import celery_app
from app.database import SessionLocal
from app.models import AuditLog, ImpersonationMessage, ImpersonationSession, PlatformLog

logger = logging.getLogger(__name__)

BUE = ZoneInfo("America/Argentina/Buenos_Aires")


@celery_app.task(name="app.tasks.cleanup_audit_logs.cleanup_old_records")
def cleanup_old_records():
    """Delete audit logs older than 90 days and impersonation messages older than 45 days."""
    db = SessionLocal()
    try:
        now = datetime.now(BUE)

        # Audit logs: 90 days
        audit_cutoff = now - timedelta(days=90)
        deleted_audit = db.query(AuditLog).filter(AuditLog.created_at < audit_cutoff).delete()
        if deleted_audit:
            logger.info(f"[CLEANUP] Deleted {deleted_audit} audit logs older than 90 days")

        # Impersonation messages: 45 days
        msg_cutoff = now - timedelta(days=45)
        deleted_msgs = (
            db.query(ImpersonationMessage)
            .filter(ImpersonationMessage.created_at < msg_cutoff)
            .delete()
        )
        if deleted_msgs:
            logger.info(
                f"[CLEANUP] Deleted {deleted_msgs} impersonation messages older than 45 days"
            )

        # Expired impersonation sessions (pending/active older than 1 hour)
        session_cutoff = now - timedelta(hours=1)
        expired = (
            db.query(ImpersonationSession)
            .filter(
                ImpersonationSession.status.in_(["pending", "active"]),
                ImpersonationSession.expires_at < session_cutoff,
            )
            .all()
        )
        for session in expired:
            session.status = "expired"
            session.ended_at = now
        if expired:
            logger.info(f"[CLEANUP] Expired {len(expired)} impersonation sessions")

        # Platform logs: 45 days
        platform_cutoff = now - timedelta(days=45)
        deleted_platform = (
            db.query(PlatformLog).filter(PlatformLog.created_at < platform_cutoff).delete()
        )
        if deleted_platform:
            logger.info(f"[CLEANUP] Deleted {deleted_platform} platform logs older than 45 days")

        db.commit()
    except Exception as e:
        logger.error(f"[CLEANUP] Error: {e}")
        db.rollback()
    finally:
        db.close()
