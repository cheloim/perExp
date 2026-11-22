"""Admin use cases: audit logs, login errors and retention cleanup."""

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, Request
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.admin.common import _audit_admin, require_step_up
from app.database import get_db
from app.models import AuditLog, ImpersonationMessage, User
from app.services.auth import get_current_admin
from app.services.rate_limit import _get_redis

router = APIRouter()


@router.get(
    "/audit-logs",
    summary="Get audit logs",
    description="Return paginated audit logs, optionally filtered by user ID and action type.",
)
def get_audit_logs(
    user_id: int | None = None,
    action: str = "",
    page: int = 1,
    per_page: int = 100,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    query = db.query(AuditLog)
    if user_id:
        query = query.filter(AuditLog.user_id == user_id)
    if action:
        # Support comma-separated actions: "login_failed,login_success"
        actions = [a.strip() for a in action.split(",") if a.strip()]
        if actions:
            query = query.filter(AuditLog.action.in_(actions))

    total = query.count()
    logs = (
        query.order_by(AuditLog.created_at.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
        .all()
    )

    return {
        "logs": [
            {
                "id": log.id,
                "user_id": log.user_id,
                "user_email": db.query(User.email).filter(User.id == log.user_id).scalar()
                if log.user_id
                else None,
                "action": log.action,
                "ip_address": str(log.ip_address) if log.ip_address else None,
                "user_agent": str(log.user_agent) if log.user_agent else None,
                "details": log.details,
                "created_at": log.created_at.isoformat() if log.created_at else "",
            }
            for log in logs
        ],
        "total": total,
        "page": page,
    }


@router.get(
    "/login-errors",
    summary="Get login error statistics",
    description="Return failed login stats grouped by user and IP, plus blocked accounts and Redis lockouts.",
)
def get_login_errors(
    days: int = 30,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    since = datetime.now(UTC) - timedelta(days=days)

    # Failed logins by user
    by_user = (
        db.query(
            AuditLog.user_id,
            User.email,
            func.count(AuditLog.id).label("count"),
        )
        .join(User, User.id == AuditLog.user_id, isouter=True)
        .filter(AuditLog.action == "login_failed", AuditLog.created_at >= since)
        .group_by(AuditLog.user_id, User.email)
        .order_by(func.count(AuditLog.id).desc())
        .limit(20)
        .all()
    )

    # Failed logins by IP
    by_ip = (
        db.query(
            AuditLog.ip_address,
            func.count(AuditLog.id).label("count"),
        )
        .filter(AuditLog.action == "login_failed", AuditLog.created_at >= since)
        .group_by(AuditLog.ip_address)
        .order_by(func.count(AuditLog.id).desc())
        .limit(20)
        .all()
    )

    # Blocked accounts
    blocked = db.query(User).filter(User.is_blocked == True).order_by(User.blocked_at.desc()).all()

    # Redis lockouts
    r = _get_redis()
    locked_users = []
    for key in r.scan_iter("lockout:*"):
        uid = int(key.split(":")[1])
        ttl = r.ttl(key)
        u = db.get(User, uid)
        if u:
            locked_users.append({"user_id": uid, "email": u.email, "ttl_seconds": ttl})

    return {
        "by_user": [
            {"user_id": row.user_id, "email": row.email, "count": row.count} for row in by_user
        ],
        "by_ip": [{"ip_address": str(row.ip_address), "count": row.count} for row in by_ip],
        "blocked_accounts": [
            {
                "id": u.id,
                "email": u.email,
                "blocked_at": u.blocked_at.isoformat() if u.blocked_at else None,
                "blocked_reason": u.blocked_reason,
            }
            for u in blocked
        ],
        "redis_lockouts": locked_users,
    }


@router.post(
    "/cleanup/audit-logs",
    summary="Cleanup old audit logs",
    description="Delete audit logs older than 90 days and impersonation messages older than 45 days.",
)
def cleanup_audit_logs(
    request: Request,
    admin: User = Depends(require_step_up),
    db: Session = Depends(get_db),
):
    cutoff = datetime.now(UTC) - timedelta(days=90)
    deleted = db.query(AuditLog).filter(AuditLog.created_at < cutoff).delete()
    msg_cutoff = datetime.now(UTC) - timedelta(days=45)
    msg_deleted = (
        db.query(ImpersonationMessage).filter(ImpersonationMessage.created_at < msg_cutoff).delete()
    )
    db.commit()
    _audit_admin(
        db,
        admin,
        "admin_cleanup_audit_logs",
        request,
        details={"audit_logs_deleted": deleted, "messages_deleted": msg_deleted},
    )
    return {"ok": True, "audit_logs_deleted": deleted, "messages_deleted": msg_deleted}
