import asyncio
from datetime import date
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from app import telegram_bot
from app.services.capture import ExpenseDraft, ExpenseImageResult


class FakeTelegramFile:
    def __init__(self, data=b"image-bytes"):
        self.data = data

    async def download_as_bytearray(self):
        return bytearray(self.data)


class FakeMedia:
    def __init__(self, mime_type="image/jpeg", file_size=11, data=b"image-bytes"):
        self.mime_type = mime_type
        self.file_size = file_size
        self._file = FakeTelegramFile(data)

    async def get_file(self):
        return self._file


class FakeMessage:
    def __init__(self, *, photo=None, document=None, caption=None):
        self.photo = photo or []
        self.document = document
        self.caption = caption
        self.replies = []
        self.reply_markups = []

    async def reply_text(self, text, **kwargs):
        self.replies.append(text)
        self.reply_markups.append(kwargs.get("reply_markup"))


@pytest.fixture
def fake_photo_update(monkeypatch):
    media = FakeMedia()
    message = FakeMessage(photo=[media], caption="Compra del super")
    update = SimpleNamespace(
        message=message,
        effective_chat=SimpleNamespace(id=987),
        effective_user=SimpleNamespace(full_name="Test User"),
    )
    monkeypatch.setattr(telegram_bot, "_get_user_by_chat_id", lambda _: SimpleNamespace(id=42))
    monkeypatch.setattr(telegram_bot, "check_rate_limit", lambda *_: (True, 0), raising=False)
    return update


@pytest.fixture
def fake_context():
    return SimpleNamespace(user_data={})


def test_valid_image_shows_confirmation_and_saves_draft(
    monkeypatch, fake_photo_update, fake_context, caplog
):
    caplog.set_level("INFO")
    extract = Mock(
        return_value=ExpenseImageResult(
            status="ok",
            draft=ExpenseDraft(
                amount=15200,
                currency="ARS",
                description="Supermercado Coto",
                date=date(2026, 10, 29),
                confidence="high",
                source_type="bank_notification",
                card_hint="Visa ****4521",
            ),
            reason=None,
            message="Detecté un total.",
        )
    )
    monkeypatch.setattr(telegram_bot, "extract_expense_from_image", extract)

    asyncio.run(telegram_bot.handle_expense_image(fake_photo_update, fake_context))

    assert "Comprobante detectado (notificación bancaria)" in fake_photo_update.message.replies[-1]
    buttons = fake_photo_update.message.reply_markups[-1].inline_keyboard
    callback_parts = [button.callback_data.split(":") for row in buttons for button in row]
    draft_id = fake_context.user_data["pending_expense_image"]["draft_id"]
    assert all(len(parts) == 3 for parts in callback_parts)
    assert [parts[0] for parts in callback_parts] == ["expenseimg"] * 3
    assert [parts[1] for parts in callback_parts] == [draft_id] * 3
    assert [parts[2] for parts in callback_parts] == ["save", "edit", "cancel"]
    extract.assert_called_once_with(
        b"image-bytes",
        mime_type="image/jpeg",
        hint="Compra del super",
        api_key_env="MESSAGES_BOT_LLM_API_KEY",
    )
    assert fake_context.user_data["pending_expense_image"]["amount"] == 15200
    assert "15200" not in caplog.text
    assert "Supermercado Coto" not in caplog.text


def test_rejected_image_is_not_stored(monkeypatch, fake_photo_update, fake_context):
    monkeypatch.setattr(
        telegram_bot,
        "extract_expense_from_image",
        lambda *_args, **_kwargs: ExpenseImageResult(
            status="rejected",
            draft=None,
            reason="not_an_expense",
            message="Parece un ingreso, no un gasto.",
        ),
    )

    asyncio.run(telegram_bot.handle_expense_image(fake_photo_update, fake_context))

    assert "ingreso" in fake_photo_update.message.replies[-1]
    assert "pending_expense_image" not in fake_context.user_data


@pytest.mark.parametrize(
    ("mime_type", "expected"),
    [("image/heic", "HEIC no está disponible"), ("image/jpeg", "supera el límite de 8 MB")],
)
def test_unsupported_or_oversized_document_is_rejected_before_extraction(
    monkeypatch, mime_type, expected
):
    media = FakeMedia(mime_type=mime_type, file_size=20)
    update = SimpleNamespace(
        message=FakeMessage(document=media),
        effective_chat=SimpleNamespace(id=987),
        effective_user=SimpleNamespace(full_name="Test User"),
    )
    context = SimpleNamespace(user_data={})
    monkeypatch.setattr(telegram_bot, "_get_user_by_chat_id", lambda _: SimpleNamespace(id=42))
    monkeypatch.setattr(telegram_bot, "check_rate_limit", lambda *_: (True, 0))
    monkeypatch.setattr(telegram_bot, "extract_expense_from_image", Mock())
    monkeypatch.setattr(telegram_bot, "MAX_IMAGE_BYTES", 10)

    asyncio.run(telegram_bot.handle_expense_image(update, context))

    assert expected in update.message.replies[-1]
    telegram_bot.extract_expense_from_image.assert_not_called()


