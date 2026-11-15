"""Intermediate tokens must not open the API (GHSA-x54h).

The token issued between password and TOTP (and the one issued for a forced
password change) is short-lived but, before this fix, was a full access token.
"""

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.database import get_db
from app.models import User
from app.routers.notifications import _validate_token
from app.services.auth import create_access_token, get_password_hash
from main import app


@pytest.fixture(autouse=True)
def _clear_overrides():
    yield
    app.dependency_overrides.clear()


def _make_user(db, email: str) -> User:
    user = User(
        email=email,
        full_name="MFA User",
        hashed_password=get_password_hash("testpassword"),
        email_verified=True,
        mfa_enabled=True,
        mfa_secret="test-secret",
    )
    db.add(user)
    db.flush()
    return user


def _client(db) -> TestClient:
    app.dependency_overrides[get_db] = lambda: db
    return TestClient(app)


def test_partial_mfa_token_cannot_access_api(db):
    user = _make_user(db, "partial-mfa@example.com")
    db.commit()

    token = create_access_token(user.id, expires_minutes=5, scope="mfa")
    response = _client(db).get("/auth/me", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 401
    assert "incompleto" in response.json()["detail"].lower()


def test_password_change_token_cannot_access_api(db):
    user = _make_user(db, "partial-password@example.com")
    db.commit()

    token = create_access_token(user.id, expires_minutes=5, scope="password_change")
    response = _client(db).get("/auth/me", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 401
    assert "incompleto" in response.json()["detail"].lower()


def test_full_token_can_access_api(db):
    user = _make_user(db, "full-token@example.com")
    db.commit()

    token = create_access_token(user.id)
    response = _client(db).get("/auth/me", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 200
    assert response.json()["email"] == "full-token@example.com"


def test_login_mfa_rejects_a_full_access_token(db):
    user = _make_user(db, "full-as-mfa@example.com")
    db.commit()

    response = _client(db).post(
        "/auth/login/mfa",
        json={"token": create_access_token(user.id), "code": "123456"},
    )

    assert response.status_code == 401
    assert "mfa" in response.json()["detail"].lower()


def test_login_mfa_rejects_a_password_change_token(db):
    user = _make_user(db, "password-as-mfa@example.com")
    db.commit()

    token = create_access_token(user.id, expires_minutes=5, scope="password_change")
    response = _client(db).post("/auth/login/mfa", json={"token": token, "code": "123456"})

    assert response.status_code == 401
    assert "mfa" in response.json()["detail"].lower()


def test_sse_token_validator_rejects_a_partial_mfa_token(db):
    user = _make_user(db, "sse-partial@example.com")
    db.commit()

    token = create_access_token(user.id, expires_minutes=5, scope="mfa")
    with pytest.raises(HTTPException):
        _validate_token(token, db)
