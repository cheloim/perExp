"""Nominal and error paths for the auth router (#561).

These tests exercise the HTTP surface: password login, the intermediate MFA
token, registration/verification, password reset, OAuth and the Telegram
login/link variants. The security-relevant cases (partial tokens, forced
password change, revocations) must stay covered while the happy path is added.
"""

from datetime import datetime, timedelta

import jwt
import pyotp
import pytest
from fastapi.testclient import TestClient

from app.database import get_db
from app.models import RefreshToken, User
from app.routers import auth as auth_router
from app.services import auth as auth_service
from app.services.auth import (
    ALGORITHM,
    JWT_SECRET,
    create_access_token,
    get_current_user,
    get_password_hash,
)
from app.services.encryption import compute_hmac
from main import app


def _user(db, email: str = "routes@example.com", **overrides) -> User:
    overrides.setdefault("email_verified", True)
    user = User(
        email=email,
        full_name="Routes User",
        hashed_password=get_password_hash("current-password-123"),
        **overrides,
    )
    db.add(user)
    db.flush()
    return user


@pytest.fixture(autouse=True)
def _auth_env(monkeypatch):
    """Neutralise rate limiting/lockout unless a test asks for the failure."""
    monkeypatch.setattr(auth_router, "check_rate_limit", lambda *_a, **_k: (True, 0))
    monkeypatch.setattr(auth_router, "is_account_locked", lambda *_a, **_k: (False, 0))
    monkeypatch.setattr(auth_router, "record_failed_login", lambda *_a, **_k: 4)
    monkeypatch.setattr(auth_router, "reset_failed_logins", lambda *_a, **_k: None)
    yield
    app.dependency_overrides.clear()


def _client(db) -> TestClient:
    app.dependency_overrides[get_db] = lambda: db
    return TestClient(app)


def _authenticated_client(db, user: User) -> TestClient:
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


# ── Password login ────────────────────────────────────────────


def test_login_rejects_an_unknown_email(db):
    response = _client(db).post(
        "/auth/login", json={"email": "nobody@example.com", "password": "whatever"}
    )

    assert response.status_code == 401
    assert "incorrectos" in response.json()["detail"]


def test_login_wrong_password_raises_unauthorized_until_the_account_locks(db, monkeypatch):
    user = _user(db)
    db.commit()

    response = _client(db).post(
        "/auth/login", json={"email": user.email, "password": "wrong-password"}
    )

    assert response.status_code == 401


def test_login_returns_locked_when_the_failed_attempt_counter_reaches_zero(db, monkeypatch):
    user = _user(db)
    db.commit()
    monkeypatch.setattr(auth_router, "record_failed_login", lambda *_a, **_k: 0)

    response = _client(db).post(
        "/auth/login", json={"email": user.email, "password": "wrong-password"}
    )

    assert response.status_code == 423


def test_login_returns_429_when_rate_limited(db, monkeypatch):
    monkeypatch.setattr(auth_router, "check_rate_limit", lambda *_a, **_k: (False, 30))

    response = _client(db).post(
        "/auth/login", json={"email": "rate@example.com", "password": "whatever"}
    )

    assert response.status_code == 429
    assert response.headers["retry-after"] == "30"


def test_login_rejects_a_locked_account(db, monkeypatch):
    user = _user(db)
    db.commit()
    monkeypatch.setattr(auth_router, "is_account_locked", lambda *_a, **_k: (True, 60))

    response = _client(db).post(
        "/auth/login", json={"email": user.email, "password": "current-password-123"}
    )

    assert response.status_code == 423
    assert response.headers["retry-after"] == "60"


def test_login_rejects_blocked_inactive_and_unverified_accounts(db):
    blocked = _user(db, "blocked@example.com", is_blocked=True)
    inactive = _user(db, "inactive@example.com", is_active=False)
    unverified = _user(db, "unverified@example.com", email_verified=False)
    db.commit()
    client = _client(db)

    blocked_response = client.post(
        "/auth/login", json={"email": blocked.email, "password": "current-password-123"}
    )
    inactive_response = client.post(
        "/auth/login", json={"email": inactive.email, "password": "current-password-123"}
    )
    unverified_response = client.post(
        "/auth/login", json={"email": unverified.email, "password": "current-password-123"}
    )

    assert blocked_response.status_code == 403
    assert "administrador" in blocked_response.json()["detail"]
    assert inactive_response.status_code == 403
    assert unverified_response.status_code == 403


def test_login_with_mfa_returns_only_a_partial_token(db):
    user = _user(db, "mfa-login@example.com", mfa_enabled=True, mfa_secret="secret")
    db.commit()

    response = _client(db).post(
        "/auth/login", json={"email": user.email, "password": "current-password-123"}
    )

    assert response.status_code == 200
    assert response.json()["mfa_required"] is True
    assert not any(
        cookie.startswith("oikonomia_refresh=")
        for cookie in response.headers.get_list("set-cookie")
    )


def test_login_with_forced_password_change_returns_a_scoped_token(db):
    user = _user(db, "force-login@example.com", force_password_change=True)
    db.commit()

    response = _client(db).post(
        "/auth/login", json={"email": user.email, "password": "current-password-123"}
    )

    assert response.status_code == 200
    assert response.json()["force_password_change"] is True
    payload = jwt.decode(response.json()["access_token"], JWT_SECRET, algorithms=[ALGORITHM])
    assert payload["scope"] == "password_change"


