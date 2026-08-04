"""Admin panel router — all endpoints require admin access."""

import json
import logging
import secrets
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import (
    Account,
    AuditLog,
    Card,
    Expense,
    ImpersonationMessage,
    ImpersonationSession,
    MonthlyReport,
    Notification,
    PlatformLog,
    RecurringExpense,
    Setting,
    User,
)
from app.services.auth import get_current_admin
from app.services.rate_limit import _get_redis, is_account_locked

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])


# ──────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────


def _get_admin_slug(db: Session) -> str:
    setting = db.query(Setting).filter(Setting.key == "admin_panel_slug").first()
    if not setting:
        slug = secrets.token_urlsafe(24)[:32]
        db.add(Setting(key="admin_panel_slug", value=slug))
        db.commit()
        return slug
    return setting.value


# ──────────────────────────────────────────────
# Slug
# ──────────────────────────────────────────────


@router.get("/slug")
def get_slug(admin: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    return {"slug": _get_admin_slug(db)}


# ──────────────────────────────────────────────
# Users
# ──────────────────────────────────────────────


class UserListItem(BaseModel):
    id: int
    full_name: str
    email: str
    is_active: bool
    is_admin: bool
    is_blocked: bool
    blocked_at: str | None
    blocked_reason: str | None
    created_at: str
    telegram_connected: bool
    mfa_enabled: bool
    email_verified: bool
    expense_count: int
    card_count: int
    account_count: int
    recurring_count: int
    is_locked: bool
    lock_ttl: int


@router.get("/users")
def list_users(
    search: str = "",
    page: int = 1,
    per_page: int = 50,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    query = db.query(User)
    if search:
        like = f"%{search}%"
        query = query.filter(User.email.ilike(like) | User.full_name.ilike(like))

    total = query.count()
    users = query.order_by(User.id).offset((page - 1) * per_page).limit(per_page).all()

    result = []
    for u in users:
        locked, ttl = is_account_locked(u.id)
        result.append(
            UserListItem(
                id=u.id,
                full_name=u.full_name or "",
                email=u.email,
                is_active=u.is_active,
                is_admin=u.is_admin,
                is_blocked=u.is_blocked,
                blocked_at=u.blocked_at.isoformat() if u.blocked_at else None,
                blocked_reason=u.blocked_reason,
                created_at=u.created_at.isoformat() if u.created_at else "",
                telegram_connected=bool(u.telegram_chat_hash),
                mfa_enabled=u.mfa_enabled,
                email_verified=u.email_verified,
                expense_count=db.query(Expense).filter(Expense.user_id == u.id).count(),
                card_count=db.query(Card).filter(Card.user_id == u.id).count(),
                account_count=db.query(Account).filter(Account.user_id == u.id).count(),
                recurring_count=db.query(RecurringExpense)
                .filter(RecurringExpense.user_id == u.id)
                .count(),
                is_locked=locked,
                lock_ttl=ttl,
            )
        )

    return {"users": [r.model_dump() for r in result], "total": total, "page": page}


@router.get("/users/{user_id}")
def get_user(
    user_id: int,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    u = db.get(User, user_id)
    if not u:
        raise HTTPException(404, "User not found")

    locked, ttl = is_account_locked(u.id)
    recent_logs = (
        db.query(AuditLog)
        .filter(AuditLog.user_id == u.id)
        .order_by(AuditLog.created_at.desc())
        .limit(20)
        .all()
    )

    return {
        "user": {
            "id": u.id,
            "full_name": u.full_name or "",
            "email": u.email,
            "is_active": u.is_active,
            "is_admin": u.is_admin,
            "is_blocked": u.is_blocked,
            "blocked_at": u.blocked_at.isoformat() if u.blocked_at else None,
            "blocked_reason": u.blocked_reason,
            "created_at": u.created_at.isoformat() if u.created_at else "",
            "telegram_connected": bool(u.telegram_chat_hash),
            "mfa_enabled": u.mfa_enabled,
            "email_verified": u.email_verified,
            "provider": u.provider,
            "onboarding_completed": u.onboarding_completed,
        },
        "stats": {
            "expense_count": db.query(Expense).filter(Expense.user_id == u.id).count(),
            "card_count": db.query(Card).filter(Card.user_id == u.id).count(),
            "account_count": db.query(Account).filter(Account.user_id == u.id).count(),
            "recurring_count": db.query(RecurringExpense)
            .filter(RecurringExpense.user_id == u.id)
            .count(),
            "report_count": db.query(MonthlyReport).filter(MonthlyReport.user_id == u.id).count(),
        },
        "security": {"is_locked": locked, "lock_ttl": ttl},
        "recent_audit_logs": [
            {
                "id": log.id,
                "action": log.action,
                "ip_address": str(log.ip_address) if log.ip_address else None,
                "details": log.details,
                "created_at": log.created_at.isoformat() if log.created_at else "",
            }
            for log in recent_logs
        ],
    }


class BlockRequest(BaseModel):
    reason: str = ""


@router.put("/users/{user_id}/block")
def block_user(
    user_id: int,
    body: BlockRequest,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    u = db.get(User, user_id)
    if not u:
        raise HTTPException(404, "User not found")
    if u.id == admin.id:
        raise HTTPException(400, "Cannot block yourself")
    u.is_blocked = True
    u.blocked_at = datetime.now(UTC)
    u.blocked_reason = body.reason
    db.commit()
    return {"ok": True, "message": f"User {u.email} blocked"}


@router.put("/users/{user_id}/unblock")
def unblock_user(
    user_id: int,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    u = db.get(User, user_id)
    if not u:
        raise HTTPException(404, "User not found")
    u.is_blocked = False
    u.blocked_at = None
    u.blocked_reason = None
    db.commit()
    return {"ok": True, "message": f"User {u.email} unblocked"}


@router.put("/users/{user_id}/admin")
def toggle_admin(
    user_id: int,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    u = db.get(User, user_id)
    if not u:
        raise HTTPException(404, "User not found")
    u.is_admin = not u.is_admin
    db.commit()
    return {"ok": True, "is_admin": u.is_admin}


# ──────────────────────────────────────────────
# Notifications (send to user)
# ──────────────────────────────────────────────


class SendNotificationRequest(BaseModel):
    title: str
    body: str
    type: str = "admin_message"


@router.get("/users/{user_id}/notifications")
def get_user_notifications(
    user_id: int,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    notifs = (
        db.query(Notification)
        .filter(Notification.user_id == user_id)
        .order_by(Notification.created_at.desc())
        .limit(50)
        .all()
    )
    return {
        "notifications": [
            {
                "id": n.id,
                "type": n.type,
                "title": n.title,
                "body": n.body,
                "data": json.loads(n.data or "{}"),
                "read": n.read,
                "created_at": n.created_at.isoformat() if n.created_at else "",
            }
            for n in notifs
        ]
    }


@router.post("/users/{user_id}/send-notification")
def send_notification_to_user(
    user_id: int,
    body: SendNotificationRequest,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    u = db.get(User, user_id)
    if not u:
        raise HTTPException(404, "User not found")
    notif = Notification(
        user_id=user_id,
        type=body.type,
        title=body.title,
        body=body.body,
        data=json.dumps({"from_admin": admin.id}),
    )
    db.add(notif)
    db.commit()
    return {"ok": True, "notification_id": notif.id}


# ──────────────────────────────────────────────
# Audit Logs
# ──────────────────────────────────────────────


@router.get("/audit-logs")
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
        query = query.filter(AuditLog.action == action)

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


@router.get("/login-errors")
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
    blocked = (
        db.query(User)
        .filter(User.is_blocked == True)  # noqa: E712
        .order_by(User.blocked_at.desc())
        .all()
    )

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


# ──────────────────────────────────────────────
# Reports
# ──────────────────────────────────────────────


@router.get("/reports")
def get_reports(
    user_id: int | None = None,
    month: str = "",
    status: str = "",
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    query = db.query(MonthlyReport)
    if user_id:
        query = query.filter(MonthlyReport.user_id == user_id)
    if month:
        query = query.filter(MonthlyReport.month == month)
    if status:
        query = query.filter(MonthlyReport.status == status.upper())

    reports = query.order_by(MonthlyReport.created_at.desc()).limit(100).all()

    return {
        "reports": [
            {
                "id": r.id,
                "user_id": r.user_id,
                "user_email": db.query(User.email).filter(User.id == r.user_id).scalar(),
                "month": r.month,
                "status": r.status,
                "error_message": r.error_message,
                "created_at": r.created_at.isoformat() if r.created_at else "",
                "generated_at": r.generated_at.isoformat() if r.generated_at else None,
                "has_png": r.png_data is not None,
            }
            for r in reports
        ]
    }


@router.delete("/reports/{report_id}")
def delete_report(
    report_id: int,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    report = db.get(MonthlyReport, report_id)
    if not report:
        raise HTTPException(404, "Report not found")
    db.delete(report)
    db.commit()
    return {"ok": True}


@router.delete("/reports/user/{user_id}/month/{month}")
def delete_report_by_user_month(
    user_id: int,
    month: str,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    report = (
        db.query(MonthlyReport)
        .filter(MonthlyReport.user_id == user_id, MonthlyReport.month == month)
        .first()
    )
    if not report:
        raise HTTPException(404, "Report not found")
    db.delete(report)
    db.commit()
    return {"ok": True}


# ──────────────────────────────────────────────
# System
# ──────────────────────────────────────────────


@router.get("/system/health")
def system_health(admin: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    # Redis
    redis_ok = False
    redis_latency = 0
    try:
        r = _get_redis()
        import time

        start = time.time()
        r.ping()
        redis_latency = int((time.time() - start) * 1000)
        redis_ok = True
    except Exception:
        pass

    # DB
    db_ok = False
    users_count = 0
    try:
        db.execute(text("SELECT 1"))
        users_count = db.query(User).count()
        db_ok = True
    except Exception:
        pass

    # Celery workers
    celery_workers = []
    try:
        from app.celery_app import celery_app

        inspector = celery_app.control.inspect(timeout=2.0)
        active = inspector.active() or {}
        celery_workers = list(active.keys())
    except Exception:
        pass

    return {
        "redis": {"connected": redis_ok, "latency_ms": redis_latency},
        "database": {"connected": db_ok, "users_count": users_count},
        "celery": {"workers": celery_workers, "worker_count": len(celery_workers)},
    }


@router.get("/system/tasks")
def system_tasks(admin: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    tasks = [
        "execute-due-installments-daily",
        "cleanup-expired-import-jobs-daily",
        "daily-uncategorized-expenses",
        "send-weekly-reports",
        "generate-monthly-reports",
        "suggest-uncategorized-categories-daily",
        "detect-recurring-expenses-daily",
        "check-upcoming-recurring-daily",
        "cleanup-audit-logs-daily",
    ]

    result = []
    for task_name in tasks:
        setting = db.query(Setting).filter(Setting.key == f"task_last_run:{task_name}").first()
        result.append(
            {
                "name": task_name,
                "last_run": setting.value if setting else "Never",
                "last_status": "unknown",
            }
        )

    return {"tasks": result}


@router.get("/system/settings")
def get_settings(admin: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    settings = db.query(Setting).order_by(Setting.key).all()
    return {"settings": [{"key": s.key, "value": s.value} for s in settings]}


class SettingUpdate(BaseModel):
    key: str
    value: str


@router.put("/system/settings")
def update_setting(
    body: SettingUpdate,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    setting = db.query(Setting).filter(Setting.key == body.key).first()
    if setting:
        setting.value = body.value
    else:
        db.add(Setting(key=body.key, value=body.value))
    db.commit()
    return {"ok": True}


# ──────────────────────────────────────────────
# Platform Logs
# ──────────────────────────────────────────────


@router.get("/platform-logs")
def get_platform_logs(
    level: str = "",
    module: str = "",
    search: str = "",
    page: int = 1,
    per_page: int = 100,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    query = db.query(PlatformLog)
    if level:
        query = query.filter(PlatformLog.level == level.upper())
    if module:
        query = query.filter(PlatformLog.module.ilike(f"%{module}%"))
    if search:
        query = query.filter(PlatformLog.message.ilike(f"%{search}%"))

    total = query.count()
    logs = (
        query.order_by(PlatformLog.created_at.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
        .all()
    )

    return {
        "logs": [
            {
                "id": log.id,
                "level": log.level,
                "module": log.module,
                "message": log.message,
                "details": log.details,
                "created_at": log.created_at.isoformat() if log.created_at else "",
            }
            for log in logs
        ],
        "total": total,
        "page": page,
    }


# ──────────────────────────────────────────────
# Task Execution
# ──────────────────────────────────────────────

TASK_NAME_MAP = {
    "execute-due-installments-daily": "app.tasks.scheduled_expenses.execute_due_installments",
    "cleanup-expired-import-jobs-daily": "app.tasks.cleanup_import_jobs.cleanup_expired_import_jobs",
    "daily-uncategorized-expenses": "app.tasks.daily_uncategorized.daily_uncategorized_check",
    "send-weekly-reports": "app.tasks.weekly_summary.send_weekly_reports",
    "generate-monthly-reports": "app.tasks.monthly_report.generate_monthly_reports",
    "suggest-uncategorized-categories-daily": "app.tasks.suggest_uncategorized.suggest_uncategorized_categories",
    "detect-recurring-expenses-daily": "app.tasks.detect_recurring.detect_recurring_expenses",
    "check-upcoming-recurring-daily": "app.tasks.check_upcoming_recurring.check_upcoming_recurring",
    "cleanup-audit-logs-daily": "app.tasks.cleanup_audit_logs.cleanup_old_records",
}


@router.post("/system/tasks/{task_name}/run")
def run_task(
    task_name: str,
    admin: User = Depends(get_current_admin),
):
    celery_task = TASK_NAME_MAP.get(task_name)
    if not celery_task:
        raise HTTPException(404, f"Task '{task_name}' not found")

    try:
        from app.celery_app import celery_app

        result = celery_app.send_task(celery_task)
        return {"ok": True, "task_id": result.id, "task_name": task_name}
    except Exception as e:
        logger.error(f"Failed to enqueue task {task_name}: {e}")
        raise HTTPException(500, f"Failed to enqueue task: {e}")


# ──────────────────────────────────────────────
# Bulk notify
# ──────────────────────────────────────────────


class BulkNotifyRequest(BaseModel):
    user_ids: list[int]
    title: str
    body: str


@router.post("/bulk/notify")
def bulk_notify(
    body: BulkNotifyRequest,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    if not body.user_ids:
        raise HTTPException(400, "No user IDs provided")
    if len(body.user_ids) > 500:
        raise HTTPException(400, "Max 500 users at once")

    created = 0
    for uid in body.user_ids:
        u = db.get(User, uid)
        if u:
            db.add(
                Notification(
                    user_id=uid,
                    type="admin_message",
                    title=body.title,
                    body=body.body,
                    data=json.dumps({"from_admin": admin.id}),
                )
            )
            created += 1
    db.commit()
    return {"ok": True, "sent": created}


# ──────────────────────────────────────────────
# Cleanup
# ──────────────────────────────────────────────


@router.post("/cleanup/audit-logs")
def cleanup_audit_logs(
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    cutoff = datetime.now(UTC) - timedelta(days=90)
    deleted = db.query(AuditLog).filter(AuditLog.created_at < cutoff).delete()
    msg_cutoff = datetime.now(UTC) - timedelta(days=45)
    msg_deleted = (
        db.query(ImpersonationMessage).filter(ImpersonationMessage.created_at < msg_cutoff).delete()
    )
    db.commit()
    return {"ok": True, "audit_logs_deleted": deleted, "messages_deleted": msg_deleted}


# ──────────────────────────────────────────────
# Impersonation
# ──────────────────────────────────────────────


@router.post("/impersonate/request/{user_id}")
def request_impersonation(
    user_id: int,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    target = db.get(User, user_id)
    if not target:
        raise HTTPException(404, "User not found")
    if target.id == admin.id:
        raise HTTPException(400, "Cannot impersonate yourself")
    if target.is_blocked:
        raise HTTPException(400, "Cannot impersonate blocked user")

    # Check for existing pending/active session
    existing = (
        db.query(ImpersonationSession)
        .filter(
            ImpersonationSession.admin_id == admin.id,
            ImpersonationSession.target_user_id == user_id,
            ImpersonationSession.status.in_(["pending", "active"]),
        )
        .first()
    )
    if existing:
        raise HTTPException(400, "Impersonation request already pending or active")

    session = ImpersonationSession(
        admin_id=admin.id,
        target_user_id=user_id,
        status="pending",
        expires_at=datetime.now(UTC) + timedelta(minutes=30),
    )
    db.add(session)
    db.flush()

    # Send notification to target user
    notif = Notification(
        user_id=user_id,
        type="impersonation_request",
        title="Solicitud de acceso administrativo",
        body=f"{admin.full_name or admin.email} solicita acceso a tu cuenta para soporte.",
        data=json.dumps(
            {
                "session_id": session.id,
                "admin_name": admin.full_name or admin.email,
                "expires_at": session.expires_at.isoformat() if session.expires_at else "",
            }
        ),
    )
    db.add(notif)
    db.commit()

    return {"ok": True, "session_id": session.id}


@router.get("/impersonate/{session_id}/messages")
def get_messages(
    session_id: int,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    session = db.get(ImpersonationSession, session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    if session.admin_id != admin.id:
        raise HTTPException(403, "Not your session")

    messages = (
        db.query(ImpersonationMessage)
        .filter(ImpersonationMessage.session_id == session_id)
        .order_by(ImpersonationMessage.created_at.asc())
        .all()
    )

    return {
        "messages": [
            {
                "id": m.id,
                "sender_id": m.sender_id,
                "sender_name": db.query(User.full_name).filter(User.id == m.sender_id).scalar()
                or "Unknown",
                "message": m.message,
                "created_at": m.created_at.isoformat() if m.created_at else "",
            }
            for m in messages
        ],
        "session_status": session.status,
    }


class MessageRequest(BaseModel):
    message: str


@router.post("/impersonate/{session_id}/messages")
def send_message(
    session_id: int,
    body: MessageRequest,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    session = db.get(ImpersonationSession, session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    if session.admin_id != admin.id:
        raise HTTPException(403, "Not your session")
    if session.status != "active":
        raise HTTPException(400, "Session is not active")

    msg = ImpersonationMessage(
        session_id=session_id,
        sender_id=admin.id,
        message=body.message,
    )
    db.add(msg)

    # Also send as notification to target user for real-time delivery
    target_notif = Notification(
        user_id=session.target_user_id,
        type="impersonation_message",
        title="Mensaje de administrador",
        body=body.message[:200],
        data=json.dumps({"session_id": session_id, "sender_id": admin.id}),
    )
    db.add(target_notif)
    db.commit()

    return {"ok": True, "message_id": msg.id}


@router.post("/impersonate/end/{session_id}")
def end_impersonation(
    session_id: int,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    session = db.get(ImpersonationSession, session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    if session.admin_id != admin.id:
        raise HTTPException(403, "Not your session")
    if session.status not in ("pending", "active"):
        raise HTTPException(400, "Session already ended")

    session.status = "ended"
    session.ended_at = datetime.now(UTC)

    # Collect audit logs for actions during this session
    session_start = session.created_at
    audit_logs = (
        db.query(AuditLog)
        .filter(
            AuditLog.user_id == session.target_user_id,
            AuditLog.created_at >= session_start,
        )
        .order_by(AuditLog.created_at.asc())
        .all()
    )

    # Collect chat messages
    messages = (
        db.query(ImpersonationMessage)
        .filter(ImpersonationMessage.session_id == session_id)
        .order_by(ImpersonationMessage.created_at.asc())
        .all()
    )

    # Send transcript email
    try:
        from app.services.email import send_impersonation_transcript

        admin_email = db.query(User.email).filter(User.id == session.admin_id).scalar()
        target_email = db.query(User.email).filter(User.id == session.target_user_id).scalar()

        actions = [
            {
                "action": log.action,
                "details": log.details,
                "ip_address": str(log.ip_address) if log.ip_address else None,
                "created_at": log.created_at.isoformat() if log.created_at else "",
            }
            for log in audit_logs
        ]

        chat = [
            {
                "sender": db.query(User.full_name).filter(User.id == m.sender_id).scalar()
                or "Unknown",
                "message": m.message,
                "created_at": m.created_at.isoformat() if m.created_at else "",
            }
            for m in messages
        ]

        if admin_email:
            send_impersonation_transcript(
                admin_email,
                target_email or "",
                session.created_at.isoformat() if session.created_at else "",
                session.ended_at.isoformat() if session.ended_at else "",
                actions,
                chat,
            )
    except Exception as e:
        logger.error(f"Failed to send impersonation transcript: {e}")

    # Notify target user
    notif = Notification(
        user_id=session.target_user_id,
        type="impersonation_ended",
        title="Sesión de soporte finalizada",
        body="La sesión de soporte administrativo ha finalizado. Se envió un resumen por email.",
        data=json.dumps({"session_id": session_id}),
    )
    db.add(notif)
    db.commit()

    return {"ok": True}
