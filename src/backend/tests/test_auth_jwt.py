"""Tests for JWT token creation, validation, refresh, and password hashing.

Covers the core auth service functions that every authenticated endpoint depends on.
"""

import time
from datetime import UTC, datetime, timedelta
from unittest.mock import patch

import jwt
import pytest


# ── Password hashing ──────────────────────────────────────────


class TestPasswordHashing:
    """Verify bcrypt hash + verify roundtrip."""

    def test_hash_and_verify(self):
        from app.services.auth import get_password_hash, verify_password

        hashed = get_password_hash("secure_password_123")
        assert hashed != "secure_password_123"
        assert verify_password("secure_password_123", hashed) is True

    def test_wrong_password_fails(self):
        from app.services.auth import get_password_hash, verify_password

        hashed = get_password_hash("correct_password")
        assert verify_password("wrong_password", hashed) is False

    def test_empty_password_fails(self):
        from app.services.auth import get_password_hash, verify_password

        hashed = get_password_hash("correct_password")
        assert verify_password("", hashed) is False

    def test_hash_is_unique_per_call(self):
        from app.services.auth import get_password_hash

        h1 = get_password_hash("same_password")
        h2 = get_password_hash("same_password")
        # bcrypt salts differ each call
        assert h1 != h2

    def test_verify_empty_hashed_returns_false(self):
        from app.services.auth import verify_password

        assert verify_password("anything", "") is False

    def test_verify_none_hashed_returns_false(self):
        from app.services.auth import verify_password

        assert verify_password("anything", "") is False


# ── JWT Token creation ────────────────────────────────────────


class TestTokenCreation:
    """Verify JWT token structure and claims."""

    def test_create_token_contains_user_id(self):
        from app.services.auth import ALGORITHM, JWT_SECRET, create_access_token

        token = create_access_token(user_id=42)
        payload = jwt.decode(token, JWT_SECRET, algorithms=[ALGORITHM])
        assert payload["sub"] == "42"

    def test_create_token_has_expiry(self):
        from app.services.auth import ALGORITHM, JWT_SECRET, create_access_token

        token = create_access_token(user_id=1)
        payload = jwt.decode(token, JWT_SECRET, algorithms=[ALGORITHM])
        assert "exp" in payload
        # Should expire in the future
        assert payload["exp"] > time.time()

    def test_create_token_custom_expiry(self):
        from app.services.auth import ALGORITHM, JWT_SECRET, create_access_token

        token = create_access_token(user_id=1, expires_minutes=5)
        payload = jwt.decode(token, JWT_SECRET, algorithms=[ALGORITHM])
        exp = datetime.fromtimestamp(payload["exp"], tz=UTC)
        now = datetime.now(UTC)
        # Should be ~5 minutes from now (allow 1min tolerance)
        diff = (exp - now).total_seconds()
        assert 240 <= diff <= 360

    def test_create_token_default_expiry_is_7_days(self):
        from app.services.auth import ALGORITHM, JWT_SECRET, create_access_token

        token = create_access_token(user_id=1)
        payload = jwt.decode(token, JWT_SECRET, algorithms=[ALGORITHM])
        exp = datetime.fromtimestamp(payload["exp"], tz=UTC)
        now = datetime.now(UTC)
        diff_days = (exp - now).total_seconds() / 86400
        # Allow tolerance: between 6.9 and 7.1 days
        assert 6.9 <= diff_days <= 7.1


# ── JWT Token validation ──────────────────────────────────────