def test_login_success_records_last_login_and_issues_a_refresh_token(db):
    user = _user(db, "login-ok@example.com")
    db.commit()

    response = _client(db).post(
        "/auth/login", json={"email": user.email, "password": "current-password-123"}
    )

    assert response.status_code == 200
    db.refresh(user)
    assert user.last_login is not None
    assert db.query(RefreshToken).filter(RefreshToken.user_id == user.id).count() == 1


# ── MFA completion ────────────────────────────────────────────


def test_login_mfa_rejects_a_malformed_token(db):
    response = _client(db).post("/auth/login/mfa", json={"token": "not-a-token", "code": "123456"})

    assert response.status_code == 401


def test_login_mfa_rejects_a_token_without_subject(db):
    token = jwt.encode(
        {"exp": datetime.utcnow() + timedelta(minutes=5), "scope": "mfa"},
        JWT_SECRET,
        algorithm=ALGORITHM,
    )

    response = _client(db).post("/auth/login/mfa", json={"token": token, "code": "123456"})

    assert response.status_code == 401


def test_login_mfa_rejects_an_unknown_or_inactive_user(db):
    token = create_access_token(999999, expires_minutes=5, scope="mfa")

    response = _client(db).post("/auth/login/mfa", json={"token": token, "code": "123456"})

    assert response.status_code == 401


def test_login_mfa_rejects_a_user_without_mfa_enabled(db):
    user = _user(db, "no-mfa@example.com")
    db.commit()
    token = create_access_token(user.id, expires_minutes=5, scope="mfa")

    response = _client(db).post("/auth/login/mfa", json={"token": token, "code": "123456"})

    assert response.status_code == 400


def test_login_mfa_returns_429_when_rate_limited(db, monkeypatch):
    user = _user(db, "mfa-rate@example.com", mfa_enabled=True, mfa_secret="secret")
    db.commit()
    token = create_access_token(user.id, expires_minutes=5, scope="mfa")
    monkeypatch.setattr(auth_router, "check_rate_limit", lambda *_a, **_k: (False, 12))

    response = _client(db).post("/auth/login/mfa", json={"token": token, "code": "123456"})

    assert response.status_code == 429
    assert response.headers["retry-after"] == "12"


def test_login_mfa_rejects_a_wrong_code(db):
    user = _user(
        db,
        "mfa-wrong@example.com",
        mfa_enabled=True,
        mfa_secret=pyotp.random_base32(),
    )
    db.commit()
    token = create_access_token(user.id, expires_minutes=5, scope="mfa")

    response = _client(db).post("/auth/login/mfa", json={"token": token, "code": "000000"})

    assert response.status_code == 401
    assert "MFA" in response.json()["detail"]


def test_login_mfa_success_starts_a_full_session(db):
    secret = pyotp.random_base32()
    user = _user(db, "mfa-ok@example.com", mfa_enabled=True, mfa_secret=secret)
    db.commit()
    token = create_access_token(user.id, expires_minutes=5, scope="mfa")

    response = _client(db).post(
        "/auth/login/mfa", json={"token": token, "code": pyotp.TOTP(secret).now()}
    )

    assert response.status_code == 200
    assert response.json()["mfa_required"] is False
    assert any(
        cookie.startswith("oikonomia_refresh=")
        for cookie in response.headers.get_list("set-cookie")
    )


def test_login_mfa_still_requires_a_forced_password_change(db):
    secret = pyotp.random_base32()
    user = _user(
        db,
        "mfa-force@example.com",
        mfa_enabled=True,
        mfa_secret=secret,
        force_password_change=True,
    )
    db.commit()
    token = create_access_token(user.id, expires_minutes=5, scope="mfa")

    response = _client(db).post(
        "/auth/login/mfa", json={"token": token, "code": pyotp.TOTP(secret).now()}
    )

    assert response.status_code == 200
    assert response.json()["force_password_change"] is True
    assert not any(
        cookie.startswith("oikonomia_refresh=")
        for cookie in response.headers.get_list("set-cookie")
    )


def test_login_mfa_falls_back_to_secret_key_for_legacy_tokens(db, monkeypatch):
    secret = pyotp.random_base32()
    user = _user(db, "mfa-legacy@example.com", mfa_enabled=True, mfa_secret=secret)
    db.commit()
    monkeypatch.setattr(auth_service, "JWT_SECRET", "different-jwt-secret-value-32-chars-long")
    legacy = jwt.encode(
        {
            "sub": str(user.id),
            "exp": datetime.utcnow() + timedelta(minutes=5),
            "scope": "mfa",
        },
        auth_service.SECRET_KEY,
        algorithm=ALGORITHM,
    )

    response = _client(db).post(
        "/auth/login/mfa", json={"token": legacy, "code": pyotp.TOTP(secret).now()}
    )

    assert response.status_code == 200


# ── Registration and email verification ───────────────────────


def _registration_payload(email: str = "newuser@gmail.com") -> dict:
    return {
        "full_name": "New User",
        "email": email,
        "password": "New-password-123",
    }