def test_rate_limited_image_is_not_downloaded(monkeypatch, fake_photo_update, fake_context):
    media = fake_photo_update.message.photo[-1]
    monkeypatch.setattr(telegram_bot, "check_rate_limit", lambda *_: (False, 30))
    monkeypatch.setattr(telegram_bot, "extract_expense_from_image", Mock())
    download = Mock(wraps=media.get_file)
    monkeypatch.setattr(media, "get_file", download)

    asyncio.run(telegram_bot.handle_expense_image(fake_photo_update, fake_context))

    assert "límite de capturas" in fake_photo_update.message.replies[-1]
    download.assert_not_called()
    telegram_bot.extract_expense_from_image.assert_not_called()


def test_missing_file_size_rejects_downloaded_payload_over_8_mb(
    monkeypatch, fake_photo_update, fake_context
):
    media = fake_photo_update.message.photo[-1]
    media.file_size = None
    media._file.data = b"x" * (telegram_bot.MAX_IMAGE_BYTES + 1)
    extractor = Mock()
    monkeypatch.setattr(telegram_bot, "extract_expense_from_image", extractor)

    asyncio.run(telegram_bot.handle_expense_image(fake_photo_update, fake_context))

    assert "supera el límite de 8 MB" in fake_photo_update.message.replies[-1]
    extractor.assert_not_called()


def test_missing_file_size_processes_small_downloaded_payload(
    monkeypatch, fake_photo_update, fake_context
):
    media = fake_photo_update.message.photo[-1]
    media.file_size = None
    media._file.data = b"small-image"
    extractor = Mock(
        return_value=ExpenseImageResult(
            status="ok",
            draft=ExpenseDraft(
                amount=800,
                currency="ARS",
                description="Kiosco",
                date=date(2026, 10, 29),
                confidence="high",
                source_type="paper_receipt",
            ),
            reason=None,
            message="Detecté un total.",
        )
    )
    monkeypatch.setattr(telegram_bot, "extract_expense_from_image", extractor)

    asyncio.run(telegram_bot.handle_expense_image(fake_photo_update, fake_context))

    assert fake_context.user_data["pending_expense_image"]["description"] == "Kiosco"
    extractor.assert_called_once()


class FakeCallbackQuery:
    def __init__(self, data):
        self.data = data
        self.edited_text = None
        self.reply_markup = None

    async def answer(self):
        pass

    async def edit_message_text(self, text, **kwargs):
        self.edited_text = text
        self.reply_markup = kwargs.get("reply_markup")


def test_save_callback_categorizes_and_saves_without_payment_method(monkeypatch):
    query = FakeCallbackQuery("expenseimg:draft-42:save")
    update = SimpleNamespace(
        callback_query=query,
        effective_chat=SimpleNamespace(id=987),
        effective_user=SimpleNamespace(full_name="Test"),
    )
    context = SimpleNamespace(
        user_data={
            "user_id": 42,
            "pending_expense_image": {
                "draft_id": "draft-42",
                "amount": 15200,
                "currency": "ARS",
                "description": "Supermercado Coto",
                "date": "2026-10-29",
                "source_type": "bank_notification",
            },
        }
    )
    monkeypatch.setattr(telegram_bot, "_get_user_by_chat_id", lambda _: SimpleNamespace(id=42))
    db = SimpleNamespace(close=lambda: None)
    expense = SimpleNamespace(
        id=105,
        amount=15200,
        currency="ARS",
        description="Supermercado Coto",
        category_id=7,
    )
    monkeypatch.setattr(telegram_bot, "SessionLocal", lambda: db)
    monkeypatch.setattr(
        telegram_bot,
        "_instant_categorize",
        lambda parsed, user_id, _db: (7, [SimpleNamespace(id=7, name="Alimentos")]),
    )
    saved_values = {}

    def fake_save(parsed, **kwargs):
        saved_values.update(parsed=parsed, kwargs=kwargs)
        return expense

    monkeypatch.setattr(telegram_bot, "_save_expense", fake_save)
    monkeypatch.setattr(telegram_bot, "_quick_saved_text", lambda *_: "✅ Guardado")

    asyncio.run(telegram_bot.handle_expense_image_callback(update, context))

    assert saved_values["parsed"] == {
        "amount": 15200,
        "description": "Supermercado Coto",
        "date": "2026-10-29",
        "currency": "ARS",
    }
    assert saved_values["kwargs"]["predicted_category_id"] == 7
    assert saved_values["kwargs"]["card_id"] is None
    assert saved_values["kwargs"]["account_id"] is None
    assert query.edited_text == "✅ Guardado"
    assert "pending_expense_image" not in context.user_data


