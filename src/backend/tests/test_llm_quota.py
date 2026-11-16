"""Per-user LLM limits and the Google timeout (#525)."""

import pytest
from fastapi.testclient import TestClient

from app.database import get_db
from app.routers import analysis as analysis_router
from app.routers import categories as categories_router
from app.routers import import_jobs as import_router
from app.services.auth import get_current_user
from app.services.llm import google_adapter
from app.services.rate_limit import RATE_LIMITS
from main import app


@pytest.fixture(autouse=True)
def _clear_overrides():
    yield
    app.dependency_overrides.clear()


def test_llm_limits_are_declared():
    assert {"analysis", "import", "suggest"} <= set(RATE_LIMITS)
    for name in ("analysis", "import", "suggest"):
        assert RATE_LIMITS[name]["max_attempts"] > 0
        assert RATE_LIMITS[name]["window_seconds"] > 0


def test_google_client_uses_the_configured_timeout(monkeypatch):
    captured = {}

    class FakeClient:
        def __init__(self, **kwargs):
            captured.update(kwargs)

    monkeypatch.setattr(google_adapter.genai, "Client", FakeClient)
    google_adapter.GoogleClient("key", "gemini", 12.5)

    assert captured["api_key"] == "key"
    assert captured["http_options"].timeout == 12500


def _client(db, user) -> TestClient:
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def test_analysis_returns_429_when_the_user_quota_is_spent(db, test_user, monkeypatch):
    monkeypatch.setattr(analysis_router, "check_rate_limit", lambda *_: (False, 42))

    response = _client(db, test_user).post("/analysis/stream", json={"question": "¿cuánto gasté?"})

    assert response.status_code == 429
    assert response.headers["retry-after"] == "42"


def test_suggest_returns_429_when_the_user_quota_is_spent(db, test_user, monkeypatch):
    monkeypatch.setattr(categories_router, "check_rate_limit", lambda *_: (False, 42))

    response = _client(db, test_user).post(
        "/categories/suggest", json={"description": "supermercado"}
    )

    assert response.status_code == 429


def test_import_returns_429_when_the_user_quota_is_spent(db, test_user, monkeypatch):
    monkeypatch.setattr(import_router, "check_rate_limit", lambda *_: (False, 42))

    response = _client(db, test_user).post(
        "/import-jobs",
        files={"file": ("resumen.txt", b"texto", "text/plain")},
    )

    assert response.status_code == 429