def test_register_returns_429_when_rate_limited(db, monkeypatch):
    monkeypatch.setattr(auth_router, "check_rate_limit", lambda *_a, **_k: (False, 9))

    response = _client(db).post("/auth/register", json=_registration_payload())

    assert response.status_code == 429


def test_register_rejects_a_duplicate_email(db):
    user = _user(db, "duplicate.user@gmail.com")
    db.commit()

    response = _client(db).post("/auth/register", json=_registration_payload(user.email))

    assert response.status_code == 409


def test_register_creates_the_user_even_if_side_effects_fail(db, monkeypatch):
    user_id = {}

    def fake_hierarchy(_db, created_id):
        user_id["value"] = created_id

    def broken_email(*_args, **_kwargs):
        raise RuntimeError("smtp down")

    def broken_grafana(*_args, **_kwargs):
        raise RuntimeError("grafana down")

    monkeypatch.setattr("app.seed._apply_base_hierarchy_for_user", fake_hierarchy)
    monkeypatch.setattr(auth_router, "send_verification_email", broken_email)
    monkeypatch.setattr("app.services.grafana_sync.sync_user_to_grafana", broken_grafana)

    response = _client(db).post(
        "/auth/register", json=_registration_payload("created.user@gmail.com")
    )

    assert response.status_code == 201
    created = db.query(User).filter(User.email == "created.user@gmail.com").one()
    assert created.email_verification_token
    assert user_id["value"] == created.id


def test_verify_email_rejects_an_invalid_token_and_accepts_a_valid_one(db):
    user = _user(db, "verify@example.com", email_verified=False, email_verification_token="tok")
    db.commit()
    client = _client(db)

    invalid = client.post("/auth/verify-email", json={"token": "nope"})
    valid = client.post("/auth/verify-email", json={"token": "tok"})

    assert invalid.status_code == 400
    assert valid.status_code == 200
    db.refresh(user)
    assert user.email_verified is True
    assert user.email_verification_token is None


def test_resend_verification_is_silent_for_unknown_or_verified_users(db):
    verified = _user(db, "already.verified@gmail.com")
    db.commit()
    client = _client(db)

    unknown = client.post("/auth/resend-verification", json={"email": "nobody.here@gmail.com"})
    already = client.post("/auth/resend-verification", json={"email": verified.email})

    assert unknown.status_code == 200
    assert already.status_code == 200


def test_resend_verification_issues_a_new_token(db, monkeypatch):
    user = _user(db, "resend.user@gmail.com", email_verified=False)
    db.commit()
    sent = {}
    monkeypatch.setattr(
        auth_router,
        "send_verification_email",
        lambda email, token, base_url: sent.update(email=email, token=token),
    )

    response = _client(db).post("/auth/resend-verification", json={"email": user.email})

    assert response.status_code == 200
    db.refresh(user)
    assert user.email_verification_token
    assert sent["token"] == user.email_verification_token


# ── OAuth callback ────────────────────────────────────────────


def _oauth_client(db, monkeypatch, google_data: dict | None = None) -> TestClient:
    async def fake_exchange(_code: str, _redirect_uri: str):
        if google_data is None:
            return {}
        return google_data

    monkeypatch.setattr(auth_router, "exchange_google_code", fake_exchange)
    return _client(db)


def test_oauth_rejects_unsupported_provider_and_missing_code(db):
    client = _client(db)

    provider = client.post("/auth/oauth/callback", json={"provider": "github", "code": "x"})
    missing = client.post("/auth/oauth/callback", json={"provider": "google", "code": ""})

    assert provider.status_code == 400
    assert missing.status_code == 400


def test_oauth_rejects_a_provider_response_without_email(db, monkeypatch):
    client = _oauth_client(db, monkeypatch, {"sub": "google-new", "name": "No Email"})

    response = client.post("/auth/oauth/callback", json={"provider": "google", "code": "x"})

    assert response.status_code == 400


def test_oauth_creates_a_new_user(db, monkeypatch):
    monkeypatch.setattr("app.seed._apply_base_hierarchy_for_user", lambda *_a, **_k: None)
    client = _oauth_client(
        db,
        monkeypatch,
        {
            "email": "oauth.new@gmail.com",
            "sub": "google-new",
            "name": "OAuth New",
            "picture": "https://example.com/avatar.png",
        },
    )

    created = client.post("/auth/oauth/callback", json={"provider": "google", "code": "x"})

    assert created.status_code == 200
    new_user = db.query(User).filter(User.email == "oauth.new@gmail.com").one()
    assert new_user.provider == "google"
    assert new_user.email_verified is True
    assert new_user.avatar_url == "https://example.com/avatar.png"


def test_oauth_links_an_existing_local_account(db, monkeypatch):
    local = _user(db, "oauth.local@gmail.com")
    db.commit()
    client = _oauth_client(
        db,
        monkeypatch,
        {"email": local.email, "sub": "google-local", "name": "OAuth Local"},
    )

    linked = client.post("/auth/oauth/callback", json={"provider": "google", "code": "x"})

    assert linked.status_code == 200
    db.refresh(local)
    assert local.provider == "google"
    assert local.provider_id == "google-local"
    assert local.email_verified is True


