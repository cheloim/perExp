"""Canonical tenant scoping and shadow divergence (#524a)."""

import logging

import pytest
from fastapi import HTTPException

from app.models import Account, Group, GroupMember, User
from app.services import budget_helpers
from app.services.access import assert_owned, scoped_user_ids_for, shadow_scoped_user_ids_for
from app.services.auth import get_password_hash


def _user(db, email: str) -> User:
    user = User(
        email=email,
        full_name=email,
        hashed_password=get_password_hash("testpassword"),
        email_verified=True,
    )
    db.add(user)
    db.flush()
    return user


def _group(db, owner: User, members: list[tuple[User, str]]) -> Group:
    group = Group(name="Familia", created_by=owner.id)
    db.add(group)
    db.flush()
    for user, status in members:
        db.add(
            GroupMember(
                group_id=group.id,
                user_id=user.id,
                status=status,
                role="owner" if user.id == owner.id else "member",
            )
        )
    db.flush()
    return group


def test_scope_includes_self_and_accepted_members(db):
    owner = _user(db, "scope-owner@example.com")
    accepted = _user(db, "scope-accepted@example.com")
    pending = _user(db, "scope-pending@example.com")
    _group(db, owner, [(owner, "accepted"), (accepted, "accepted"), (pending, "pending")])

    assert scoped_user_ids_for(owner.id, db) == sorted([owner.id, accepted.id])


def test_pending_membership_gets_only_self(db):
    owner = _user(db, "pending-owner@example.com")
    pending = _user(db, "pending-user@example.com")
    _group(db, owner, [(owner, "accepted"), (pending, "pending")])

    assert scoped_user_ids_for(pending.id, db) == [pending.id]


def test_no_group_returns_self(db):
    user = _user(db, "no-group@example.com")
    assert scoped_user_ids_for(user.id, db) == [user.id]


def test_assert_owned_returns_the_row(db):
    user = _user(db, "owned@example.com")
    account = Account(name="Caja", type="efectivo", user_id=user.id)
    db.add(account)
    db.flush()

    found = assert_owned(db, Account, account.id, user.id)

    assert found.id == account.id


def test_assert_owned_cross_tenant_is_404(db):
    owner = _user(db, "assert-owner@example.com")
    other = _user(db, "assert-other@example.com")
    account = Account(name="Caja", type="efectivo", user_id=owner.id)
    db.add(account)
    db.flush()

    with pytest.raises(HTTPException) as exc:
        assert_owned(db, Account, account.id, other.id)

    assert exc.value.status_code == 404


def test_budget_shadow_logs_divergence_and_keeps_legacy(db, caplog):
    owner = _user(db, "shadow-owner@example.com")
    pending = _user(db, "shadow-pending@example.com")
    _group(db, owner, [(owner, "accepted"), (pending, "pending")])

    with caplog.at_level(logging.WARNING, logger="app.services.access"):
        legacy = budget_helpers.get_group_user_ids(owner.id, db)

    # #524a must not change behavior yet: the legacy list still includes pending.
    assert pending.id in legacy
    assert any("tenant scope divergence" in record.message for record in caplog.records)


def test_shadow_does_not_log_when_scopes_match(db, caplog):
    owner = _user(db, "shadow-equal@example.com")
    accepted = _user(db, "shadow-equal-accepted@example.com")
    _group(db, owner, [(owner, "accepted"), (accepted, "accepted")])

    with caplog.at_level(logging.WARNING, logger="app.services.access"):
        shadow_scoped_user_ids_for(owner.id, db, [owner.id, accepted.id])

    assert not any("tenant scope divergence" in record.message for record in caplog.records)
