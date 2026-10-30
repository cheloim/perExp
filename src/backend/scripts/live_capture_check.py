"""Live validation for capture inputs against the configured provider.

This is a coordinator/CI check, not a unit test. It generates synthetic audio
and payment-proof images (no user data), calls the real capture service, prints
a JSON summary, and exits non-zero when the expected behavior is not observed.

Run from ``src/backend`` with the provider credentials in the environment:

    LLM_PROVIDER=openai LLM_MODEL_NAME=gpt-6-luna \\
    LLM_AUDIO_MODEL=whisper-1 LLM_VISION_MODEL=gpt-6-luna \\
    LLM_API_KEY=... python scripts/live_capture_check.py

The script never prints the API key.
"""

from __future__ import annotations

import io
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

# Running ``python scripts/live_capture_check.py`` puts the scripts directory
# on sys.path, not the backend root. Add the backend root so ``app`` imports.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from PIL import Image, ImageDraw, ImageFont  # noqa: E402

from app.services.capture import (  # noqa: E402
    extract_expense_from_image,
    transcribe_audio,
)

AMOUNT = 15_200.0
REJECT_REASONS = {
    "multiple": {"multiple_transactions", "multiple_totals"},
    "credit": {"not_an_expense", "not_a_payment_proof"},
    "not_proof": {"not_a_payment_proof", "no_total"},
    "balance": {"balance_only", "not_a_payment_proof", "no_total"},
    "pending": {"not_completed", "not_a_payment_proof", "no_total"},
}
FONT_CANDIDATES = (
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
)


def _font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for candidate in FONT_CANDIDATES:
        if Path(candidate).exists():
            return ImageFont.truetype(candidate, size)
    return ImageFont.load_default()


def _png(lines: list[str]) -> bytes:
    image = Image.new("RGB", (900, 1100), "white")
    draw = ImageDraw.Draw(image)
    y = 40
    for line in lines:
        size = 54 if line.startswith("TOTAL") else 34
        draw.text((40, y), line, fill="black", font=_font(size))
        y += 64
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _audio() -> bytes:
    text = "Gasté quince mil doscientos pesos en el supermercado Coto"
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as handle:
        path = Path(handle.name)
    try:
        last_stderr = ""
        for voice in ("es-la", "es"):
            result = subprocess.run(
                ["espeak-ng", "-v", voice, "-s", "150", "-w", str(path), text],
                capture_output=True,
                text=True,
                check=False,
            )
            last_stderr = result.stderr
            if result.returncode == 0 and path.stat().st_size > 0:
                return path.read_bytes()
        raise RuntimeError(f"espeak-ng failed: {last_stderr[:300]}")
    finally:
        path.unlink(missing_ok=True)


def _probe_chat_audio(wav: bytes) -> dict:
    """Probe whether the text model accepts audio through chat input_audio."""
    import base64

    from openai import OpenAI

    key = os.getenv("MESSAGES_BOT_LLM_API_KEY") or os.getenv("LLM_API_KEY")
    client = OpenAI(api_key=key)
    response = client.chat.completions.create(
        model=os.getenv("LLM_MODEL_NAME", "gpt-6-luna"),
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": "Transcribí este audio textualmente en español. Devolvé solo el texto.",
                    },
                    {
                        "type": "input_audio",
                        "input_audio": {
                            "data": base64.b64encode(wav).decode(),
                            "format": "wav",
                        },
                    },
                ],
            }
        ],
    )
    return {"text": (response.choices[0].message.content or "").strip()}


def _ok(result, *, amount: float) -> bool:
    return (
        result.status == "ok"
        and result.draft is not None
        and abs(float(result.draft.amount) - amount) <= 0.01
    )


def _rejected(result, *, reasons: set[str]) -> bool:
    return result.status == "rejected" and (result.reason or "") in reasons