def test_oauth_rejects_an_email_already_bound_to_another_provider(db, monkeypatch):
    _user(
        db,
        "bound@example.com",
        provider="telegram",
        provider_id="telegram-1",
    )
    db.commit()
    client = _oauth_client(
        db,
        monkeypatch,
        {"email": "bound@example.com", "sub": "google-other", "name": "Bound"},
    )

    response = client.post("/auth/oauth/callback", json={"provider": "google", "code": "x"})

    assert response.status_code == 409


def test_oauth_rejects_inactive_and_blocked_users(db, monkeypatch):
    _user(
        db,
        "oauth-inactive@example.com",
        provider="google",
        provider_id="google-inactive",
        is_active=False,
    )
    _user(
        db,
        "oauth-blocked@example.com",
        provider="google",
        provider_id="google-blocked",
        is_blocked=True,
    )
    db.commit()

    inactive = _oauth_client(
        db, monkeypatch, {"email": "oauth-inactive@example.com", "sub": "google-inactive"}
    ).post("/auth/oauth/callback", json={"provider": "google", "code": "x"})
    blocked = _oauth_client(
        db, monkeypatch, {"email": "oauth-blocked@example.com", "sub": "google-blocked"}
    ).post("/auth/oauth/callback", json={"provider": "google", "code": "x"})

    assert inactive.status_code == 403
    assert blocked.status_code == 403


def test_oauth_stores_the_refresh_token_when_google_returns_one(db, monkeypatch):
    _user(
        db,
        "google-refresh@example.com",
        provider="google",
        provider_id="google-refresh",
    )
    db.commit()
    client = _oauth_client(
        db,
        monkeypatch,
        {
            "email": "google-refresh@example.com",
            "sub": "google-refresh",
            "refresh_token": "google-refresh-value",
        },
    )

    response = client.post("/auth/oauth/callback", json={"provider": "google", "code": "x"})

    assert response.status_code == 200
    user = db.query(User).filter(User.email == "google-refresh@example.com").one()
    assert user.google_refresh_token == "google-refresh-value"
    assert user.google_refresh_token_hmac == compute_hmac("google-refresh-value")


# ── Telegram login variants ──────────────────────────────────


def test_telegram_webapp_login_errors_and_success(db, monkeypatch):
    client = _client(db)
    monkeypatch.setattr(auth_router, "verify_telegram_webapp", lambda _data: None)
    invalid = client.post("/auth/telegram/webapp", json={"init_data": "bad"})
    assert invalid.status_code == 401

    monkeypatch.setattr(auth_router, "verify_telegram_webapp", lambda _data: {"id": None})
    missing = client.post("/auth/telegram/webapp", json={"init_data": "x"})
    assert missing.status_code == 400

    monkeypatch.setattr(auth_router, "verify_telegram_webapp", lambda _data: {"id": 123})
    unlinked = client.post("/auth/telegram/webapp", json={"init_data": "x"})
    assert unlinked.status_code == 404

    _user(db, "tg-webapp@example.com", telegram_chat_hash=compute_hmac("123"))
    db.commit()
    ok = client.post("/auth/telegram/webapp", json={"init_data": "x"})
    assert ok.status_code == 200


def test_telegram_webapp_login_rejects_inactive_and_rate_limited(db, monkeypatch):
    _user(
        db,
        "tg-webapp-inactive@example.com",
        telegram_chat_hash=compute_hmac("456"),
        is_active=False,
    )
    db.commit()
    monkeypatch.setattr(auth_router, "verify_telegram_webapp", lambda _data: {"id": 456})
    blocked = _client(db).post("/auth/telegram/webapp", json={"init_data": "x"})
    assert blocked.status_code == 403

    monkeypatch.setattr(auth_router, "check_rate_limit", lambda *_a, **_k: (False, 7))
    limited = _client(db).post("/auth/telegram/webapp", json={"init_data": "x"})
    assert limited.status_code == 429


def test_telegram_webapp_link_errors_and_success(db, monkeypatch):
    user = _user(db, "tg-link@example.com")
    _user(db, "tg-other@example.com", telegram_chat_hash=compute_hmac("999"))
    db.commit()
    client = _authenticated_client(db, user)

    monkeypatch.setattr(auth_router, "verify_telegram_webapp", lambda _data: None)
    assert client.post("/auth/telegram/link-webapp", json={"init_data": "x"}).status_code == 401

    monkeypatch.setattr(auth_router, "verify_telegram_webapp", lambda _data: {"foo": "bar"})
    no_id = client.post("/auth/telegram/link-webapp", json={"init_data": "x"})
    assert no_id.status_code == 400, no_id.text

    monkeypatch.setattr(auth_router, "verify_telegram_webapp", lambda _data: {"id": 999})
    assert client.post("/auth/telegram/link-webapp", json={"init_data": "x"}).status_code == 409

    monkeypatch.setattr(auth_router, "verify_telegram_webapp", lambda _data: {"id": 1000})
    linked = client.post("/auth/telegram/link-webapp", json={"init_data": "x"})
    assert linked.status_code == 200
    db.refresh(user)
    assert user.telegram_chat_hash == compute_hmac("1000")


