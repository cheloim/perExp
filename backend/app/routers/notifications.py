import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import GroupMember, Notification, User
from app.services.auth import get_current_user

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
def get_notifications(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
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
def mark_read(notif_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    notif = db.query(Notification).filter(Notification.id == notif_id, Notification.user_id == current_user.id).first()
    if not notif:
        raise HTTPException(404, "Notificación no encontrada")
    notif.read = True
    db.commit()
    return {"ok": True}


@router.post("/{notif_id}/accept", status_code=200)
def accept_invitation(notif_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    notif = db.query(Notification).filter(Notification.id == notif_id, Notification.user_id == current_user.id).first()
    if not notif:
        raise HTTPException(404, "Notificación no encontrada")
    if notif.type != "group_invitation":
        raise HTTPException(400, "Tipo de notificación inválido")

    data = json.loads(notif.data or "{}")
    member_id = data.get("member_id")
    if not member_id:
        raise HTTPException(400, "Datos de invitación inválidos")

    member = db.query(GroupMember).filter(GroupMember.id == member_id, GroupMember.user_id == current_user.id).first()
    if not member:
        raise HTTPException(404, "Invitación no encontrada")
    if member.status != "pending":
        raise HTTPException(400, "La invitación ya fue procesada")

    member.status = "accepted"
    notif.read = True
    db.commit()
    return {"ok": True}


@router.post("/{notif_id}/reject", status_code=200)
def reject_invitation(notif_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    notif = db.query(Notification).filter(Notification.id == notif_id, Notification.user_id == current_user.id).first()
    if not notif:
        raise HTTPException(404, "Notificación no encontrada")
    if notif.type != "group_invitation":
        raise HTTPException(400, "Tipo de notificación inválido")

    data = json.loads(notif.data or "{}")
    member_id = data.get("member_id")
    if member_id:
        member = db.query(GroupMember).filter(GroupMember.id == member_id, GroupMember.user_id == current_user.id).first()
        if member and member.status == "pending":
            db.delete(member)

    notif.read = True
    db.commit()
    return {"ok": True}