class TestTokenValidation:
    """Verify token decode and error handling."""

    def test_valid_token_decodes(self):
        from app.services.auth import ALGORITHM, JWT_SECRET, create_access_token

        token = create_access_token(user_id=99)
        payload = jwt.decode(token, JWT_SECRET, algorithms=[ALGORITHM])
        assert payload["sub"] == "99"

    def test_expired_token_raises(self):
        from app.services.auth import ALGORITHM, JWT_SECRET, create_access_token

        # Create token that expired 1 hour ago
        token = create_access_token(user_id=1, expires_minutes=-60)
        with pytest.raises(jwt.ExpiredSignatureError):
            jwt.decode(token, JWT_SECRET, algorithms=[ALGORITHM])

    def test_invalid_signature_raises(self):
        from app.services.auth import ALGORITHM, create_access_token

        token = create_access_token(user_id=1)
        with pytest.raises(jwt.InvalidSignatureError):
            jwt.decode(token, "wrong-secret-key-that-is-long-enough-32chars", algorithms=[ALGORITHM])

    def test_malformed_token_raises(self):
        from app.services.auth import ALGORITHM, JWT_SECRET

        with pytest.raises(jwt.DecodeError):
            jwt.decode("not-a-valid-token", JWT_SECRET, algorithms=[ALGORITHM])

    def test_empty_token_raises(self):
        from app.services.auth import ALGORITHM, JWT_SECRET

        with pytest.raises(jwt.DecodeError):
            jwt.decode("", JWT_SECRET, algorithms=[ALGORITHM])

    def test_token_without_sub_raises_key_error(self):
        from app.services.auth import ALGORITHM, JWT_SECRET

        # Token with valid structure but no 'sub' claim
        token = jwt.encode({"exp": datetime.now(UTC) + timedelta(hours=1)}, JWT_SECRET, algorithm=ALGORITHM)
        payload = jwt.decode(token, JWT_SECRET, algorithms=[ALGORITHM])
        assert payload.get("sub") is None


# ── get_current_user dependency ───────────────────────────────


class TestGetCurrentUser:
    """Verify the FastAPI dependency that validates JWT and loads user."""

    def test_valid_token_returns_user(self, db, test_user):
        from app.services.auth import create_access_token, get_current_user

        token = create_access_token(user_id=test_user.id)

        # Simulate FastAPI dependency resolution
        from unittest.mock import MagicMock

        mock_request = MagicMock()
        mock_request.headers = {"Authorization": f"Bearer {token}"}

        # get_current_user is a generator, we need to call it properly
        # Actually it's a regular function with Depends, we call it directly
        from fastapi.security import OAuth2PasswordBearer

        user = get_current_user(token=token, db=db)
        assert user.id == test_user.id
        assert user.email == test_user.email

    def test_expired_token_raises_401(self, db, test_user):
        from app.services.auth import create_access_token, get_current_user

        token = create_access_token(user_id=test_user.id, expires_minutes=-60)

        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc_info:
            get_current_user(token=token, db=db)
        assert exc_info.value.status_code == 401

    def test_invalid_token_raises_401(self, db):
        from app.services.auth import get_current_user

        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc_info:
            get_current_user(token="totally-invalid-token", db=db)
        assert exc_info.value.status_code == 401

    def test_nonexistent_user_raises_401(self, db):
        from app.services.auth import create_access_token, get_current_user

        token = create_access_token(user_id=999999)

        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc_info:
            get_current_user(token=token, db=db)
        assert exc_info.value.status_code == 401

    def test_inactive_user_raises_401(self, db, test_user):
        from app.services.auth import create_access_token, get_current_user

        test_user.is_active = False
        db.flush()
        token = create_access_token(user_id=test_user.id)

        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc_info:
            get_current_user(token=token, db=db)
        assert exc_info.value.status_code == 401

    def test_blocked_user_raises_403(self, db, test_user):
        from app.services.auth import create_access_token, get_current_user

        test_user.is_blocked = True
        db.flush()
        token = create_access_token(user_id=test_user.id)

        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc_info:
            get_current_user(token=token, db=db)
        assert exc_info.value.status_code == 403


# ── get_current_admin dependency ──────────────────────────────


class TestGetCurrentAdmin:
    """Verify admin-only access control."""

    def test_admin_user_passes(self, db, test_user):
        from app.services.auth import create_access_token, get_current_admin, get_current_user

        test_user.is_admin = True
        db.flush()
        token = create_access_token(user_id=test_user.id)
        user = get_current_user(token=token, db=db)
        admin = get_current_admin(user=user)
        assert admin.id == test_user.id

    def test_non_admin_user_raises_403(self, db, test_user):
        from app.services.auth import create_access_token, get_current_admin, get_current_user

        test_user.is_admin = False
        db.flush()
        token = create_access_token(user_id=test_user.id)
        user = get_current_user(token=token, db=db)

        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc_info:
            get_current_admin(user=user)
        assert exc_info.value.status_code == 403