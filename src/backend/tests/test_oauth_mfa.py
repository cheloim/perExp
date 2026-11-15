"""Google OAuth must not bypass MFA or a forced password change (#514)."""

import jwt
import pytest
from fastapi.testclient import TestClient

from app.database import get_db
from app.models import User
from app.routers import auth as auth_router
from app.services.auth import ALGORITHM, JWT_SECRET, get_password_hash
from main import app


def _user(db, email: str, **overrides) -> User:
    user = User(
        email=email,
        full_name=email,
        provider="google",
        provider_id=f"google-{email}",
        email_verified=True,
        hashed_password=get_password_hash("testpassword"),
        **overrides,
    )
    db.add(user)
    db.flush()
    return user


@pytest.fixture
def client(db, monkeypatch):
    async def fake_exchange(_code: str, _redirect_uri: str):
        return {"email": "oauth@example.com", "sub": "google-oauth@example.com"}

    monkeypatch.setattr(auth_router, "exchange_google_code", fake_exchange)
    app.dependency_overrides[get_db] = lambda: db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


def _callback(client: TestClient):
    return client.post(
        "/auth/oauth/callback",
        json={"provider": "google", "code": "one-time"},
    )


def _scope(token: str) -> str:
    return jwt.decode(token, JWT_SECRET, algorithms=[ALGORITHM])["scope"]


def test_oauth_with_mfa_returns_a_partial_token(client, db):
    _user(db, "oauth@example.com", mfa_enabled=True, mfa_secret="secret")

    response = _callback(client)

    assert response.status_code == 200
    body = response.json()
    assert body["mfa_required"] is True
    assert body["force_password_change"] is False
    assert _scope(body["access_token"]) == "mfa"
    cookies = response.headers.get_list("set-cookie")
    assert not any("oikonomia_refresh" in cookie for cookie in cookies)
    assert not any("oikonomia_auth" in cookie for cookie in cookies)


def test_oauth_with_force_password_change_returns_a_partial_token(client, db):
    _user(db, "oauth@example.com", force_password_change=True)

    response = _callback(client)

    assert response.status_code == 200
    body = response.json()
    assert body["force_password_change"] is True
    assert body["mfa_required"] is False
    assert _scope(body["access_token"]) == "password_change"
    assert not any(
        "oikonomia_refresh" in cookie for cookie in response.headers.get_list("set-cookie")
    )


def test_oauth_without_mfa_starts_a_full_session(client, db):
    _user(db, "oauth@example.com")

    response = _callback(client)

    assert response.status_code == 200
    body = response.json()
    assert body["mfa_required"] is False
    assert body["force_password_change"] is False
    assert _scope(body["access_token"]) == "access"
    cookies = response.headers.get_list("set-cookie")
    assert any("oikonomia_refresh" in cookie for cookie in cookies)
    assert any("oikonomia_auth" in cookie for cookie in cookies)


def test_oauth_rejects_a_blocked_user(client, db):
    _user(db, "oauth@example.com", is_blocked=True)

    response = _callback(client)

    assert response.status_code == 403
