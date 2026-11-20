"""Session revocation (#536): a bumped token_version invalidates old JWTs."""

from datetime import datetime, timedelta

import pytest
from fastapi import HTTPException, Response
from fastapi.testclient import TestClient

from app.models import User
from app.routers.auth import logout_all, reset_password
from app.schemas import ResetPasswordRequest
from app.services.auth import (
    create_access_token,
    get_current_user,
    get_password_hash,
)
from main import app


def _user(db, email: str = "revocation@example.com") -> User:
    user = User(
        email=email,
        full_name="Revocation",
        hashed_password=get_password_hash("old-password"),
        email_verified=True,
        token_version=0,
    )
    db.add(user)
    db.flush()
    return user


def test_password_reset_invalidates_a_token_issued_before_it(db):
    user = _user(db)
    old_token = create_access_token(user.id, token_version=user.token_version)
    user.reset_token = "reset-me"
    user.reset_token_expires = datetime.utcnow() + timedelta(minutes=10)
    db.flush()

    reset_password(
        ResetPasswordRequest(token="reset-me", new_password="New-password-123"),
        db=db,
    )

    with pytest.raises(HTTPException) as exc:
        get_current_user(token=old_token, db=db)

    assert exc.value.status_code == 401


def test_logout_all_invalidates_every_old_token_and_keeps_the_new_one(db):
    user = _user(db, "logout-all@example.com")
    old_token = create_access_token(user.id, token_version=user.token_version)

    logout_all(response=Response(), current_user=user, db=db)

    with pytest.raises(HTTPException):
        get_current_user(token=old_token, db=db)

    new_token = create_access_token(user.id, token_version=user.token_version)
    assert get_current_user(token=new_token, db=db).id == user.id


def test_logout_all_endpoint_requires_a_session(db):
    app.dependency_overrides.clear()
    try:
        response = TestClient(app).post("/auth/logout-all")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 401
