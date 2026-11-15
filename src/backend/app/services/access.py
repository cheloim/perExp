"""Canonical tenant scoping and ownership checks (#524).

There are three historical copies of the group scoping query with different
semantics (one filters pending members, another does not). This module is the
canonical one: the authenticated user plus the *accepted* members of the user's
*accepted* group. Until the routers are migrated (#524b), the divergent budget
helper calls the shadow comparison here and keeps returning its legacy list.
"""

from __future__ import annotations

import logging

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import GroupMember, User
from app.services.group_helpers import get_user_group

logger = logging.getLogger(__name__)


def scoped_user_ids_for(user_id: int, db: Session) -> list[int]:
    """The user plus the accepted members of their accepted group."""
    membership = get_user_group(user_id, db)
    if not membership:
        return [user_id]

    rows = (
        db.query(GroupMember.user_id)
        .filter(
            GroupMember.group_id == membership.group_id,
            GroupMember.status == "accepted",
        )
        .all()
    )
    ids = {int(row.user_id) for row in rows}
    ids.add(int(user_id))
    return sorted(ids)


def scoped_user_ids(user: User, db: Session) -> list[int]:
    return scoped_user_ids_for(user.id, db)


def assert_owned(
    db: Session,
    model,
    object_id: int,
    user_id: int,
    *,
    field: str = "user_id",
):
    """Return the row owned by ``user_id`` or raise 404 (never 403)."""
    obj = db.query(model).filter(model.id == object_id, getattr(model, field) == user_id).first()
    if obj is None:
        raise HTTPException(status_code=404, detail="No encontrado")
    return obj


def shadow_scoped_user_ids_for(
    user_id: int,
    db: Session,
    legacy_ids: list[int],
) -> list[int]:
    """Compare the canonical scope with a legacy list and log divergences.

    Returns the canonical list so callers can use it for logging without
    changing the value they return.
    """
    canonical = scoped_user_ids_for(user_id, db)
    legacy = sorted({int(value) for value in legacy_ids})
    if legacy != canonical:
        logger.warning(
            "tenant scope divergence user_id=%s canonical=%s legacy=%s",
            user_id,
            canonical,
            legacy,
        )
    return canonical
