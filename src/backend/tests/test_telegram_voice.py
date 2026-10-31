import asyncio
import logging
from types import SimpleNamespace

import pytest

from app import telegram_bot
from app.services.capture import MAX_AUDIO_BYTES, TranscriptionResult


def make_update(*, media=None):
    replies = []

    async def reply_text(text, **kwargs):
        replies.append(text)

    message = SimpleNamespace(
        voice=media,
        audio=None,
        replies=replies,
        reply_text=reply_text,
    )
    return SimpleNamespace(
        message=message,
        effective_chat=SimpleNamespace(id=1234),
        effective_user=SimpleNamespace(id=5678, username="tester", first_name="Test"),
    )


def make_media(**overrides):
    values = {
        "file_id": "telegram-file-id",
        "duration": 4,
        "file_size": 512,
        "mime_type": "audio/ogg",
        "file_name": None,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def make_context(downloaded=b"OggS audio bytes"):
    async def download_as_bytearray():
        return bytearray(downloaded)

    return SimpleNamespace(
        user_data={},
        bot=SimpleNamespace(
            get_file=lambda file_id: _resolved(
                SimpleNamespace(download_as_bytearray=download_as_bytearray)
            )
        ),
    )


async def _resolved(value):
    return value


@pytest.fixture
def authorized(monkeypatch):
    monkeypatch.setattr(
        telegram_bot,
        "_authenticated_user",
        lambda update: SimpleNamespace(id=42),
        raising=False,
    )
    monkeypatch.setattr(telegram_bot, "check_rate_limit", lambda *args: (True, 0))


def test_voice_transcribes_and_processes_without_an_echo(monkeypatch, authorized):
    update = make_update(media=make_media())
    context = make_context()
    processed = []

    async def process(*args, **kwargs):
        processed.append(kwargs)
        return 0

    monkeypatch.setattr(
        telegram_bot,
        "transcribe_audio",
        lambda **kwargs: TranscriptionResult(
            text="supermercado 15200 <x>", duration_seconds=4.0, unclear=False
        ),
    )
    monkeypatch.setattr(
        telegram_bot,
        "_process_text_expense",
        process,
    )

    asyncio.run(telegram_bot.handle_voice_message(update, context))

    assert update.message.replies == []
    assert processed[0]["text"] == "supermercado 15200 <x>"
    assert processed[0]["source"] == "voice"


def test_unclear_voice_asks_to_repeat_without_processing(monkeypatch, authorized):
    update = make_update(media=make_media())
    processed = []

    async def process(*args, **kwargs):
        processed.append(kwargs)
        return 0

    monkeypatch.setattr(
        telegram_bot,
        "transcribe_audio",
        lambda **kwargs: TranscriptionResult(text="", duration_seconds=2.0, unclear=True),
    )
    monkeypatch.setattr(
        telegram_bot,
        "_process_text_expense",
        process,
    )

    asyncio.run(telegram_bot.handle_voice_message(update, make_context()))

    assert "No pude entender" in update.message.replies[-1]
    assert not processed


def test_unauthorized_voice_is_not_downloaded(monkeypatch):
    update = make_update(media=make_media())
    context = make_context()
    monkeypatch.setattr(telegram_bot, "_authenticated_user", lambda update: None, raising=False)

    asyncio.run(telegram_bot.handle_voice_message(update, context))

    assert update.message.replies == ["Primero autenticate con /start."]
    assert context.user_data == {}


def test_voice_size_limit_is_checked_before_transcription(monkeypatch, authorized):
    update = make_update(media=make_media(file_size=MAX_AUDIO_BYTES + 1))

    def transcribe(**kwargs):
        raise AssertionError("oversized media must not reach transcription")

    monkeypatch.setattr(telegram_bot, "transcribe_audio", transcribe)

    asyncio.run(telegram_bot.handle_voice_message(update, make_context()))

    assert "10 MB" in update.message.replies[-1]


def test_missing_telegram_size_uses_downloaded_byte_length(monkeypatch, authorized):
    update = make_update(media=make_media(file_size=None))

    def transcribe(**kwargs):
        raise AssertionError("oversized media must not reach transcription")

    monkeypatch.setattr(telegram_bot, "transcribe_audio", transcribe)

    asyncio.run(
        telegram_bot.handle_voice_message(
            update,
            make_context(downloaded=b"x" * (MAX_AUDIO_BYTES + 1)),
        )
    )

    assert "10 MB" in update.message.replies[-1]


def test_voice_rate_limit_rejects_capture(monkeypatch):
    update = make_update(media=make_media())
    monkeypatch.setattr(
        telegram_bot,
        "_authenticated_user",
        lambda update: SimpleNamespace(id=42),
        raising=False,
    )
    monkeypatch.setattr(telegram_bot, "check_rate_limit", lambda *args: (False, 1))

    asyncio.run(telegram_bot.handle_voice_message(update, make_context()))

    assert update.message.replies == ["Demasiadas capturas, probá en un rato"]


def test_private_expense_parse_does_not_log_transcript(monkeypatch, caplog):
    transcript = "merchant transcript should remain private"

    class FailedClient:
        def complete(self, *args, **kwargs):
            raise RuntimeError(transcript)

    monkeypatch.setattr(telegram_bot, "_llm_client", lambda: FailedClient())

    assert telegram_bot._parse_expense(transcript, log_content=False) == []
    assert transcript not in caplog.text


def test_voice_processing_logs_no_identifying_metadata(monkeypatch, caplog):
    update = make_update(media=make_media())
    context = make_context()
    monkeypatch.setattr(
        telegram_bot,
        "_authenticated_user",
        lambda update: SimpleNamespace(id=42),
    )
    caplog.set_level(logging.INFO, logger="app.telegram_bot")

    asyncio.run(telegram_bot._process_text_expense(update, context, text="ayuda", source="voice"))

    assert "[VOICE] len=5" in caplog.text
    assert "1234" not in caplog.text
    assert "tester" not in caplog.text
    assert "ayuda" not in caplog.text


def test_private_bank_parse_failure_does_not_log_chat_id_or_text(monkeypatch, caplog):
    update = make_update(media=make_media())

    async def fake_to_thread(*args, **kwargs):
        return None

    monkeypatch.setattr(telegram_bot.asyncio, "to_thread", fake_to_thread)
    caplog.set_level(logging.WARNING, logger="app.telegram_bot")

    asyncio.run(
        telegram_bot._handle_bank_notification(
            update,
            SimpleNamespace(user_data={}),
            "private bank transcript",
            log_content=False,
        )
    )

    assert "Could not parse private message" in caplog.text
    assert "1234" not in caplog.text
    assert "private bank transcript" not in caplog.text


def test_handle_message_keeps_text_wrapper_arguments(monkeypatch):
    update = make_update(media=make_media())
    update.message.text = " gasto 500 en supermercado "
    context = SimpleNamespace(user_data={})
    calls = []

    async def fake_process(*args, **kwargs):
        calls.append((args, kwargs))
        return 17

    monkeypatch.setattr(telegram_bot, "_process_text_expense", fake_process)

    result = asyncio.run(telegram_bot.handle_message(update, context))

    assert result == 17
    assert calls == [
        ((update, context, update.message.text), {"source": "text"}),
    ]
