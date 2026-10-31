from app import telegram_bot
from app.prompts import BANK_NOTIFICATION_PARSE_PROMPT, EXPENSE_IMAGE_PROMPT


def test_bank_notification_parser_drops_card_digits(monkeypatch):
    class FakeClient:
        def complete_json(self, *_args, **_kwargs):
            return {
                "amount": 15200.0,
                "description": "Supermercado Coto",
                "date": "2026-10-31",
                "currency": "ARS",
                "card_type": "credito",
                "card_name": "Visa ****4521",
                "bank": "Galicia 1234",
                "installment_number": None,
                "installment_total": None,
            }

    monkeypatch.setattr(telegram_bot, "_llm_client", lambda: FakeClient())

    result = telegram_bot._parse_bank_notification("notificación", log_content=False)

    assert result is not None
    assert result["card_name"] == "Visa"
    assert result["bank"] == "Galicia"
    assert "4521" not in str(result)


def test_capture_prompts_forbid_card_digits():
    assert "últimos 4" in EXPENSE_IMAGE_PROMPT
    assert "números de tarjeta" in EXPENSE_IMAGE_PROMPT
    assert "últimos 4" in BANK_NOTIFICATION_PARSE_PROMPT
    assert "números de tarjeta" in BANK_NOTIFICATION_PARSE_PROMPT