def test_telegram_widget_login_errors_and_success(db, monkeypatch):
    payload = {
        "id": 555,
        "first_name": "Widget",
        "auth_date": "123",
        "hash": "abc",
    }
    client = _client(db)
    monkeypatch.setattr(auth_router, "verify_telegram_login_widget", lambda _data: None)
    assert client.post("/auth/telegram/login-widget", json=payload).status_code == 401

    monkeypatch.setattr(auth_router, "verify_telegram_login_widget", lambda _data: {"id": None})
    assert client.post("/auth/telegram/login-widget", json=payload).status_code == 400

    monkeypatch.setattr(auth_router, "verify_telegram_login_widget", lambda _data: {"id": 555})
    assert client.post("/auth/telegram/login-widget", json=payload).status_code == 404

    _user(db, "tg-widget@example.com", telegram_chat_hash=compute_hmac("555"))
    db.commit()
    assert client.post("/auth/telegram/login-widget", json=payload).status_code == 200


def test_telegram_widget_login_rejects_inactive_and_rate_limited(db, monkeypatch):
    _user(
        db,
        "tg-widget-inactive@example.com",
        telegram_chat_hash=compute_hmac("556"),
        is_active=False,
    )
    db.commit()
    monkeypatch.setattr(auth_router, "verify_telegram_login_widget", lambda _data: {"id": 556})
    payload = {"id": 556, "first_name": "Widget", "auth_date": "123", "hash": "abc"}
    assert _client(db).post("/auth/telegram/login-widget", json=payload).status_code == 403

    monkeypatch.setattr(auth_router, "check_rate_limit", lambda *_a, **_k: (False, 3))
    assert _client(db).post("/auth/telegram/login-widget", json=payload).status_code == 429


def test_telegram_oidc_login_errors_and_success(db, monkeypatch):
    from app.services import telegram_oidc

    client = _client(db)
    payload = {"code": "abc", "redirect_uri": "https://example.com/cb"}

    async def no_token(_code, _redirect):
        return {}

    monkeypatch.setattr(telegram_oidc, "exchange_code", no_token)
    assert client.post("/auth/telegram/oidc", json=payload).status_code == 401

    async def token(_code, _redirect):
        return {"id_token": "bad"}

    async def no_claims(_token):
        return None

    monkeypatch.setattr(telegram_oidc, "exchange_code", token)
    monkeypatch.setattr(telegram_oidc, "verify_id_token", no_claims)
    assert client.post("/auth/telegram/oidc", json=payload).status_code == 401

    async def claims_without_id(_token):
        return {"foo": "bar"}

    monkeypatch.setattr(telegram_oidc, "verify_id_token", claims_without_id)
    assert client.post("/auth/telegram/oidc", json=payload).status_code == 400

    async def claims(_token):
        return {"id": 700}

    monkeypatch.setattr(telegram_oidc, "verify_id_token", claims)
    assert client.post("/auth/telegram/oidc", json=payload).status_code == 404

    _user(db, "tg-oidc@example.com", telegram_chat_hash=compute_hmac("700"))
    db.commit()
    assert client.post("/auth/telegram/oidc", json=payload).status_code == 200


def test_telegram_oidc_login_rejects_inactive_and_rate_limited(db, monkeypatch):
    from app.services import telegram_oidc

    _user(
        db,
        "tg-oidc-inactive@example.com",
        telegram_chat_hash=compute_hmac("701"),
        is_active=False,
    )
    db.commit()

    async def token(_code, _redirect):
        return {"id_token": "ok"}

    async def claims(_token):
        return {"id": 701}

    monkeypatch.setattr(telegram_oidc, "exchange_code", token)
    monkeypatch.setattr(telegram_oidc, "verify_id_token", claims)
    payload = {"code": "abc", "redirect_uri": "https://example.com/cb"}
    assert _client(db).post("/auth/telegram/oidc", json=payload).status_code == 403

    monkeypatch.setattr(auth_router, "check_rate_limit", lambda *_a, **_k: (False, 1))
    assert _client(db).post("/auth/telegram/oidc", json=payload).status_code == 429


def test_telegram_state_fails_closed_and_succeeds(db, monkeypatch):
    client = _client(db)

    def unavailable():
        raise auth_router.OidcStateUnavailableError("redis down")

    monkeypatch.setattr(auth_router, "create_state", unavailable)
    assert client.get("/auth/telegram/state").status_code == 503

    monkeypatch.setattr(auth_router, "create_state", lambda: "the-state")
    response = client.get("/auth/telegram/state")
    assert response.status_code == 200
    assert response.json() == {"state": "the-state"}


def test_telegram_state_returns_429_when_rate_limited(db, monkeypatch):
    monkeypatch.setattr(auth_router, "check_rate_limit", lambda *_a, **_k: (False, 5))

    assert _client(db).get("/auth/telegram/state").status_code == 429


def test_telegram_exchange_rejects_invalid_inactive_and_blocked(db, monkeypatch):
    client = _client(db)
    monkeypatch.setattr(auth_router, "consume_login_code", lambda _code: None)
    assert client.post("/auth/telegram/exchange", json={"code": "bad"}).status_code == 401

    inactive = _user(db, "exchange-inactive@example.com", is_active=False)
    blocked = _user(db, "exchange-blocked@example.com", is_blocked=True)
    db.commit()
    monkeypatch.setattr(auth_router, "consume_login_code", lambda _code: inactive.id)
    assert client.post("/auth/telegram/exchange", json={"code": "x"}).status_code == 403
    monkeypatch.setattr(auth_router, "consume_login_code", lambda _code: blocked.id)
    assert client.post("/auth/telegram/exchange", json={"code": "x"}).status_code == 403


