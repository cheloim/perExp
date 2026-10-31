"""Tests for the one-time OIDC state and login code flow (#515).

The state prevents CSRF/session fixation in the redirect, and the login code
keeps the access token out of the URL. Both are single-use and fail closed when
Redis is unavailable.
"""

import pytest
from fastapi.testclient import TestClient

from app.database import get_db
from app.models import User
from app.routers import auth as auth_router
from app.services import oidc_state
from app.services.auth import get_password_hash
from app.services.encryption import compute_hmac
from main import app


class FakeRedis:
    def __init__(self) -> None:
        self.values: dict[str, str] = {}
        self.expires: dict[str, int] = {}

    def setex(self, key: str, ttl: int, value: str) -> None:
        self.values[key] = value
        self.expires[key] = ttl

    def getdel(self, key: str) -> str | None:
        self.expires.pop(key, None)
        return self.values.pop(key, None)

    def get(self, key: str) -> str | None:
        return self.values.get(key)

    def delete(self, *keys: str) -> None:
        for key in keys:
            self.values.pop(key, None)
            self.expires.pop(key, None)


@pytest.fixture
def fake_redis(monkeypatch):
    fake = FakeRedis()
    monkeypatch.setattr(oidc_state, "_get_redis", lambda: fake)
    return fake


@pytest.fixture(autouse=True)
def _clear_overrides():
    yield
    app.dependency_overrides.clear()


def _make_user(db, email: str, tg_id: int) -> User:
    user = User(
        email=email,
        full_name="Telegram User",
        hashed_password=get_password_hash("testpassword"),
        email_verified=True,
        telegram_chat_hash=compute_hmac(str(tg_id)),
    )
    db.add(user)
    db.flush()
    return user


def test_state_is_single_use(fake_redis):
    state = oidc_state.create_state()
    assert state
    assert oidc_state.consume_state(state) is True
    assert oidc_state.consume_state(state) is False


def test_empty_state_is_invalid(fake_redis):
    assert oidc_state.consume_state("") is False


def test_login_code_maps_to_user_and_is_single_use(fake_redis):
    code = oidc_state.create_login_code(42)
    assert oidc_state.consume_login_code(code) == 42
    assert oidc_state.consume_login_code(code) is None


def test_redis_down_fails_closed(monkeypatch):
    def unavailable():
        raise ConnectionError("redis down")

    monkeypatch.setattr(oidc_state, "_get_redis", unavailable)

    assert oidc_state.consume_state("state") is False
    assert oidc_state.consume_login_code("code") is None
    with pytest.raises(oidc_state.OidcStateUnavailableError):
        oidc_state.create_state()


def test_exchange_returns_token_and_cannot_be_replayed(db, fake_redis, monkeypatch):
    user = _make_user(db, "exchange@example.com", tg_id=111)
    db.commit()
    app.dependency_overrides[get_db] = lambda: db
    monkeypatch.setattr(auth_router, "check_rate_limit", lambda *_: (True, 0))

    code = oidc_state.create_login_code(user.id)
    client = TestClient(app)

    first = client.post("/auth/telegram/exchange", json={"code": code})
    assert first.status_code == 200
    assert first.json()["access_token"]

    second = client.post("/auth/telegram/exchange", json={"code": code})
    assert second.status_code == 401


def test_callback_rejects_invalid_state(db, monkeypatch):
    app.dependency_overrides[get_db] = lambda: db
    monkeypatch.setattr(auth_router, "consume_state", lambda _: False)

    client = TestClient(app, follow_redirects=False)
    response = client.get("/auth/telegram/callback?code=abc&state=bad")

    assert response.status_code in (302, 307)
    location = response.headers["location"]
    assert "error=telegram_state_invalid" in location
    assert "token=" not in location


def test_callback_redirects_with_one_time_code_not_token(db, monkeypatch):
    tg_id = 222
    _make_user(db, "callback@example.com", tg_id=tg_id)
    db.commit()
    app.dependency_overrides[get_db] = lambda: db

    monkeypatch.setattr(auth_router, "consume_state", lambda _: True)
    monkeypatch.setattr(auth_router, "create_login_code", lambda _user_id: "one-time-code")

    async def fake_exchange(_code: str, _redirect_uri: str):
        return {"id_token": "fake"}

    async def fake_verify(_id_token: str):
        return {"id": tg_id}

    monkeypatch.setattr("app.services.telegram_oidc.exchange_code", fake_exchange)
    monkeypatch.setattr("app.services.telegram_oidc.verify_id_token", fake_verify)

    client = TestClient(app, follow_redirects=False)
    response = client.get("/auth/telegram/callback?code=abc&state=good")

    assert response.status_code in (302, 307)
    location = response.headers["location"]
    assert "code=one-time-code" in location
    assert "state=good" in location
    assert "token=" not in location
