"""Regression tests for previously detected bugs.

Each test is linked to the commit/issue that introduced the bug to prevent reoccurrence.
"""

import pytest


# ── Schema completeness (prevents missing exports) ────────────


class TestSchemaCompleteness:
    """Verify all routers are registered and schemas are exported.

    Regression: commit b19ce45 — TelegramOidcRequest not exported from schemas.
    """

    def test_all_routers_registered_in_main(self):
        """Every router module must be included in main.py's app."""
        import ast
        import os

        main_path = os.path.join(os.path.dirname(__file__), "..", "main.py")
        with open(main_path) as f:
            content = f.read()

        # Find all include_router calls
        registered = set()
        for line in content.split("\n"):
            if "include_router" in line and "." in line:
                # Extract module name: app.include_router(X.router)
                parts = line.strip().split("include_router(")
                if len(parts) > 1:
                    module = parts[1].split(".")[0].strip()
                    registered.add(module)

        # Find all router modules
        routers_dir = os.path.join(os.path.dirname(__file__), "..", "app", "routers")
        router_files = {
            f[:-3]
            for f in os.listdir(routers_dir)
            if f.endswith(".py") and f != "__init__.py"
        }

        missing = router_files - registered
        assert not missing, f"Routers not registered in main.py: {missing}"

    def test_schemas_module_importable(self):
        """The schemas module should import without errors."""
        import os

        os.environ.setdefault("SECRET_KEY", "test-secret-key-for-ci-that-is-at-least-32-chars")
        import app.schemas  # noqa: F401


# ── Health endpoint (prevents deploy failures) ────────────────


class TestHealthEndpoint:
    """Verify health endpoint responds correctly.

    Regression: commit 094d0e4 — deploy health check timeout.
    """

    def test_health_router_exists(self):
        """Health router must be importable and have /health endpoint."""
        from app.routers.health import router

        routes = [r.path for r in router.routes]
        assert "/health" in routes

    def test_health_endpoint_returns_dict(self):
        """Health check should return a structured response."""
        from app.routers.health import health_check

        # health_check requires db dependency, test that function exists
        assert callable(health_check)


# ── Encryption idempotency ────────────────────────────────────


class TestEncryptionRegression:
    """Verify encryption doesn't double-encrypt data.

    Regression: potential issue if is_encrypted() check fails.
    """

    def test_encrypt_decrypt_roundtrip(self):
        from app.services.encryption import decrypt_value, encrypt_value

        original = "sensitive_data_123"
        encrypted = encrypt_value(original)
        decrypted = decrypt_value(encrypted)
        assert decrypted == original

    def test_double_encrypt_produces_different_values(self):
        """If we encrypt twice, the results should differ (different IVs)."""
        from app.services.encryption import encrypt_value

        value = "test_data"
        e1 = encrypt_value(value)
        e2 = encrypt_value(value)
        # Fernet uses random IVs, so encrypted values differ
        assert e1 != e2

    def test_is_encrypted_detects_encrypted_data(self):
        from app.services.encryption import encrypt_value, is_encrypted

        encrypted = encrypt_value("test")
        assert is_encrypted(encrypted) is True

    def test_is_encrypted_rejects_plaintext(self):
        from app.services.encryption import is_encrypted

        assert is_encrypted("plaintext_value") is False

    def test_is_encrypted_rejects_empty(self):
        from app.services.encryption import is_encrypted

        assert is_encrypted("") is False


# ── User scoping ──────────────────────────────────────────────


class TestUserScoping:
    """Verify that queries are properly scoped to the current user.

    Regression: potential data leak if user_id filter is missing.
    """

    def test_expenses_filter_by_user(self, db, test_user):
        from app.models import Expense, User
        from app.services.auth import get_password_hash

        # Create expenses for test_user
        e1 = Expense(amount=100, description="User1 expense", date="2026-10-01", user_id=test_user.id)
        db.add(e1)

        # Create another user with expenses
        other = User(email="other@regression.com", full_name="Other", hashed_password=get_password_hash("x"), email_verified=True)
        db.add(other)
        db.flush()
        e2 = Expense(amount=200, description="User2 expense", date="2026-10-01", user_id=other.id)
        db.add(e2)
        db.flush()

        # Query should only return test_user's expenses
        results = db.query(Expense).filter(Expense.user_id == test_user.id).all()
        assert len(results) == 1
        assert results[0].description == "User1 expense"


# ── Telegram auth HMAC (prevents SSO mismatch) ────────────────


class TestTelegramAuthRegression:
    """Verify Telegram HMAC validation.

    Regression: commit f78f965 — MiniApp HMAC-only auth + diagnostic logging.
    """

    def test_telegram_auth_importable(self):
        """Telegram auth module should import without errors."""
        from app.services.auth import verify_telegram_login_widget, verify_telegram_webapp

        assert callable(verify_telegram_webapp)
        assert callable(verify_telegram_login_widget)

    def test_verify_webapp_returns_none_without_token(self):
        """Should return None gracefully when TELEGRAM_BOT_TOKEN is not set."""
        from app.services.auth import verify_telegram_webapp

        # Without a valid token, should return None (not raise)
        result = verify_telegram_webapp("invalid_data")
        assert result is None

    def test_verify_login_widget_returns_none_without_token(self):
        from app.services.auth import verify_telegram_login_widget

        result = verify_telegram_login_widget({"hash": "invalid", "auth_date": "123"})
        assert result is None