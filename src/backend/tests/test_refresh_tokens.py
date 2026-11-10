"""Refresh-token rotation: storage, rotation, reuse detection and revocation."""

from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app.database import get_db
from app.models import RefreshToken
from app.services.auth import (
    RefreshTokenError,
    create_refresh_token,
    hash_refresh_token,
    revoke_all_refresh_tokens,
    revoke_refresh_token,
    rotate_refresh_token,
)
from main import app


def _active_tokens(db, user_id: int) -> list[RefreshToken]:
    return (
        db.query(RefreshToken)
        .filter(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
        .all()
    )


class TestRefreshTokenStorage:
    def test_create_stores_only_the_hash(self, db, test_user):
        raw = create_refresh_token(db, test_user.id, user_agent="pytest", ip_address="127.0.0.1")

        rows = db.query(RefreshToken).filter(RefreshToken.user_id == test_user.id).all()
        assert len(rows) == 1
        assert rows[0].token_hash == hash_refresh_token(raw)
        assert raw not in rows[0].token_hash
        assert rows[0].revoked_at is None
        assert rows[0].expires_at > datetime.utcnow()

    def test_each_login_gets_its_own_family(self, db, test_user):
        create_refresh_token(db, test_user.id)
        create_refresh_token(db, test_user.id)

        families = {row.family_id for row in _active_tokens(db, test_user.id)}
        assert len(families) == 2


class TestRotation:
    def test_rotate_revokes_the_old_token_and_keeps_the_family(self, db, test_user):
        raw = create_refresh_token(db, test_user.id)
        old = db.query(RefreshToken).filter_by(token_hash=hash_refresh_token(raw)).one()
        family = old.family_id

        user, new_raw = rotate_refresh_token(db, raw)

        assert user.id == test_user.id
        assert new_raw != raw
        db.refresh(old)
        assert old.revoked_at is not None
        assert old.revoked_reason == "rotated"
        new = db.query(RefreshToken).filter_by(token_hash=hash_refresh_token(new_raw)).one()
        assert new.family_id == family
        assert new.revoked_at is None

    def test_reusing_an_old_rotated_token_revokes_the_whole_family(self, db, test_user):
        raw = create_refresh_token(db, test_user.id)
        _, new_raw = rotate_refresh_token(db, raw)
        old = db.query(RefreshToken).filter_by(token_hash=hash_refresh_token(raw)).one()
        old.revoked_at = datetime.utcnow() - timedelta(minutes=5)
        db.commit()

        with pytest.raises(RefreshTokenError):
            rotate_refresh_token(db, raw)

        assert _active_tokens(db, test_user.id) == []
        with pytest.raises(RefreshTokenError):
            rotate_refresh_token(db, new_raw)

    def test_concurrent_rotation_within_the_grace_window_keeps_the_family(self, db, test_user):
        raw = create_refresh_token(db, test_user.id)
        _, new_raw = rotate_refresh_token(db, raw)

        # A second tab still holds the previous value: reject it, don't nuke
        # the session the first tab just obtained.
        with pytest.raises(RefreshTokenError):
            rotate_refresh_token(db, raw)

        active = _active_tokens(db, test_user.id)
        assert len(active) == 1
        assert active[0].token_hash == hash_refresh_token(new_raw)

    def test_expired_token_is_rejected(self, db, test_user):
        raw = create_refresh_token(db, test_user.id)
        row = db.query(RefreshToken).filter_by(token_hash=hash_refresh_token(raw)).one()
        row.expires_at = datetime.utcnow() - timedelta(seconds=1)
        db.commit()

        with pytest.raises(RefreshTokenError):
            rotate_refresh_token(db, raw)

    def test_unknown_token_is_rejected(self, db):
        with pytest.raises(RefreshTokenError):
            rotate_refresh_token(db, "not-a-real-token")

    def test_inactive_user_cannot_rotate(self, db, test_user):
        raw = create_refresh_token(db, test_user.id)
        test_user.is_active = False
        db.commit()

        with pytest.raises(RefreshTokenError):
            rotate_refresh_token(db, raw)


class TestRevocation:
    def test_logout_revokes_the_token_family(self, db, test_user):
        raw = create_refresh_token(db, test_user.id)
        _, new_raw = rotate_refresh_token(db, raw)

        assert revoke_refresh_token(db, new_raw) is True
        assert _active_tokens(db, test_user.id) == []
        with pytest.raises(RefreshTokenError):
            rotate_refresh_token(db, new_raw)

    def test_revoking_an_unknown_token_is_a_noop(self, db):
        assert revoke_refresh_token(db, "nope") is False

    def test_revoke_all_only_touches_one_user(self, db, test_user):
        from app.models import User

        other = User(
            email="other-refresh@example.com",
            full_name="Other",
            hashed_password="x",
            email_verified=True,
        )
        db.add(other)
        db.flush()
        create_refresh_token(db, test_user.id)
        create_refresh_token(db, other.id)

        revoke_all_refresh_tokens(db, test_user.id)

        assert _active_tokens(db, test_user.id) == []
        assert len(_active_tokens(db, other.id)) == 1


class TestRefreshApi:
    @pytest.fixture(autouse=True)
    def _no_rate_limit(self, monkeypatch):
        monkeypatch.setattr("app.routers.auth.check_rate_limit", lambda *a, **k: (True, 0))
        monkeypatch.setattr("app.routers.auth.is_account_locked", lambda *a, **k: (False, 0))
        monkeypatch.setattr("app.routers.auth.reset_failed_logins", lambda *a, **k: None)
        monkeypatch.setattr("app.routers.auth.record_failed_login", lambda *a, **k: 5)

    @pytest.fixture
    def client(self, db, test_user):
        app.dependency_overrides[get_db] = lambda: db
        try:
            yield TestClient(app)
        finally:
            app.dependency_overrides.clear()
            app.dependency_overrides.pop(get_db, None)

    def _login(self, client: TestClient):
        return client.post(
            "/auth/login",
            json={"email": "test@example.com", "password": "testpassword"},
        )

    def test_login_sets_both_cookies(self, client, db, test_user):
        response = self._login(client)

        assert response.status_code == 200
        cookies = response.headers.get_list("set-cookie")
        assert any(c.startswith("oikonomia_auth=") for c in cookies)
        assert any(c.startswith("oikonomia_refresh=") for c in cookies)
        assert all("HttpOnly" in c for c in cookies)
        assert db.query(RefreshToken).filter(RefreshToken.user_id == test_user.id).count() == 1

    def test_refresh_rotates_the_cookie(self, client, db, test_user):
        login = self._login(client)
        old_refresh = login.cookies.get("oikonomia_refresh")
        old_access = login.json()["access_token"]

        response = client.post("/auth/refresh", cookies={"oikonomia_refresh": old_refresh})

        assert response.status_code == 200
        assert response.json()["access_token"] != old_access
        new_refresh = response.cookies.get("oikonomia_refresh")
        assert new_refresh and new_refresh != old_refresh
        old_row = db.query(RefreshToken).filter_by(token_hash=hash_refresh_token(old_refresh)).one()
        assert old_row.revoked_at is not None

    def test_refresh_without_cookie_is_unauthorized(self, client):
        client.cookies.clear()
        response = client.post("/auth/refresh")
        assert response.status_code == 401

    def test_refresh_reuse_kills_the_family(self, client, db, test_user):
        login = self._login(client)
        old_refresh = login.cookies.get("oikonomia_refresh")
        client.post("/auth/refresh", cookies={"oikonomia_refresh": old_refresh})
        # Past the race grace window: this is a replay, not a concurrent tab.
        old_row = db.query(RefreshToken).filter_by(token_hash=hash_refresh_token(old_refresh)).one()
        old_row.revoked_at = datetime.utcnow() - timedelta(minutes=5)
        db.commit()

        client.cookies.clear()
        response = client.post("/auth/refresh", cookies={"oikonomia_refresh": old_refresh})

        assert response.status_code == 401
        assert _active_tokens(db, test_user.id) == []

    def test_logout_revokes_the_refresh_token(self, client, db, test_user):
        login = self._login(client)
        refresh = login.cookies.get("oikonomia_refresh")
        response = client.post("/auth/logout", cookies={"oikonomia_refresh": refresh})

        assert response.status_code == 200
        assert _active_tokens(db, test_user.id) == []
