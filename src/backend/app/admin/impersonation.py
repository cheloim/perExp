"""Admin use cases: impersonation sessions and their chat transcript."""

import json
import logging
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.admin.common import _audit_admin, require_step_up
from app.database import get_db
from app.models import AuditLog, ImpersonationMessage, ImpersonationSession, Notification, User
from app.services.auth import get_current_admin
from app.services.notify import notification_excerpt

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post(
    "/impersonate/request/{user_id}",
    summary="Request impersonation session",
    description="Request access to a user's account for support. Sends a notification for user approval.",
)
def request_impersonation(
    user_id: int,
    request: Request,
    admin: User = Depends(require_step_up),
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

    _audit_admin(
        db,
        admin,
        "admin_request_impersonation",
        request,
        target=target,
        details={"session_id": session.id},
    )
    return {"ok": True, "session_id": session.id}


@router.get(
    "/impersonate/{session_id}/messages",
    summary="Get impersonation messages",
    description="Return all chat messages for an impersonation session.",
)
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


@router.post(
    "/impersonate/{session_id}/messages",
    summary="Send impersonation message",
    description="Send a chat message in an active impersonation session and notify the target user.",
)
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
        body=notification_excerpt(body.message),
        data=json.dumps({"session_id": session_id, "sender_id": admin.id}),
    )
    db.add(target_notif)
    db.commit()

    return {"ok": True, "message_id": msg.id}


@router.post(
    "/impersonate/end/{session_id}",
    summary="End impersonation session",
    description="End an impersonation session, send a transcript email, and notify the target user.",
)
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
