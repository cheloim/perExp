import asyncio
import json
from collections.abc import Callable
from datetime import datetime
from typing import Any

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from jwt import PyJWTError as JWTError
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import SessionLocal, get_db
from app.models import GroupMember, Notification, User
from app.services.auth import ALGORITHM, JWT_SECRET, SECRET_KEY, get_current_user


class NotificationResponse(BaseModel):
    id: int
    type: str
    title: str
    body: str
    data: Any
    read: bool
    created_at: str

    class Config:
        from_attributes = True


class InitialNotifications(BaseModel):
    notifications: list[NotificationResponse]
    unread_count: int
    pending_count: int


def _to_response(n: Notification) -> NotificationResponse:
    return NotificationResponse(
        id=n.id,
        type=n.type,
        title=n.title,
        body=n.body,
        data=json.loads(n.data or "{}"),
        read=n.read,
        created_at=n.created_at.isoformat() if n.created_at else "",
    )


def _validate_token(token: str, db: Session) -> User:
    credentials_exc = HTTPException(
        status_code=401,
        detail="Token inválido o expirado",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        try:
            payload = jwt.decode(token, JWT_SECRET, algorithms=[ALGORITHM])
        except JWTError:
            if JWT_SECRET != SECRET_KEY:
                payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
            else:
                raise
        user_id: str = payload.get("sub")
        if user_id is None:
            raise credentials_exc
        # The SSE endpoint validates tokens itself; keep the same rule as
        # get_current_user so a partial MFA token cannot open the stream.
        if payload.get("scope", "access") != "access":
            raise credentials_exc
    except JWTError:
        raise credentials_exc
    user = db.get(User, int(user_id))
    if user is None or not user.is_active:
        raise credentials_exc
    return user


router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get(
    "",
    response_model=list[NotificationResponse],
    summary="List all notifications",
    description="Retrieve all notifications for the current user ordered by creation date descending.",
)
def get_notifications(
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    notifs = (
        db.query(Notification)
        .filter(Notification.user_id == current_user.id)
        .order_by(Notification.created_at.desc())
        .all()
    )
    return [_to_response(n) for n in notifs]


@router.get(
    "/unread-count",
    summary="Get unread notification count",
    description="Return the count of unread notifications for the current user.",
)
def unread_count(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    count = (
        db.query(Notification)
        .filter(Notification.user_id == current_user.id, Notification.read == False)
        .count()
    )
    return {"count": count}


@router.put(
    "/{notif_id}/read",
    status_code=200,
    summary="Mark notification as read",
    description="Mark a single notification as read by its ID.",
)
def mark_read(
    notif_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    notif = (
        db.query(Notification)
        .filter(Notification.id == notif_id, Notification.user_id == current_user.id)
        .first()
    )
    if not notif:
        raise HTTPException(404, "Notificación no encontrada")
    notif.read = True
    db.commit()
    return {"ok": True}


@router.put(
    "/read-all",
    status_code=200,
    summary="Mark all notifications as read",
    description="Mark all unread notifications for the current user as read.",
)
def mark_all_read(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.query(Notification).filter(
        Notification.user_id == current_user.id,
        Notification.read == False,
    ).update({Notification.read: True})
    db.commit()
    return {"ok": True}


@router.delete(
    "/read-all",
    status_code=200,
    summary="Delete all read notifications",
    description="Permanently delete all notifications that have been marked as read.",
)
def delete_all_read(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.query(Notification).filter(
        Notification.user_id == current_user.id,
        Notification.read == True,
    ).delete()
    db.commit()
    return {"ok": True}


@router.delete(
    "/all",
    status_code=200,
    summary="Delete all notifications",
    description="Permanently delete every notification belonging to the current user.",
)
def delete_all_notifications(
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    deleted = (
        db.query(Notification)
        .filter(Notification.user_id == current_user.id)
        .delete(synchronize_session=False)
    )
    db.commit()
    return {"ok": True, "deleted": deleted}


@router.post(
    "/{notif_id}/accept",
    status_code=200,
    summary="Accept a notification action",
    description="Accept a group invitation or impersonation request from a notification.",
)
def accept_invitation(
    notif_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    notif = (
        db.query(Notification)
        .filter(Notification.id == notif_id, Notification.user_id == current_user.id)
        .first()
    )
    if not notif:
        raise HTTPException(404, "Notificación no encontrada")

    if notif.type == "group_invitation":
        from app.routers.groups import _get_user_group

        data = json.loads(notif.data or "{}")
        member_id = data.get("member_id")
        if not member_id:
            raise HTTPException(400, "Datos de invitación inválidos")

        member = (
            db.query(GroupMember)
            .filter(GroupMember.id == member_id, GroupMember.user_id == current_user.id)
            .first()
        )
        if not member:
            raise HTTPException(404, "Invitación no encontrada")
        if member.status != "pending":
            raise HTTPException(400, "La invitación ya fue procesada")

        # Check user hasn't joined another group since invitation
        existing = _get_user_group(current_user.id, db)
        if existing and existing.group_id != member.group_id:
            raise HTTPException(400, "Ya perteneces a otro grupo familiar")

        member.status = "accepted"
        notif.read = True
        db.commit()
        return {"ok": True}

    elif notif.type == "impersonation_request":
        from app.models import ImpersonationSession

        data = json.loads(notif.data or "{}")
        session_id = data.get("session_id")
        if not session_id:
            raise HTTPException(400, "Datos de solicitud inválidos")

        session = db.get(ImpersonationSession, session_id)
        if not session:
            raise HTTPException(404, "Sesión no encontrada")
        if session.status != "pending":
            raise HTTPException(400, "La solicitud ya fue procesada")

        # Activate session
        from datetime import UTC, timedelta

        from app.services.auth import create_access_token

        session.status = "active"
        session.token = create_access_token(current_user.id, expires_minutes=30)
        session.expires_at = datetime.now(UTC) + timedelta(minutes=30)
        notif.read = True

        # Notify admin that impersonation was accepted
        admin_notif = Notification(
            user_id=session.admin_id,
            type="impersonation_accepted",
            title="Acceso aceptado",
            body=f"{current_user.full_name or current_user.email} aceptó la solicitud de acceso.",
            data=json.dumps({"session_id": session_id, "token": session.token}),
        )
        db.add(admin_notif)
        db.commit()
        return {"ok": True, "token": session.token, "session_id": session_id}

    else:
        raise HTTPException(400, "Tipo de notificación inválido")


@router.post(
    "/{notif_id}/reject",
    status_code=200,
    summary="Reject a notification action",
    description="Reject a group invitation or impersonation request from a notification.",
)
def reject_invitation(
    notif_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    notif = (
        db.query(Notification)
        .filter(Notification.id == notif_id, Notification.user_id == current_user.id)
        .first()
    )
    if not notif:
        raise HTTPException(404, "Notificación no encontrada")

    if notif.type == "group_invitation":
        data = json.loads(notif.data or "{}")
        member_id = data.get("member_id")
        if member_id:
            member = (
                db.query(GroupMember)
                .filter(GroupMember.id == member_id, GroupMember.user_id == current_user.id)
                .first()
            )
            if member and member.status == "pending":
                db.delete(member)

        notif.read = True
        db.commit()
        return {"ok": True}

    elif notif.type == "impersonation_request":
        from app.models import ImpersonationSession

        data = json.loads(notif.data or "{}")
        session_id = data.get("session_id")
        if session_id:
            session = db.get(ImpersonationSession, session_id)
            if session and session.status == "pending":
                session.status = "rejected"
                session.ended_at = datetime.utcnow()

                # Notify admin
                admin_notif = Notification(
                    user_id=session.admin_id,
                    type="impersonation_rejected",
                    title="Acceso rechazado",
                    body=f"{current_user.full_name or current_user.email} rechazó la solicitud de acceso.",
                    data=json.dumps({"session_id": session_id}),
                )
                db.add(admin_notif)

        notif.read = True
        db.commit()
        return {"ok": True}

    else:
        raise HTTPException(400, "Tipo de notificación inválido")


@router.delete(
    "/{notification_id}",
    summary="Delete a notification",
    description="Permanently delete a notification. Only the owner can delete their notifications.",
)
def delete_notification(
    notification_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Delete a notification.
    Only the owner can delete their notifications.
    """
    notification = (
        db.query(Notification)
        .filter(
            Notification.id == notification_id,
            Notification.user_id == current_user.id,  # SECURITY: Only owner
        )
        .first()
    )

    if not notification:
        raise HTTPException(404, "Notification not found")

    db.delete(notification)
    db.commit()

    return {"deleted": True}


@router.get(
    "/stream",
    summary="Real-time notification stream",
    description="SSE endpoint that streams new notifications in real-time. Each poll opens and closes its own DB session so an idle client never holds a pool connection.",
)
async def notifications_stream(request: Request):
    # Accept token from Authorization header or query param (for backward compat)
    auth_header = request.headers.get("Authorization", "")
    token = None
    if auth_header.startswith("Bearer "):
        token = auth_header[7:]
    if not token:
        token = request.query_params.get("token")
    if not token:
        return StreamingResponse(
            _error_stream("Token requerido"),
            media_type="text/event-stream",
        )

    # Validate the token with a short-lived session, then close it before
    # starting the stream.
    temp_db = SessionLocal()
    try:
        user = _validate_token(token, temp_db)
    finally:
        temp_db.close()

    if not user:
        return StreamingResponse(
            _error_stream("Token inválido"),
            media_type="text/event-stream",
        )

    return StreamingResponse(
        _notification_events(user, request),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


def _load_initial_notifications(
    user_id: int, session_factory: Callable[[], Session] = SessionLocal
) -> dict[str, Any]:
    """Initial page for a new stream. Opens and closes its own session."""
    db = session_factory()
    try:
        initial_notifs = (
            db.query(Notification)
            .filter(Notification.user_id == user_id)
            .order_by(Notification.created_at.desc())
            .limit(50)
            .all()
        )
        unread_count = (
            db.query(Notification)
            .filter(Notification.user_id == user_id, Notification.read == False)
            .count()
        )
        pending_count = (
            db.query(Notification)
            .filter(
                Notification.user_id == user_id,
                Notification.type == "group_invitation",
                Notification.read == False,
            )
            .count()
        )
        return {
            "type": "initial",
            "notifications": [_to_response(n).model_dump() for n in initial_notifs],
            "unread_count": unread_count,
            "pending_count": pending_count,
        }
    finally:
        db.close()


def _load_notification_updates(
    user_id: int,
    since: datetime,
    session_factory: Callable[[], Session] = SessionLocal,
) -> tuple[list[dict[str, Any]], int, int, datetime | None]:
    """Rows created after ``since``. Opens and closes its own session."""
    db = session_factory()
    try:
        new_notifs = (
            db.query(Notification)
            .filter(Notification.user_id == user_id, Notification.created_at > since)
            .order_by(Notification.created_at.asc())
            .all()
        )
        if not new_notifs:
            return [], 0, 0, None

        rows = [_to_response(n).model_dump() for n in new_notifs]
        unread_count = (
            db.query(Notification)
            .filter(Notification.user_id == user_id, Notification.read == False)
            .count()
        )
        pending_count = (
            db.query(Notification)
            .filter(
                Notification.user_id == user_id,
                Notification.type == "group_invitation",
                Notification.read == False,
            )
            .count()
        )
        return rows, unread_count, pending_count, new_notifs[-1].created_at
    finally:
        db.close()


async def _notification_events(
    user: User,
    request: Request,
    session_factory: Callable[[], Session] = SessionLocal,
    poll_interval: float = 2.0,
):
    PING_INTERVAL = 30
    last_check = datetime.utcnow()
    last_ping = datetime.utcnow()

    initial_payload = await asyncio.to_thread(_load_initial_notifications, user.id, session_factory)
    yield f"data: {json.dumps(initial_payload)}\n\n"

    while True:
        if await request.is_disconnected():
            break

        try:
            rows, unread_count, pending_count, latest = await asyncio.to_thread(
                _load_notification_updates, user.id, last_check, session_factory
            )
        except Exception:
            # A transient DB error must not kill the stream; the next poll
            # opens a fresh session.
            rows, unread_count, pending_count, latest = [], 0, 0, None

        if rows:
            for row in rows:
                yield f"data: {json.dumps({'type': 'notification', 'notification': row})}\n\n"
            yield f"data: {json.dumps({'type': 'counts_update', 'unread_count': unread_count, 'pending_count': pending_count})}\n\n"
            if latest is not None:
                last_check = max(last_check, latest)

        now = datetime.utcnow()
        if (now - last_ping).total_seconds() >= PING_INTERVAL:
            yield f"data: {json.dumps({'type': 'ping'})}\n\n"
            last_ping = now

        await asyncio.sleep(poll_interval)


def _error_stream(msg: str):
    yield f"data: {json.dumps({'type': 'error', 'message': msg})}\n\ndata: [DONE]\n\n"
