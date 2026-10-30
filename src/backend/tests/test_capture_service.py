import io

import pytest
from PIL import Image

from app.services import capture
from app.services.capture import (
    MAX_AUDIO_BYTES,
    MediaTooLargeError,
    MediaTooLongError,
    UnsupportedMediaError,
    extract_expense_from_image,
    normalize_image,
    transcribe_audio,
)
from app.services.llm.types import LLMResult


def _jpeg() -> bytes:
    image = Image.new("RGB", (10, 10), "white")
    out = io.BytesIO()
    image.save(out, format="JPEG")
    return out.getvalue()


def _jpeg_with_exif(comment: bytes) -> bytes:
    image = Image.new("RGB", (10, 10), "white")
    exif = Image.Exif()
    exif[0x9286] = b"ASCII\x00\x00\x00" + comment
    out = io.BytesIO()
    image.save(out, format="JPEG", exif=exif)
    return out.getvalue()


def test_rejects_fake_audio_by_magic_bytes():
    metric = capture.CAPTURE_REQUESTS.labels("audio", "rejected", "unsupported_media")
    before = metric._value.get()
    with pytest.raises(UnsupportedMediaError):
        transcribe_audio(b"not audio", filename="x.mp3", mime_type="audio/mpeg")
    assert metric._value.get() == before + 1


def test_marks_silence_as_unclear(monkeypatch):
    class _FakeClient:
        def transcribe(self, *a, **k):
            return LLMResult(text="", duration_seconds=3.0)

    monkeypatch.setattr(capture, "get_client", lambda **_: _FakeClient())
    result = transcribe_audio(b"OggS....", filename="v.ogg", mime_type="audio/ogg")
    assert result.unclear is True


def test_rejects_audio_over_limit():
    with pytest.raises(MediaTooLargeError):
        transcribe_audio(
            b"OggS" + b"x" * (MAX_AUDIO_BYTES + 1),
            filename="v.ogg",
            mime_type="audio/ogg",
        )


def test_rejects_audio_duration_hint_over_limit():
    with pytest.raises(MediaTooLongError):
        transcribe_audio(
            b"OggS...",
            filename="v.ogg",
            mime_type="audio/ogg",
            duration_hint=121,
        )


def test_transcription_cleans_text_and_marks_short_text_unclear(monkeypatch):
    class _FakeClient:
        def transcribe(self, *a, **k):
            return LLMResult(text="  eh! ", duration_seconds=2)

    monkeypatch.setattr(capture, "get_client", lambda **_: _FakeClient())
    result = transcribe_audio(b"OggS...", filename="v.ogg", mime_type="audio/ogg")
    assert result.text == "eh!"
    assert result.unclear is True
    assert result.duration_seconds == 2


def test_normalize_image_strips_exif():
    raw = _jpeg_with_exif(b"GPS: -34.6,-58.4")
    out = normalize_image(raw)
    assert b"GPS" not in out
    assert Image.open(io.BytesIO(out)).format == "JPEG"


def test_rejects_heic_with_clear_message():
    with pytest.raises(UnsupportedMediaError, match="HEIC"):
        extract_expense_from_image(b"heic", mime_type="image/heic")


@pytest.mark.parametrize(
    "model_payload, reason",
    [
        ({"is_payment_proof": False, "reason": "not_a_payment_proof"}, "not_a_payment_proof"),
        (
            {
                "is_payment_proof": True,
                "source_type": "bank_notification",
                "completed": True,
                "direction": "credit",
                "single_transaction": True,
                "total": 1000,
                "reason": "not_an_expense",
            },
            "not_an_expense",
        ),
        (
            {
                "is_payment_proof": True,
                "source_type": "transaction_detail",
                "completed": True,
                "direction": "debit",
                "single_transaction": False,
                "total": 1000,
                "reason": "multiple_transactions",
            },
            "multiple_transactions",
        ),
        (
            {
                "is_payment_proof": True,
                "source_type": "paper_receipt",
                "completed": True,
                "direction": "debit",
                "single_transaction": False,
                "total": 1000,
                "reason": "multiple_transactions",
            },
            "multiple_transactions",
        ),
        (
            {
                "is_payment_proof": True,
                "source_type": "transaction_detail",
                "completed": True,
                "direction": "debit",
                "single_transaction": True,
                "total": 50000,
                "reason": "balance_only",
            },
            "balance_only",
        ),
        (
            {
                "is_payment_proof": True,
                "source_type": "wallet_payment",
                "completed": False,
                "direction": "debit",
                "single_transaction": True,
                "total": 1000,
                "reason": "not_completed",
            },
            "not_completed",
        ),
    ],
)
def test_rejects_non_single_or_non_expense(monkeypatch, model_payload, reason):
    monkeypatch.setattr(capture, "_extract_json", lambda **_: model_payload)
    result = extract_expense_from_image(_jpeg(), mime_type="image/jpeg")
    assert result.status == "rejected"
    assert result.reason == reason


def test_accepts_supermarket_receipt_with_items_and_one_total(monkeypatch):
    monkeypatch.setattr(
        capture,
        "_extract_json",
        lambda **_: {
            "is_payment_proof": True,
            "source_type": "paper_receipt",
            "completed": True,
            "direction": "debit",
            "single_transaction": True,
            "total": 15200.5,
            "currency": "ARS",
            "merchant": "Supermercado Coto",
            "date": "2026-10-29",
            "confidence": "high",
            "reason": None,
        },
    )
    result = extract_expense_from_image(_jpeg(), mime_type="image/jpeg")
    assert result.status == "ok"
    assert result.draft.amount == 15200.5
    assert result.draft.description == "Supermercado Coto"