def main() -> int:
    if not os.getenv("LLM_API_KEY"):
        print("LLM_API_KEY is not set; refusing to run the live check.", file=sys.stderr)
        return 2

    cases = {
        "paper_receipt": (
            _png(
                [
                    "SUPERMERCADO COTO",
                    "29/10/2026",
                    "Leche 1.200,00",
                    "Pan 800,00",
                    "Arroz 1.500,00",
                    "Subtotal 3.500,00",
                    "IVA 735,00",
                    f"TOTAL ${AMOUNT:,.2f}".replace(",", ".").replace(".00", ",00"),
                ]
            ),
            "ok",
        ),
        "bank_notification": (
            _png(
                [
                    "Compra aprobada",
                    "Visa ****4521",
                    "Supermercado Coto",
                    "$15.200,00",
                    "Saldo disponible: $50.000,00",
                    "29/10/2026",
                ]
            ),
            "ok",
        ),
        "wallet_payment": (
            _png(
                [
                    "Apple Pay",
                    "Pago completado",
                    "Supermercado Coto",
                    "$15.200,00",
                    "29/10/2026",
                ]
            ),
            "ok",
        ),
        "multiple_transactions": (
            _png(
                [
                    "Movimientos",
                    "29/10/2026 Compra $15.200,00",
                    "29/10/2026 Compra $8.500,00",
                    "Saldo $50.000,00",
                ]
            ),
            "multiple",
        ),
        "credit_transfer": (
            _png(
                [
                    "Transferencia recibida",
                    "$20.000,00",
                    "De: Juan Pérez",
                    "29/10/2026",
                ]
            ),
            "credit",
        ),
        "shopping_list": (
            _png(["Lista de compras", "Leche", "Pan", "Huevos", "Arroz"]),
            "not_proof",
        ),
        "balance_only": (
            _png(["Saldo disponible", "$50.000,00", "Cuenta ****1234"]),
            "balance",
        ),
        "pending_payment": (
            _png(["Pago pendiente", "Supermercado Coto", "$15.200,00", "29/10/2026"]),
            "pending",
        ),
    }

    summary: dict[str, object] = {
        "models": {
            "provider": os.getenv("LLM_PROVIDER"),
            "text": os.getenv("LLM_MODEL_NAME"),
            "audio": os.getenv("LLM_AUDIO_MODEL"),
            "vision": os.getenv("LLM_VISION_MODEL"),
        }
    }
    failures: list[str] = []

    wav = _audio()
    try:
        audio = transcribe_audio(
            wav,
            filename="voice.wav",
            mime_type="audio/wav",
            duration_hint=None,
            api_key_env="MESSAGES_BOT_LLM_API_KEY",
        )
        summary["audio"] = {
            "text": audio.text,
            "unclear": audio.unclear,
            "duration_seconds": audio.duration_seconds,
        }
        if audio.unclear or len(audio.text.strip()) < 3:
            failures.append("audio_unclear")
        if not audio.duration_seconds or audio.duration_seconds <= 0:
            failures.append("audio_duration_missing")
    except Exception as exc:  # provider/model unavailable must not hide the image checks
        summary["audio"] = {
            "error": type(exc).__name__,
            "detail": str(exc)[:300],
        }
        failures.append("audio_provider_unavailable")
        try:
            summary["audio_chat_fallback"] = _probe_chat_audio(wav)
        except Exception as fallback_exc:
            summary["audio_chat_fallback"] = {
                "error": type(fallback_exc).__name__,
                "detail": str(fallback_exc)[:300],
            }

    for name, (image, expectation) in cases.items():
        result = extract_expense_from_image(image, mime_type="image/png")
        summary[name] = {
            "status": result.status,
            "reason": result.reason,
            "draft": result.draft.model_dump(mode="json") if result.draft else None,
            "message": result.message,
        }
        if expectation == "ok":
            if not _ok(result, amount=AMOUNT):
                failures.append(f"{name}_expected_ok")
        elif not _rejected(result, reasons=REJECT_REASONS[expectation]):
            failures.append(f"{name}_expected_reject")

    print(json.dumps(summary, ensure_ascii=False, indent=2))
    if failures:
        print("\nFAILED:", ", ".join(failures), file=sys.stderr)
        return 1
    print("\nOK: all live capture checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
