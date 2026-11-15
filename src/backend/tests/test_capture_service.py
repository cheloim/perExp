import io
import wave

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
    sanitize_card_hint,
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


def _wav(seconds: int) -> bytes:
    output = io.BytesIO()
    with wave.open(output, "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(8000)
        audio.writeframes(b"\x00\x00" * (8000 * seconds))
    return output.getvalue()


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
    result = transcribe_audio(_wav(3), filename="v.wav", mime_type="audio/wav")
    assert result.unclear is True


def test_rejects_audio_over_limit():
    audio_over_limit = _wav(1) + b"x" * (MAX_AUDIO_BYTES + 1)
    with pytest.raises(MediaTooLargeError):
        transcribe_audio(
            audio_over_limit,
            filename="v.wav",
            mime_type="audio/wav",
        )


def test_rejects_121_second_wav_before_getting_client(monkeypatch):
    def _unexpected_client(**_):
        raise AssertionError("provider client must not be created for long audio")

    monkeypatch.setattr(capture, "get_client", _unexpected_client)
    with pytest.raises(MediaTooLongError):
        transcribe_audio(
            _wav(121),
            filename="long.wav",
            mime_type="audio/wav",
        )


def test_uses_parsed_wav_duration_instead_of_shorter_hint(monkeypatch):
    received = {}

    class _FakeClient:
        def transcribe(self, *a, **kwargs):
            received.update(kwargs)
            return LLMResult(text="supermercado", duration_seconds=None)

    monkeypatch.setattr(capture, "get_client", lambda **_: _FakeClient())
    result = transcribe_audio(_wav(3), filename="v.wav", mime_type="audio/wav", duration_hint=1)
    assert received["duration_hint"] == 3.0
    assert result.duration_seconds == 3.0


def test_garbage_audio_with_hint_rejects_before_getting_client(monkeypatch):
    def _unexpected_client(**_):
        raise AssertionError("provider client must not be created for invalid bytes")

    monkeypatch.setattr(capture, "get_client", _unexpected_client)
    with pytest.raises(UnsupportedMediaError):
        transcribe_audio(
            b"garbage bytes",
            filename="v.wav",
            mime_type="audio/wav",
            duration_hint=3,
        )


def test_rejects_webm_with_conversion_guidance_before_getting_client(monkeypatch):
    def _unexpected_client(**_):
        raise AssertionError("provider client must not be created for WebM")

    monkeypatch.setattr(capture, "get_client", _unexpected_client)
    with pytest.raises(UnsupportedMediaError, match="Convertí el audio a WAV, OGG, MP3 o M4A"):
        transcribe_audio(
            b"\x1a\x45\xdf\xa3webm bytes",
            filename="v.webm",
            mime_type="audio/webm",
            duration_hint=3,
        )


def test_transcription_cleans_text_and_marks_short_text_unclear(monkeypatch):
    class _FakeClient:
        def transcribe(self, *a, **k):
            return LLMResult(text="  eh! ", duration_seconds=2)

    monkeypatch.setattr(capture, "get_client", lambda **_: _FakeClient())
    result = transcribe_audio(_wav(3), filename="v.wav", mime_type="audio/wav")
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
    ("model_payload", "reason"),
    [
        (
            {
                "source_type": "transaction_detail",
                "expenses": [],
                "reason": "not_a_payment_proof",
            },
            "not_a_payment_proof",
        ),
        (
            {
                "source_type": "bank_notification",
                "expenses": [],
                "reason": "not_an_expense",
            },
            "not_an_expense",
        ),
        (
            {
                "source_type": "transaction_detail",
                "expenses": [],
                "reason": "balance_only",
            },
            "balance_only",
        ),
        (
            {
                "source_type": "wallet_payment",
                "expenses": [],
                "reason": "not_completed",
            },
            "not_completed",
        ),
    ],
)
def test_rejects_when_the_model_returns_no_expenses(monkeypatch, model_payload, reason):
    monkeypatch.setattr(capture, "_extract_json", lambda **_: model_payload)
    result = extract_expense_from_image(_jpeg(), mime_type="image/jpeg")
    assert result.status == "rejected"
    assert result.reason == reason


def test_accepts_supermarket_receipt_with_items_and_one_total(monkeypatch):
    monkeypatch.setattr(
        capture,
        "_extract_json",
        lambda **_: {
            "source_type": "paper_receipt",
            "expenses": [
                {
                    "amount": 15200.5,
                    "amount_kind": "none",
                    "currency": "ARS",
                    "merchant": "Supermercado Coto",
                    "date": "2026-10-29",
                    "confidence": "high",
                    "direction": "debit",
                }
            ],
            "reason": None,
        },
    )
    result = extract_expense_from_image(_jpeg(), mime_type="image/jpeg")
    assert result.status == "ok"
    assert result.drafts[0].amount == 15200.5
    assert result.drafts[0].description == "Supermercado Coto"


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("Visa ****4521", "Visa"),
        ("Mastercard terminada en 1108", "Mastercard"),
        ("Visa •••• 4521", "Visa"),
        ("Visa Galicia 4521", "Visa Galicia"),
        ("Visa Débito", "Visa Débito"),
        ("4521", None),
        (None, None),
    ],
)
def test_sanitize_card_hint_never_returns_card_digits(raw, expected):
    assert sanitize_card_hint(raw) == expected


