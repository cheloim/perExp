import asyncio
import json
import os
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from jose import JWTError, jwt
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import GroupMember, Notification, User
from app.services.auth import get_current_user

SECRET_KEY = os.getenv("SECRET_KEY", "insecure-default-change-me")
ALGORITHM = "HS256"


class NotificationResponse(BaseModel):
    id: int
    type: str
    title: str
    body: str
    data: dict
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
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str = payload.get("sub")
        if user_id is None:
            raise credentials_exc
    except JWTError:
        raise credentials_exc
    user = db.get(User, int(user_id))
    if user is None or not user.is_active:
        raise credentials_exc
    return user


router = APIRouter(prefix="/notifications", tags=["notifications"])


class NotificationResponse(BaseModel):
    id: int
    type: str
    title: str
    body: str
    data: dict
    read: bool
    created_at: str

    class Config:
        from_attributes = True


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


@router.get("", response_model=list[NotificationResponse])
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


@router.get("/unread-count")
def unread_count(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    count = (
        db.query(Notification)
        .filter(Notification.user_id == current_user.id, Notification.read == False)  # noqa: E712
        .count()
    )
    return {"count": count}


@router.put("/{notif_id}/read", status_code=200)
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


@router.post("/{notif_id}/accept", status_code=200)
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
    if notif.type != "group_invitation":
        raise HTTPException(400, "Tipo de notificación inválido")

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

    member.status = "accepted"
    notif.read = True
    db.commit()
    return {"ok": True}


@router.post("/{notif_id}/reject", status_code=200)
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
    if notif.type != "group_invitation":
        raise HTTPException(400, "Tipo de notificación inválido")

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


@router.delete("/{notification_id}")
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


@router.get("/stream")
async def notifications_stream(request: Request, db: Session = Depends(get_db)):
    token = request.query_params.get("token")
    if not token:
        return StreamingResponse(
            _error_stream("Token requerido"),
            media_type="text/event-stream",
        )

    user = _validate_token(token, db)
    if not user:
        return StreamingResponse(
            _error_stream("Token inválido"),
            media_type="text/event-stream",
        )

    async def generate():
        poll_timeout = 60
        poll_interval = 0.5
        last_check = datetime.now()
        default_page_size = 50

        initial_notifs = (
            db.query(Notification)
            .filter(Notification.user_id == user.id)
            .order_by(Notification.created_at.desc())
            .limit(default_page_size)
            .all()
        )
        unread_count = (
            db.query(Notification)
            .filter(Notification.user_id == user.id, Notification.read == False)
            .count()
        )
        pending_count = (
            db.query(Notification)
            .filter(Notification.user_id == user.id, Notification.read == False)
            .count()
        )

        initial_payload = {
            "type": "initial",
            "notifications": [_to_response(n).model_dump() for n in initial_notifs],
            "unread_count": unread_count,
            "pending_count": pending_count,
        }
        yield f"data: {json.dumps(initial_payload)}\n\n"

        while True:
            now = datetime.now()
            elapsed = (now - last_check).total_seconds()
            if elapsed < poll_timeout:
                remaining = poll_timeout - elapsed
            else:
                remaining = 0

            new_notifs = (
                db.query(Notification)
                .filter(
                    Notification.user_id == user.id,
                    Notification.created_at > last_check,
                )
                .order_by(Notification.created_at.asc())
                .all()
            )

            if new_notifs:
                for n in new_notifs:
                    yield f"data: {json.dumps({'type': 'notification', 'notification': _to_response(n).model_dump()})}\n\n"

                unread_count = (
                    db.query(Notification)
                    .filter(Notification.user_id == user.id, Notification.read == False)
                    .count()
                )
                pending_count = unread_count
                yield f"data: {json.dumps({'type': 'counts_update', 'unread_count': unread_count, 'pending_count': pending_count})}\n\n"
                last_check = datetime.now()

            if remaining <= 0:
                yield f"data: {json.dumps({'type': 'ping'})}\n\n"
                last_check = datetime.now()
                poll_timeout = min(poll_timeout * 1.2, 120)

            await asyncio.sleep(poll_interval)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


def _error_stream(msg: str):
    yield f"data: {json.dumps({'type': 'error', 'message': msg})}\n\ndata: [DONE]\n\n"