def test_telegram_exchange_returns_429_when_rate_limited(db, monkeypatch):
    monkeypatch.setattr(auth_router, "check_rate_limit", lambda *_a, **_k: (False, 4))

    assert _client(db).post("/auth/telegram/exchange", json={"code": "x"}).status_code == 429


def test_telegram_callback_rejects_missing_code(db):
    response = TestClient(app, follow_redirects=False).get("/auth/telegram/callback")

    assert response.status_code == 400


def test_telegram_callback_redirects_for_each_failed_step(db, monkeypatch):
    from app.services import telegram_oidc

    app.dependency_overrides[get_db] = lambda: db
    monkeypatch.setattr(auth_router, "consume_state", lambda _state: True)
    client = TestClient(app, follow_redirects=False)

    async def no_token(_code, _redirect):
        return {}

    monkeypatch.setattr(telegram_oidc, "exchange_code", no_token)
    failed = client.get("/auth/telegram/callback?code=abc&state=ok")
    assert "error=telegram_oidc_failed" in failed.headers["location"]

    async def token(_code, _redirect):
        return {"id_token": "bad"}

    async def no_claims(_token):
        return None

    monkeypatch.setattr(telegram_oidc, "exchange_code", token)
    monkeypatch.setattr(telegram_oidc, "verify_id_token", no_claims)
    invalid = client.get("/auth/telegram/callback?code=abc&state=ok")
    assert "error=telegram_token_invalid" in invalid.headers["location"]

    async def no_id(_token):
        return {"foo": "bar"}

    monkeypatch.setattr(telegram_oidc, "verify_id_token", no_id)
    no_id_response = client.get("/auth/telegram/callback?code=abc&state=ok")
    assert "error=telegram_no_id" in no_id_response.headers["location"]

    async def claims(_token):
        return {"id": 800}

    monkeypatch.setattr(telegram_oidc, "verify_id_token", claims)
    unlinked = client.get("/auth/telegram/callback?code=abc&state=ok")
    assert "error=telegram_not_linked" in unlinked.headers["location"]

    user = _user(db, "callback-inactive@example.com", telegram_chat_hash=compute_hmac("800"))
    user.is_active = False
    db.commit()
    inactive = client.get("/auth/telegram/callback?code=abc&state=ok")
    assert "error=telegram_account_issue" in inactive.headers["location"]


def test_telegram_callback_reports_state_store_unavailable(db, monkeypatch):
    from app.services import telegram_oidc

    _user(db, "callback-store@example.com", telegram_chat_hash=compute_hmac("801"))
    db.commit()
    app.dependency_overrides[get_db] = lambda: db
    monkeypatch.setattr(auth_router, "consume_state", lambda _state: True)
    monkeypatch.setattr(
        auth_router,
        "create_login_code",
        lambda _user_id: (_ for _ in ()).throw(auth_router.OidcStateUnavailableError("down")),
    )

    async def token(_code, _redirect):
        return {"id_token": "ok"}

    async def claims(_token):
        return {"id": 801}

    monkeypatch.setattr(telegram_oidc, "exchange_code", token)
    monkeypatch.setattr(telegram_oidc, "verify_id_token", claims)

    response = TestClient(app, follow_redirects=False).get(
        "/auth/telegram/callback?code=abc&state=ok"
    )

    assert "error=telegram_state_unavailable" in response.headers["location"]


def test_telegram_oidc_link_errors_and_success(db, monkeypatch):
    from app.services import telegram_oidc

    user = _user(db, "tg-link-oidc@example.com")
    _user(db, "tg-link-oidc-other@example.com", telegram_chat_hash=compute_hmac("900"))
    db.commit()
    client = _authenticated_client(db, user)
    payload = {"code": "abc", "redirect_uri": "https://example.com/cb"}

    async def no_token(_code, _redirect):
        return {}

    monkeypatch.setattr(telegram_oidc, "exchange_code", no_token)
    assert client.post("/auth/telegram/link", json=payload).status_code == 401

    async def token(_code, _redirect):
        return {"id_token": "bad"}

    async def no_claims(_token):
        return None

    monkeypatch.setattr(telegram_oidc, "exchange_code", token)
    monkeypatch.setattr(telegram_oidc, "verify_id_token", no_claims)
    assert client.post("/auth/telegram/link", json=payload).status_code == 401

    async def no_id(_token):
        return {"foo": "bar"}

    monkeypatch.setattr(telegram_oidc, "verify_id_token", no_id)
    assert client.post("/auth/telegram/link", json=payload).status_code == 400

    async def conflict_claims(_token):
        return {"id": 900}

    monkeypatch.setattr(telegram_oidc, "verify_id_token", conflict_claims)
    assert client.post("/auth/telegram/link", json=payload).status_code == 409

    async def claims(_token):
        return {"id": 901}

    monkeypatch.setattr(telegram_oidc, "verify_id_token", claims)
    linked = client.post("/auth/telegram/link", json=payload)
    assert linked.status_code == 200
    db.refresh(user)
    assert user.telegram_chat_hash == compute_hmac("901")


