import json
import secrets
import string
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Group, GroupMember, Notification, User
from app.services.auth import get_current_user

router = APIRouter(prefix="/groups", tags=["groups"])

MAX_MEMBERS = 5


def _generate_invite_code() -> str:
    alphabet = string.ascii_letters + string.digits
    return ''.join(secrets.choice(alphabet) for _ in range(8))


class InviteRequest(BaseModel):
    invite_code: str


class GroupMemberResponse(BaseModel):
    id: int
    user_id: int
    full_name: str
    email: str
    role: str
    status: str
    joined_at: str

    class Config:
        from_attributes = True


class FamilyGroupResponse(BaseModel):
    id: int
    name: str
    members: list[GroupMemberResponse]


def _get_user_group(user_id: int, db: Session) -> GroupMember | None:
    return (
        db.query(GroupMember)
        .filter(GroupMember.user_id == user_id, GroupMember.status == "accepted")
        .first()
    )


def get_group_user_ids(user_id: int, db: Session) -> list[int]:
    """Return all user_ids in the same family group (accepted members). Falls back to [user_id]."""
    membership = _get_user_group(user_id, db)
    if not membership:
        return [user_id]
    members = (
        db.query(GroupMember.user_id)
        .filter(GroupMember.group_id == membership.group_id, GroupMember.status == "accepted")
        .all()
    )
    return [m.user_id for m in members]


@router.get("/me", response_model=FamilyGroupResponse | None)
def get_my_group(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    membership = _get_user_group(current_user.id, db)
    if not membership:
        return None
    group = db.query(Group).filter(Group.id == membership.group_id).first()
    members = []
    for m in db.query(GroupMember).filter(
        GroupMember.group_id == group.id,
        GroupMember.status.in_(["accepted", "pending"]),
    ).all():
        u = db.query(User).filter(User.id == m.user_id).first()
        if u:
            members.append(GroupMemberResponse(
                id=m.id,
                user_id=m.user_id,
                full_name=u.full_name,
                email=u.email,
                role=m.role,
                status=m.status,
                joined_at=m.joined_at.isoformat() if m.joined_at else "",
            ))
    return FamilyGroupResponse(id=group.id, name=group.name, members=members)


@router.post("/invite", status_code=201)
def invite_user(
    body: InviteRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    target = db.query(User).filter(User.invite_code == body.invite_code).first()
    if not target:
        raise HTTPException(404, "Código de invitación inválido")
    if target.id == current_user.id:
        raise HTTPException(400, "No puedes invitarte a ti mismo")

    if _get_user_group(target.id, db):
        raise HTTPException(400, "El usuario ya pertenece a un grupo familiar")

    existing_pending = (
        db.query(GroupMember)
        .filter(GroupMember.user_id == target.id, GroupMember.status == "pending")
        .first()
    )
    if existing_pending:
        raise HTTPException(400, "El usuario ya tiene una invitación pendiente")

    inviter_membership = _get_user_group(current_user.id, db)
    if inviter_membership:
        group = db.query(Group).filter(Group.id == inviter_membership.group_id).first()
        accepted_count = (
            db.query(GroupMember)
            .filter(GroupMember.group_id == group.id, GroupMember.status == "accepted")
            .count()
        )
        if accepted_count >= MAX_MEMBERS:
            raise HTTPException(400, f"El grupo ya tiene el máximo de {MAX_MEMBERS} miembros")
    else:
        group = Group(name="Grupo Familiar", created_by=current_user.id)
        db.add(group)
        db.flush()
        db.add(GroupMember(
            group_id=group.id,
            user_id=current_user.id,
            role="admin",
            status="accepted",
        ))

    member = GroupMember(
        group_id=group.id,
        user_id=target.id,
        role="member",
        status="pending",
        invited_by=current_user.id,
    )
    db.add(member)
    db.flush()

    notif = Notification(
        user_id=target.id,
        type="group_invitation",
        title="Invitación a grupo familiar",
        body=f"{current_user.full_name} te invita a compartir gastos en grupo familiar",
        data=json.dumps({
            "group_id": group.id,
            "inviter_id": current_user.id,
            "inviter_name": current_user.full_name,
            "member_id": member.id,
        }),
    )
    db.add(notif)
    db.commit()
    return {"message": "Invitación enviada"}


@router.delete("/leave", status_code=200)
def leave_group(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    membership = _get_user_group(current_user.id, db)
    if not membership:
        raise HTTPException(400, "No perteneces a ningún grupo")

    group_id = membership.group_id
    db.delete(membership)
    db.flush()

    remaining = (
        db.query(GroupMember)
        .filter(GroupMember.group_id == group_id, GroupMember.status == "accepted")
        .count()
    )
    if remaining == 0:
        db.query(GroupMember).filter(GroupMember.group_id == group_id).delete()
        db.query(Group).filter(Group.id == group_id).delete()

    db.commit()
    return {"message": "Saliste del grupo"}


@router.get("/my-invite-code")
def get_my_invite_code(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not current_user.invite_code:
        current_user.invite_code = _generate_invite_code()
        db.commit()
    return {"invite_code": current_user.invite_code}


@router.post("/generate-invite-code")
def generate_invite_code(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    current_user.invite_code = _generate_invite_code()
    db.commit()
    return {"invite_code": current_user.invite_code}