def test_image_extraction_strips_card_digits_from_the_hint(monkeypatch):
    monkeypatch.setattr(
        capture,
        "_extract_json",
        lambda **_: {
            "source_type": "bank_notification",
            "expenses": [
                {
                    "amount": 3200,
                    "amount_kind": "none",
                    "currency": "ARS",
                    "merchant": "Café Tortoni",
                    "date": "2026-10-29",
                    "card_hint": "Visa ****4521",
                    "confidence": "high",
                    "direction": "debit",
                }
            ],
            "reason": None,
        },
    )

    result = extract_expense_from_image(_jpeg(), mime_type="image/jpeg")

    assert result.status == "ok"
    assert result.drafts[0].card_hint == "Visa"


def _extraction(expenses, *, reason=None, source_type="transaction_detail"):
    return {"source_type": source_type, "expenses": expenses, "reason": reason}


def _expense(amount=1000, merchant="Kiosco", **overrides):
    item = {
        "amount": amount,
        "amount_kind": "none",
        "currency": "ARS",
        "merchant": merchant,
        "date": "2026-11-01",
        "card_hint": None,
        "installment_number": None,
        "installment_total": None,
        "direction": "debit",
        "confidence": "high",
    }
    item.update(overrides)
    return item


def test_accepts_multiple_transactions_in_one_image(monkeypatch):
    monkeypatch.setattr(
        capture,
        "_extract_json",
        lambda **_: _extraction(
            [
                _expense(amount=1500, merchant="Café"),
                _expense(amount=2500, merchant="Farmacia"),
            ]
        ),
    )
    result = extract_expense_from_image(_jpeg(), mime_type="image/jpeg")
    assert result.status == "ok"
    assert [draft.description for draft in result.drafts] == ["Café", "Farmacia"]
    assert [draft.amount for draft in result.drafts] == [1500, 2500]


def test_keeps_current_installment_metadata(monkeypatch):
    monkeypatch.setattr(
        capture,
        "_extract_json",
        lambda **_: _extraction(
            [
                _expense(
                    amount=15000,
                    merchant="Netflix",
                    amount_kind="installment",
                    installment_number=3,
                    installment_total=12,
                )
            ]
        ),
    )
    result = extract_expense_from_image(_jpeg(), mime_type="image/jpeg")
    draft = result.drafts[0]
    assert draft.amount == 15000
    assert draft.amount_kind == "installment"
    assert draft.installment_number == 3
    assert draft.installment_total == 12


def test_keeps_total_installment_metadata(monkeypatch):
    monkeypatch.setattr(
        capture,
        "_extract_json",
        lambda **_: _extraction(
            [
                _expense(
                    amount=24000,
                    merchant="Fravega",
                    amount_kind="total",
                    installment_number=1,
                    installment_total=6,
                )
            ]
        ),
    )
    result = extract_expense_from_image(_jpeg(), mime_type="image/jpeg")
    draft = result.drafts[0]
    assert draft.amount == 24000
    assert draft.amount_kind == "total"
    assert draft.installment_total == 6


def test_skips_credit_rows_from_a_mixed_statement(monkeypatch):
    monkeypatch.setattr(
        capture,
        "_extract_json",
        lambda **_: _extraction(
            [
                _expense(amount=1500, merchant="Café"),
                _expense(amount=900, merchant="Reintegro", direction="credit"),
            ]
        ),
    )
    result = extract_expense_from_image(_jpeg(), mime_type="image/jpeg")
    assert result.status == "ok"
    assert [draft.description for draft in result.drafts] == ["Café"]


def test_rejects_an_image_with_no_expenses(monkeypatch):
    monkeypatch.setattr(
        capture,
        "_extract_json",
        lambda **_: _extraction([], reason="balance_only"),
    )
    result = extract_expense_from_image(_jpeg(), mime_type="image/jpeg")
    assert result.status == "rejected"
    assert result.reason == "balance_only"


def test_rejects_more_than_twenty_expenses(monkeypatch):
    monkeypatch.setattr(
        capture,
        "_extract_json",
        lambda **_: _extraction([_expense() for _ in range(21)]),
    )
    result = extract_expense_from_image(_jpeg(), mime_type="image/jpeg")
    assert result.status == "rejected"
    assert result.reason == "too_many_expenses"


def test_infers_installment_kind_when_the_model_omits_it(monkeypatch):
    monkeypatch.setattr(
        capture,
        "_extract_json",
        lambda **_: _extraction(
            [
                _expense(
                    amount=15000,
                    merchant="Netflix",
                    amount_kind=None,
                    installment_number=3,
                    installment_total=12,
                )
            ]
        ),
    )
    result = extract_expense_from_image(_jpeg(), mime_type="image/jpeg")
    assert result.drafts[0].amount_kind == "installment"


def test_drops_invalid_amounts_but_keeps_valid_rows(monkeypatch):
    monkeypatch.setattr(
        capture,
        "_extract_json",
        lambda **_: _extraction(
            [
                _expense(amount=0, merchant="Roto"),
                _expense(amount=2500, merchant="Farmacia"),
            ]
        ),
    )
    result = extract_expense_from_image(_jpeg(), mime_type="image/jpeg")
    assert result.status == "ok"
    assert [draft.description for draft in result.drafts] == ["Farmacia"]