# ── Session and profile endpoints ────────────────────────────


def test_me_endpoints_cover_onboarding_whats_new_and_telegram_keys(db, monkeypatch):
    user = _user(db, "profile@example.com")
    db.commit()
    client = _authenticated_client(db, user)

    me = client.get("/auth/me")
    onboarding = client.put("/auth/me/onboarding")
    whats_new = client.put("/auth/me/whats-new-dismiss", json={"version": "2.0.0"})
    key = client.get("/auth/me/telegram-key")
    same_key = client.get("/auth/me/telegram-key")
    regenerated = client.post("/auth/me/telegram-key/regenerate")
    status = client.get("/auth/me/telegram-status")
    deep_link = client.get("/auth/me/telegram-deep-link")

    assert me.status_code == 200
    assert onboarding.status_code == 200
    assert onboarding.json()["onboarding_completed"] is True
    assert whats_new.status_code == 200
    assert whats_new.json()["whats_new_dismissed_version"] == "2.0.0"
    assert key.status_code == 200
    assert same_key.json()["telegram_key"] == key.json()["telegram_key"]
    assert regenerated.json()["telegram_key"] != key.json()["telegram_key"]
    assert status.json()["connected"] is False
    assert deep_link.json()["deep_link"].endswith(deep_link.json()["telegram_key"])


def test_regenerate_telegram_key_notifies_the_linked_chat(db, monkeypatch):
    user = _user(
        db,
        "tg-disconnect@example.com",
        telegram_chat_id="12345",
        telegram_chat_hash=compute_hmac("12345"),
    )
    db.commit()
    notified = []
    monkeypatch.setattr(
        "app.telegram_bot.send_disconnect_notification", lambda chat_id: notified.append(chat_id)
    )

    response = _authenticated_client(db, user).post("/auth/me/telegram-key/regenerate")

    assert response.status_code == 200
    assert notified == ["12345"]
    db.refresh(user)
    assert user.telegram_chat_id is None
    assert user.telegram_chat_hash is None


def test_change_password_covers_rate_limit_wrong_password_and_success(db, monkeypatch):
    user = _user(db)
    db.commit()
    client = _authenticated_client(db, user)

    monkeypatch.setattr(auth_router, "check_rate_limit", lambda *_a, **_k: (False, 10))
    limited = client.put(
        "/auth/password",
        json={"current_password": "current-password-123", "new_password": "New-password-123"},
    )
    assert limited.status_code == 429

    monkeypatch.setattr(auth_router, "check_rate_limit", lambda *_a, **_k: (True, 0))
    wrong = client.put(
        "/auth/password",
        json={"current_password": "wrong", "new_password": "New-password-123"},
    )
    assert wrong.status_code == 400

    old_version = user.token_version
    changed = client.put(
        "/auth/password",
        json={"current_password": "current-password-123", "new_password": "New-password-123"},
    )
    assert changed.status_code == 204
    db.refresh(user)
    assert user.token_version == old_version + 1
    assert auth_service.verify_password("New-password-123", user.hashed_password)


def test_delete_account_requires_the_password_and_deletes_on_success(db, monkeypatch):
    user = _user(db, "delete-account@example.com")
    db.commit()
    deleted = {}
    monkeypatch.setattr(
        "app.services.account_deletion.delete_user_and_all_data",
        lambda _db, target: deleted.update(user_id=target.id),
    )
    client = _authenticated_client(db, user)

    wrong = client.request("DELETE", "/auth/me", json={"current_password": "wrong-password"})
    assert wrong.status_code == 400

    ok = client.request("DELETE", "/auth/me", json={"current_password": "current-password-123"})
    assert ok.status_code == 204
    assert deleted["user_id"] == user.id


def test_force_change_password_rejects_bad_tokens_and_completes(db):
    client = _client(db)

    invalid = client.post(
        "/auth/force-change-password",
        json={"token": "not-a-token", "new_password": "New-password-123"},
    )
    assert invalid.status_code == 401

    no_sub = jwt.encode(
        {"exp": datetime.utcnow() + timedelta(minutes=5), "scope": "password_change"},
        JWT_SECRET,
        algorithm=ALGORITHM,
    )
    assert (
        client.post(
            "/auth/force-change-password",
            json={"token": no_sub, "new_password": "New-password-123"},
        ).status_code
        == 401
    )

    wrong_scope = create_access_token(1, expires_minutes=5, scope="mfa")
    assert (
        client.post(
            "/auth/force-change-password",
            json={"token": wrong_scope, "new_password": "New-password-123"},
        ).status_code
        == 401
    )

    user = _user(db, "force-change@example.com", force_password_change=True)
    db.commit()
    token = create_access_token(user.id, expires_minutes=5, scope="password_change")
    changed = client.post(
        "/auth/force-change-password",
        json={"token": token, "new_password": "New-password-123"},
    )
    assert changed.status_code == 200
    db.refresh(user)
    assert user.force_password_change is False

    reused = client.post(
        "/auth/force-change-password",
        json={"token": token, "new_password": "Another-password-123"},
    )
    assert reused.status_code == 400


