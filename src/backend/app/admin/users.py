"""Admin use cases: user management and direct notifications."""

import json
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.admin.common import _audit_admin, _get_admin_slug, require_step_up
from app.database import get_db
from app.models import (
    Account,
    AuditLog,
    Card,
    Expense,
    MonthlyReport,
    Notification,
    RecurringExpense,
    User,
)
from app.services.auth import get_current_admin, revoke_all_refresh_tokens
from app.services.rate_limit import is_account_locked

router = APIRouter()


@router.get(
    "/slug",
    summary="Get admin panel slug",
    description="Return the unique slug URL for accessing the admin panel.",
)
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
    provider: str | None
    expense_count: int
    card_count: int
    account_count: int
    recurring_count: int
    is_locked: bool
    lock_ttl: int


@router.get(
    "/users",
    summary="List all users",
    description="Return a paginated list of users with stats, optionally filtered by search query.",
)
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

    # Pre-fetch counts with subqueries to avoid N+1
    from sqlalchemy import func

    user_ids = [u.id for u in users]
    expense_counts = dict(
        db.query(Expense.user_id, func.count(Expense.id))
        .filter(Expense.user_id.in_(user_ids))
        .group_by(Expense.user_id)
        .all()
    )
    card_counts = dict(
        db.query(Card.user_id, func.count(Card.id))
        .filter(Card.user_id.in_(user_ids))
        .group_by(Card.user_id)
        .all()
    )
    account_counts = dict(
        db.query(Account.user_id, func.count(Account.id))
        .filter(Account.user_id.in_(user_ids))
        .group_by(Account.user_id)
        .all()
    )
    recurring_counts = dict(
        db.query(RecurringExpense.user_id, func.count(RecurringExpense.id))
        .filter(RecurringExpense.user_id.in_(user_ids))
        .group_by(RecurringExpense.user_id)
        .all()
    )

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
                provider=u.provider,
                expense_count=expense_counts.get(u.id, 0),
                card_count=card_counts.get(u.id, 0),
                account_count=account_counts.get(u.id, 0),
                recurring_count=recurring_counts.get(u.id, 0),
                is_locked=locked,
                lock_ttl=ttl,
            )
        )

    return {"users": [r.model_dump() for r in result], "total": total, "page": page}


@router.get(
    "/users/{user_id}",
    summary="Get user details",
    description="Return full user details including stats, security info, and recent audit logs.",
)
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


@router.put(
    "/users/{user_id}/block",
    summary="Block a user",
    description="Block a user account with an optional reason. Cannot block yourself.",
)
def block_user(
    user_id: int,
    body: BlockRequest,
    request: Request,
    admin: User = Depends(require_step_up),
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
    u.token_version = int(u.token_version or 0) + 1
    revoke_all_refresh_tokens(db, u.id, reason="blocked")
    db.commit()
    _audit_admin(db, admin, "admin_block_user", request, target=u, details={"reason": body.reason})
    return {"ok": True, "message": f"User {u.email} blocked"}


@router.put(
    "/users/{user_id}/unblock",
    summary="Unblock a user",
    description="Remove the block from a user account, restoring access.",
)
def unblock_user(
    user_id: int,
    request: Request,
    admin: User = Depends(require_step_up),
    db: Session = Depends(get_db),
):
    u = db.get(User, user_id)
    if not u:
        raise HTTPException(404, "User not found")
    u.is_blocked = False
    u.blocked_at = None
    u.blocked_reason = None
    db.commit()
    _audit_admin(db, admin, "admin_unblock_user", request, target=u)
    return {"ok": True, "message": f"User {u.email} unblocked"}


@router.put(
    "/users/{user_id}/admin",
    summary="Toggle admin status",
    description="Toggle the admin flag on or off for a given user.",
)
def toggle_admin(
    user_id: int,
    request: Request,
    admin: User = Depends(require_step_up),
    db: Session = Depends(get_db),
):
    u = db.get(User, user_id)
    if not u:
        raise HTTPException(404, "User not found")
    u.is_admin = not u.is_admin
    db.commit()

    # Sync admin status to Grafana
    try:
        from app.services.grafana_sync import sync_user_to_grafana

        sync_user_to_grafana(u.email, u.full_name, u.is_admin)
    except Exception:
        pass  # non-critical

    _audit_admin(
        db, admin, "admin_toggle_admin", request, target=u, details={"is_admin": u.is_admin}
    )
    return {"ok": True, "is_admin": u.is_admin}


@router.post(
    "/grafana/sync",
    summary="Sync admin users to Grafana",
    description=(
        "Reconcile Grafana against the `is_admin` flag: admins are provisioned "
        "with the Admin role, everyone else is removed. Use for initial setup or "
        "after bulk changes."
    ),
)
def sync_grafana_users(admin: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    from app.services.grafana_sync import reconcile_admins

    users = db.query(User).filter(User.is_active == True).all()
    # Todos los usuarios activos, no sólo los admins: así se borran los que
    # perdieron el flag.
    result = reconcile_admins(
        [(str(u.email), str(u.full_name or u.email), bool(u.is_admin)) for u in users]
    )
    return result


@router.post(
    "/users/{user_id}/unlock",
    summary="Unlock a user account",
    description="Clear the Redis-based rate-limit lockout for a user.",
)
def unlock_user(
    user_id: int,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """Clear Redis lockout for a user."""
    u = db.get(User, user_id)
    if not u:
        raise HTTPException(404, "User not found")
    from app.services.rate_limit import reset_failed_logins

    reset_failed_logins(user_id)
    return {"ok": True, "message": f"Lockout cleared for {u.email}"}


class SendNotificationRequest(BaseModel):
    title: str
    body: str
    type: str = "admin_message"


@router.get(
    "/users/{user_id}/notifications",
    summary="Get user notifications",
    description="Return the most recent notifications for a specific user.",
)
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


@router.post(
    "/users/{user_id}/send-notification",
    summary="Send notification to user",
    description="Send an admin notification message to a specific user.",
)
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
