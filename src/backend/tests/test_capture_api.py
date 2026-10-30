import io
import wave
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from app.routers import capture as capture_router
from app.services.auth import get_current_user
from app.services.capture import MAX_AUDIO_BYTES, ExpenseImageResult
from app.services.llm.client import LLMUnsupportedCapabilityError


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(capture_router.router)
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=123)
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def unauthenticated_client():
    app = FastAPI()
    app.include_router(capture_router.router)
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def auth_headers():
    return {"Authorization": "Bearer capture-test-token"}


def _png() -> bytes:
    output = io.BytesIO()
    Image.new("RGB", (4, 4), "white").save(output, format="PNG")
    return output.getvalue()


def _wav(seconds: int = 1) -> bytes:
    output = io.BytesIO()
    with wave.open(output, "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(8000)
        audio.writeframes(b"\x00\x00" * (8000 * seconds))
    return output.getvalue()


def test_capture_requires_auth(unauthenticated_client):
    response = unauthenticated_client.post(
        "/capture/transcribe", files={"file": ("v.ogg", b"x", "audio/ogg")}
    )
    assert response.status_code == 401


def test_rejects_oversized_audio(client, auth_headers):
    big = _wav() + b"x" * (MAX_AUDIO_BYTES + 1)
    response = client.post(
        "/capture/transcribe",
        files={"file": ("v.ogg", big, "audio/ogg")},
        headers=auth_headers,
    )
    assert response.status_code == 413


def test_returns_rejected_receipt_without_writing(client, auth_headers, monkeypatch):
    monkeypatch.setattr(
        capture_router,
        "extract_expense_from_image",
        lambda **_: ExpenseImageResult(
            status="rejected",
            draft=None,
            reason="multiple_transactions",
            message="Detecté más de un movimiento en la imagen. Cargá uno por vez.",
        ),
    )
    response = client.post(
        "/capture/expense-image",
        files={"file": ("p.png", _png(), "image/png")},
        headers=auth_headers,
    )
    assert response.status_code == 200
    assert response.json()["status"] == "rejected"


def test_returns_503_when_provider_lacks_capability(client, auth_headers, monkeypatch):
    def _raise(**_):
        raise LLMUnsupportedCapabilityError("audio", "google")

    monkeypatch.setattr(capture_router, "transcribe_audio", _raise)
    response = client.post(
        "/capture/transcribe",
        files={"file": ("v.wav", _wav(), "audio/wav")},
        headers=auth_headers,
    )
    assert response.status_code == 503


def test_returns_429_when_rate_limited(client, auth_headers, monkeypatch):
    monkeypatch.setattr(capture_router, "check_rate_limit", lambda *_: (False, 30))
    response = client.post(
        "/capture/transcribe",
        files={"file": ("v.wav", _wav(), "audio/wav")},
        headers=auth_headers,
    )
    assert response.status_code == 429
    assert response.headers["Retry-After"] == "30"
