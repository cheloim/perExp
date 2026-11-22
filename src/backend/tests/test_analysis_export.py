"""Downloadable image of an assistant reply and its explicit Telegram send."""

from datetime import datetime

import pytest
from fastapi.testclient import TestClient

from app.database import get_db
from app.models import User
from app.routers import analysis
from app.services import analysis_export
from app.services.auth import get_current_user, get_password_hash
from main import app


def _user(db, email: str, *, telegram_chat_id: str | None = None) -> User:
    user = User(
        email=email,
        full_name="Test Export",
        hashed_password=get_password_hash("testpassword"),
        email_verified=True,
        telegram_chat_id=telegram_chat_id,
    )
    db.add(user)
    db.flush()
    return user


def _client(db, user: User) -> TestClient:
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


@pytest.fixture
def export_user(db):
    return _user(db, "export@example.com", telegram_chat_id="123456")


def test_image_export_returns_a_png_attachment(db, export_user, monkeypatch):
    monkeypatch.setattr(analysis, "render_analysis_image", lambda *a, **k: b"\x89PNG\r\n")
    client = _client(db, export_user)
    try:
        response = client.post(
            "/analysis/export/image",
            json={"text": "## Resumen\n\nGastaste **$ 10.000**."},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert "attachment" in response.headers["content-disposition"]
    assert response.content == b"\x89PNG\r\n"


def test_image_export_requires_text(db, export_user):
    client = _client(db, export_user)
    try:
        response = client.post("/analysis/export/image", json={"text": ""})
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 422


def test_the_rendered_html_escapes_raw_html_and_keeps_markdown():
    html = analysis_export.render_analysis_html(
        "## Resumen\n\nGastaste **$ 10.000**.\n\n<script>alert(1)</script>",
        "Análisis",
        datetime(2026, 11, 22, 18, 2),
    )

    assert "<h2>Resumen</h2>" in html
    assert "<strong>$ 10.000</strong>" in html
    assert "<script>alert(1)</script>" not in html
    assert "&lt;script&gt;" in html
    assert "22/11/2026 18:02" in html


def test_telegram_export_sends_the_image_to_the_linked_chat(db, export_user, monkeypatch):
    sent = {}
    monkeypatch.setattr(analysis, "render_analysis_image", lambda *a, **k: b"png-bytes")

    def fake_send(chat_id, image_bytes, caption=None):
        sent.update(chat_id=chat_id, image_bytes=image_bytes, caption=caption)
        return True

    monkeypatch.setattr("app.telegram.sending.send_photo_to_chat", fake_send)
    client = _client(db, export_user)
    try:
        response = client.post(
            "/analysis/export/telegram",
            json={"text": "Informe del asistente"},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json() == {"sent": True}
    assert sent["chat_id"] == "123456"
    assert sent["image_bytes"] == b"png-bytes"


def test_telegram_export_requires_a_linked_account(db):
    user = _user(db, "no-telegram@example.com")
    client = _client(db, user)
    try:
        response = client.post(
            "/analysis/export/telegram",
            json={"text": "Informe del asistente"},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 400
    assert "Telegram" in response.json()["detail"]


def test_telegram_export_reports_a_transport_failure(db, export_user, monkeypatch):
    monkeypatch.setattr(analysis, "render_analysis_image", lambda *a, **k: b"png-bytes")
    monkeypatch.setattr("app.telegram.sending.send_photo_to_chat", lambda *a, **k: False)
    client = _client(db, export_user)
    try:
        response = client.post(
            "/analysis/export/telegram",
            json={"text": "Informe del asistente"},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 502
