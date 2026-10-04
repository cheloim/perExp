"""Shared group helper functions used by both routers and services.

Extracted from app/routers/groups.py to break circular dependency
between services/account_deletion.py and routers/groups.py.
"""

from sqlalchemy.orm import Session

from app.models import Group, GroupMember


def get_user_group(user_id: int, db: Session) -> GroupMember | None:
    """Return the user's accepted group membership, or None."""
    return (
        db.query(GroupMember)
        .filter(GroupMember.user_id == user_id, GroupMember.status == "accepted")
        .order_by(GroupMember.id.desc())
        .first()
    )


def get_group_user_ids(user_id: int, db: Session) -> list[int]:
    """Return all user_ids in the same family group (accepted members). Falls back to [user_id]."""
    membership = get_user_group(user_id, db)
    if not membership:
        return [user_id]
    members = (
        db.query(GroupMember.user_id)
        .filter(GroupMember.group_id == membership.group_id, GroupMember.status == "accepted")
        .all()
    )
    return [m.user_id for m in members]


def remove_member(db: Session, user_id: int, member_user_id: int) -> bool:
    """Remove a member from the user's group.

    Args:
        db: Database session.
        user_id: The user initiating the removal (must be owner).
        member_user_id: The user to remove.

    Returns:
        True if removed, False if not found or not authorized.
    """
    membership = get_user_group(user_id, db)
    if not membership:
        return False

    group = db.query(Group).filter(Group.id == membership.group_id).first()
    if not group or group.created_by != user_id:
        return False

    member = (
        db.query(GroupMember)
        .filter(
            GroupMember.group_id == membership.group_id,
            GroupMember.user_id == member_user_id,
        )
        .first()
    )
    if not member:
        return False

    db.delete(member)
    db.commit()
    return True