def test_save_failure_clears_pending_and_logs_only_exception_type(monkeypatch, caplog):
    query = FakeCallbackQuery("expenseimg:draft-42:save")
    update = SimpleNamespace(
        callback_query=query,
        effective_chat=SimpleNamespace(id=987),
        effective_user=SimpleNamespace(full_name="Test"),
    )
    context = SimpleNamespace(
        user_data={
            "user_id": 42,
            "pending_expense_image": {
                "draft_id": "draft-42",
                "amount": 15200,
                "currency": "ARS",
                "description": "Sensitive Merchant",
                "date": "2026-10-29",
            },
        }
    )
    monkeypatch.setattr(telegram_bot, "_get_user_by_chat_id", lambda _: SimpleNamespace(id=42))
    monkeypatch.setattr(telegram_bot, "SessionLocal", lambda: SimpleNamespace(close=lambda: None))
    monkeypatch.setattr(
        telegram_bot,
        "_instant_categorize",
        lambda *_: (None, []),
    )

    def fail_save(*_args, **_kwargs):
        raise RuntimeError("amount=15200 merchant=Sensitive Merchant description=Sensitive")

    monkeypatch.setattr(telegram_bot, "_save_expense", fail_save)
    caplog.set_level("ERROR")

    asyncio.run(telegram_bot.handle_expense_image_callback(update, context))

    assert "Revisá tus gastos" in query.edited_text
    assert "pending_expense_image" not in context.user_data
    assert "RuntimeError" in caplog.text
    assert "15200" not in caplog.text
    assert "Sensitive Merchant" not in caplog.text


@pytest.mark.parametrize(
    ("callback_data", "expected"),
    [("edit", "Mandame el gasto corregido"), ("cancel", "Cancelado.")],
)
def test_edit_and_cancel_clear_the_pending_draft(monkeypatch, callback_data, expected):
    query = FakeCallbackQuery(f"expenseimg:draft-42:{callback_data}")
    update = SimpleNamespace(
        callback_query=query,
        effective_chat=SimpleNamespace(id=987),
    )
    context = SimpleNamespace(
        user_data={
            "user_id": 42,
            "pending_expense_image": {"draft_id": "draft-42", "amount": 100},
        }
    )
    monkeypatch.setattr(telegram_bot, "_get_user_by_chat_id", lambda _: SimpleNamespace(id=42))

    asyncio.run(telegram_bot.handle_expense_image_callback(update, context))

    assert expected in query.edited_text
    assert "pending_expense_image" not in context.user_data


def test_old_confirmation_cannot_save_the_newer_image_draft(
    monkeypatch, fake_photo_update, fake_context
):
    results = [
        ExpenseImageResult(
            status="ok",
            draft=ExpenseDraft(
                amount=100,
                currency="ARS",
                description="Comercio A",
                date=date(2026, 10, 29),
                confidence="high",
                source_type="paper_receipt",
            ),
            reason=None,
            message="Detecté un total.",
        ),
        ExpenseImageResult(
            status="ok",
            draft=ExpenseDraft(
                amount=200,
                currency="ARS",
                description="Comercio B",
                date=date(2026, 10, 30),
                confidence="high",
                source_type="paper_receipt",
            ),
            reason=None,
            message="Detecté un total.",
        ),
    ]
    extract = Mock(side_effect=results)
    monkeypatch.setattr(telegram_bot, "extract_expense_from_image", extract)

    asyncio.run(telegram_bot.handle_expense_image(fake_photo_update, fake_context))
    old_callback_data = (
        fake_photo_update.message.reply_markups[0].inline_keyboard[0][0].callback_data
    )
    first_draft_id = fake_context.user_data["pending_expense_image"]["draft_id"]

    fake_photo_update.message.photo = [FakeMedia(data=b"second-image")]
    asyncio.run(telegram_bot.handle_expense_image(fake_photo_update, fake_context))
    assert [call.args[0] for call in extract.call_args_list] == [
        b"image-bytes",
        b"second-image",
    ]
    assert fake_context.user_data["pending_expense_image"]["description"] == "Comercio B"
    assert fake_context.user_data["pending_expense_image"]["draft_id"] != first_draft_id

    query = FakeCallbackQuery(old_callback_data)
    update = SimpleNamespace(
        callback_query=query,
        effective_chat=SimpleNamespace(id=987),
        effective_user=SimpleNamespace(full_name="Test"),
    )
    save_expense = Mock()
    monkeypatch.setattr(telegram_bot, "_get_user_by_chat_id", lambda _: SimpleNamespace(id=42))
    monkeypatch.setattr(telegram_bot, "_save_expense", save_expense)

    asyncio.run(telegram_bot.handle_expense_image_callback(update, fake_context))

    save_expense.assert_not_called()
    assert query.edited_text == "Este comprobante ya no está vigente. Mandá la imagen de nuevo."
    assert fake_context.user_data["pending_expense_image"]["description"] == "Comercio B"