def test_force_change_password_rejects_unknown_and_inactive_users(db):
    client = _client(db)
    unknown = create_access_token(999999, expires_minutes=5, scope="password_change")
    assert (
        client.post(
            "/auth/force-change-password",
            json={"token": unknown, "new_password": "New-password-123"},
        ).status_code
        == 401
    )

    inactive = _user(db, "force-inactive@example.com", force_password_change=True, is_active=False)
    db.commit()
    token = create_access_token(inactive.id, expires_minutes=5, scope="password_change")
    assert (
        client.post(
            "/auth/force-change-password",
            json={"token": token, "new_password": "New-password-123"},
        ).status_code
        == 401
    )


# ── Password reset ───────────────────────────────────────────


def test_forgot_password_hides_unknown_accounts_and_sends_for_known_ones(db, monkeypatch):
    sent = []
    monkeypatch.setattr(
        auth_router,
        "send_password_reset_email",
        lambda email, token, base_url: sent.append((email, token)),
    )
    client = _client(db)

    unknown = client.post("/auth/forgot-password", json={"email": "nobody.here@gmail.com"})
    assert unknown.status_code == 200

    user = _user(db, "forgot.user@gmail.com")
    db.commit()
    known = client.post("/auth/forgot-password", json={"email": user.email})
    assert known.status_code == 200
    db.refresh(user)
    assert user.reset_token
    assert user.reset_token_expires > datetime.utcnow()
    assert sent[0][0] == user.email


def test_forgot_password_returns_429_when_rate_limited(db, monkeypatch):
    monkeypatch.setattr(auth_router, "check_rate_limit", lambda *_a, **_k: (False, 8))

    assert (
        _client(db).post("/auth/forgot-password", json={"email": "x@gmail.com"}).status_code == 429
    )


def test_reset_password_rejects_unknown_and_expired_tokens(db):
    user = _user(db, "reset-expired@example.com")
    user.reset_token = "expired-token"
    user.reset_token_expires = datetime.utcnow() - timedelta(minutes=1)
    db.commit()
    client = _client(db)

    unknown = client.post(
        "/auth/reset-password", json={"token": "nope", "new_password": "New-password-123"}
    )
    expired = client.post(
        "/auth/reset-password",
        json={"token": "expired-token", "new_password": "New-password-123"},
    )

    assert unknown.status_code == 400
    assert expired.status_code == 400


def test_reset_password_success_revokes_existing_sessions(db):
    user = _user(db, "reset-ok@example.com")
    user.reset_token = "good-token"
    user.reset_token_expires = datetime.utcnow() + timedelta(minutes=5)
    db.commit()
    old_version = user.token_version
    refresh = auth_service.create_refresh_token(db, user.id)

    response = _client(db).post(
        "/auth/reset-password",
        json={"token": "good-token", "new_password": "New-password-123"},
    )

    assert response.status_code == 200
    db.refresh(user)
    assert user.reset_token is None
    assert user.token_version == old_version + 1
    assert auth_service.verify_password("New-password-123", user.hashed_password)
    with pytest.raises(auth_service.RefreshTokenError):
        auth_service.rotate_refresh_token(db, refresh)


# ── Refresh/logout ───────────────────────────────────────────


def test_refresh_returns_429_when_rate_limited(db, monkeypatch):
    monkeypatch.setattr(auth_router, "check_rate_limit", lambda *_a, **_k: (False, 15))

    response = _client(db).post("/auth/refresh")

    assert response.status_code == 429


def test_logout_without_a_cookie_is_idempotent(db):
    response = _client(db).post("/auth/logout")

    assert response.status_code == 200


def test_logout_all_endpoint_bumps_the_token_version(db):
    user = _user(db, "logout-all-route@example.com")
    db.commit()
    old_version = user.token_version

    response = _authenticated_client(db, user).post("/auth/logout-all")

    assert response.status_code == 200
    db.refresh(user)
    assert user.token_version == old_version + 1


# ── Client IP extraction (trusted proxy) ─────────────────────


def _request_with(client_ip: str, forwarded: str | None):
    from starlette.requests import Request

    headers = []
    if forwarded is not None:
        headers.append((b"x-forwarded-for", forwarded.encode()))
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/",
        "headers": headers,
        "client": (client_ip, 1234),
    }
    return Request(scope)


def test_client_ip_uses_the_last_forwarded_hop_only_from_a_private_peer(monkeypatch):
    from app.routers.auth import _get_client_ip

    monkeypatch.delenv("TRUSTED_PROXIES", raising=False)
    assert _get_client_ip(_request_with("10.0.0.2", "1.1.1.1, 2.2.2.2")) == "2.2.2.2"
    assert _get_client_ip(_request_with("8.8.8.8", "1.1.1.1, 2.2.2.2")) == "8.8.8.8"
    assert _get_client_ip(_request_with("10.0.0.2", " , ")) == "10.0.0.2"
    assert _get_client_ip(_request_with("10.0.0.2", None)) == "10.0.0.2"


def test_client_ip_handles_an_unparseable_peer_and_explicit_trust(monkeypatch):
    from app.routers.auth import _get_client_ip

    monkeypatch.setenv("TRUSTED_PROXIES", "proxy.internal")
    assert _get_client_ip(_request_with("proxy.internal", "3.3.3.3")) == "3.3.3.3"
    assert _get_client_ip(_request_with("proxy.internal", None)) == "proxy.internal"
