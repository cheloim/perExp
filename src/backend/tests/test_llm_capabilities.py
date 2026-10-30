import pytest

from app.services.llm import LLMMedia, LLMMessage, resolve_model
from app.services.llm.client import (
    LLMUnsupportedCapabilityError,
    get_client,
)
from app.services.llm.google_adapter import GoogleClient
from app.services.llm.openai_adapter import OpenAIClient
from app.services.llm.pricing import estimate_audio_cost_usd
from app.services.llm.types import LLMResult


def test_message_keeps_media_without_text():
    media = LLMMedia(kind="image", mime_type="image/jpeg", data=b"abc")
    msg = LLMMessage(role="user", media=(media,))
    assert msg.text == ""
    assert msg.media[0].mime_type == "image/jpeg"


def test_audio_capability_defaults_to_whisper(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    assert resolve_model("openai", capability="audio") == "gpt-4o-mini-transcribe"


def test_get_client_rejects_unsupported_provider_capability(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "google")
    with pytest.raises(LLMUnsupportedCapabilityError) as exc:
        get_client(api_key="google-key", capability="vision")
    assert exc.value.capability == "vision"
    assert exc.value.provider == "google"


def test_openai_payload_sends_image_as_data_url():
    client = OpenAIClient(api_key="sk-test", model="gpt-6-luna", timeout=5)
    media = LLMMedia(kind="image", mime_type="image/png", data=b"png-bytes")
    payload = client._payload([LLMMessage(role="user", text="TOTAL", media=(media,))], None, False)
    content = payload["messages"][0]["content"]
    assert isinstance(content, list)
    assert content[0]["type"] == "text"
    assert content[1]["image_url"]["url"].startswith("data:image/png;base64,")


def test_transcribe_records_audio_cost(monkeypatch):
    client = OpenAIClient(api_key="sk-test", model="whisper-1", timeout=5)
    client._transcribe = lambda *a, **k: LLMResult(text="hola", duration_seconds=60)
    monkeypatch.setattr(client, "_check_budget", lambda *a, **k: None)
    recorded = {}
    monkeypatch.setattr(client, "_record", lambda *a, **k: recorded.update(k))
    result = client.transcribe(
        b"audio", filename="v.ogg", mime_type="audio/ogg", feature="voice_transcription"
    )
    assert result.text == "hola"
    assert recorded["cost_usd"] == pytest.approx(0.006)


def test_transcribe_estimates_positive_cost_without_duration(monkeypatch):
    client = OpenAIClient(api_key="sk-test", model="whisper-1", timeout=5)
    client._transcribe = lambda *a, **k: LLMResult(text="hola")
    monkeypatch.setattr(client, "_check_budget", lambda *a, **k: None)
    recorded = {}
    monkeypatch.setattr(client, "_record", lambda *a, **k: recorded.update(k))

    client.transcribe(
        b"non-empty audio",
        filename="v.wav",
        mime_type="audio/wav",
        feature="voice_transcription",
    )

    assert recorded["cost_usd"] > 0


def test_google_audio_is_explicitly_unsupported():
    with pytest.raises(LLMUnsupportedCapabilityError) as exc:
        GoogleClient(api_key="g", model="gemini", timeout=5).transcribe(
            b"v", filename="v.ogg", mime_type="audio/ogg", feature="voice_transcription"
        )
    assert exc.value.capability == "audio"


def test_audio_cost_is_per_minute():
    assert estimate_audio_cost_usd("whisper-1", 60) == pytest.approx(0.006)
    assert estimate_audio_cost_usd("gpt-4o-mini-transcribe", 60) == pytest.approx(0.003)
