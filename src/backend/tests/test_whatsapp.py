"""WhatsApp webhook and bot behaviour (#561).

Covers Meta verification/signatures and the data-deletion callback, plus the
bot's nominal and error paths with the Cloud API and the database faked.
"""

import asyncio
import base64
import hashlib
import hmac
import json
from datetime import date
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app import whatsapp_bot as bot
from app.models import Account, Card, User
from app.routers import whatsapp_webhook
from app.services.encryption import compute_hmac
from main import app


class _SessionProxy:
    def __init__(self, session):
        self._session = session

    def __getattr__(self, name):
        return getattr(self._session, name)

    def close(self) -> None:
        pass


@pytest.fixture(autouse=True)
def _clear_sessions():
    bot._sessions.clear()
    yield
    bot._sessions.clear()


@pytest.fixture
def sends(monkeypatch):
    calls = {"text": [], "buttons": [], "list": []}

    async def send_text(phone, text):
        calls["text"].append((phone, text))
        return {"ok": True}

    async def send_buttons(phone, body, buttons):
        calls["buttons"].append((phone, body, buttons))
        return {"ok": True}

    async def send_list(phone, body, button_text, sections):
        calls["list"].append((phone, body, button_text, sections))
        return {"ok": True}

    monkeypatch.setattr(bot, "send_text", send_text)
    monkeypatch.setattr(bot, "send_reply_buttons", send_buttons)
    monkeypatch.setattr(bot, "send_list_message", send_list)
    return calls


def _user(db, phone: str = "5491100000000", **overrides) -> User:
    user = User(
        email=f"wa-{phone}@example.com",
        full_name="WhatsApp User",
        email_verified=True,
        whatsapp_phone=phone,
        whatsapp_phone_hash=compute_hmac(phone),
        **overrides,
    )
    db.add(user)
    db.flush()
    return user


def _parsed(**overrides):
    data = {
        "description": "Farmacity",
        "amount": 3200.0,
        "currency": "ARS",
        "date": "20-11-2026",
    }
    data.update(overrides)
    return data


# ── Webhook: verification and signatures ─────────────────────


def test_verify_webhook_echoes_the_challenge_only_with_the_right_token():
    client = TestClient(app)

    ok = client.get(
        "/webhook/whatsapp",
        params={
            "hub.mode": "subscribe",
            "hub.verify_token": whatsapp_webhook.VERIFY_TOKEN,
            "hub.challenge": "abc",
        },
    )
    wrong = client.get(
        "/webhook/whatsapp",
        params={"hub.mode": "subscribe", "hub.verify_token": "nope", "hub.challenge": "abc"},
    )
    wrong_mode = client.get(
        "/webhook/whatsapp",
        params={
            "hub.mode": "unsubscribe",
            "hub.verify_token": whatsapp_webhook.VERIFY_TOKEN,
            "hub.challenge": "abc",
        },
    )

    assert ok.status_code == 200
    assert ok.text == "abc"
    assert wrong.status_code == 403
    assert wrong_mode.status_code == 403


def test_receive_webhook_rejects_a_bad_signature_in_production(monkeypatch):
    monkeypatch.setattr(whatsapp_webhook, "APP_SECRET", "meta-secret")
    monkeypatch.setattr(whatsapp_webhook, "APP_ENV", "production")

    response = TestClient(app).post(
        "/webhook/whatsapp",
        content=b"{}",
        headers={"X-Hub-Signature-256": "sha256=bad"},
    )

    assert response.status_code == 403


def test_receive_webhook_accepts_a_valid_signature_and_schedules_processing(monkeypatch):
    processed = []
    monkeypatch.setattr(whatsapp_webhook, "APP_SECRET", "meta-secret")
    monkeypatch.setattr(whatsapp_webhook, "APP_ENV", "production")

    async def fake_process(body):
        processed.append(body)

    monkeypatch.setattr(whatsapp_webhook, "_process_webhook", fake_process)
    body = json.dumps({"object": "whatsapp_business_account", "entry": []}).encode()
    signature = "sha256=" + hmac.new(b"meta-secret", body, hashlib.sha256).hexdigest()

    response = TestClient(app).post(
        "/webhook/whatsapp", content=body, headers={"X-Hub-Signature-256": signature}
    )

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_receive_webhook_tolerates_invalid_json_and_dev_mode(monkeypatch):
    monkeypatch.setattr(whatsapp_webhook, "APP_SECRET", "")
    monkeypatch.setattr(whatsapp_webhook, "APP_ENV", "development")

    response = TestClient(app).post("/webhook/whatsapp", content=b"not-json")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_process_webhook_routes_messages_and_skips_statuses(monkeypatch):
    handled = []
    monkeypatch.setattr(whatsapp_webhook, "_claim_message_id", lambda _id: True)

    async def fake_handle(**kwargs):
        handled.append(kwargs)

    monkeypatch.setattr("app.whatsapp_bot.handle_whatsapp_message", fake_handle)
    body = {
        "object": "whatsapp_business_account",
        "entry": [
            {
                "changes": [
                    {"value": {"statuses": [{"id": "status"}]}},
                    {
                        "value": {
                            "contacts": [{"wa_id": "123", "profile": {"name": "Ana"}}],
                            "messages": [{"from": "123", "id": "m1", "type": "text"}],
                        }
                    },
                ]
            }
        ],
    }

    asyncio.run(whatsapp_webhook._process_webhook(body))

    assert len(handled) == 1
    assert handled[0]["phone"] == "123"
    assert handled[0]["msg_type"] == "text"


def test_process_webhook_ignores_other_objects_duplicates_and_errors(monkeypatch):
    handled = []
    monkeypatch.setattr(whatsapp_webhook, "_claim_message_id", lambda _id: False)

    async def fake_handle(**kwargs):
        handled.append(kwargs)

    monkeypatch.setattr("app.whatsapp_bot.handle_whatsapp_message", fake_handle)

    asyncio.run(whatsapp_webhook._process_webhook({"object": "page"}))
    asyncio.run(
        whatsapp_webhook._process_webhook(
            {
                "object": "whatsapp_business_account",
                "entry": [
                    {
                        "changes": [
                            {"value": {"messages": [{"from": "1", "id": "dup", "type": "text"}]}}
                        ]
                    }
                ],
            }
        )
    )

    assert handled == []

    async def broken_handle(**_kwargs):
        raise RuntimeError("bot down")

    monkeypatch.setattr(whatsapp_webhook, "_claim_message_id", lambda _id: True)
    monkeypatch.setattr("app.whatsapp_bot.handle_whatsapp_message", broken_handle)
    asyncio.run(
        whatsapp_webhook._process_webhook(
            {
                "object": "whatsapp_business_account",
                "entry": [
                    {
                        "changes": [
                            {"value": {"messages": [{"from": "1", "id": "m2", "type": "text"}]}}
                        ]
                    }
                ],
            }
        )
    )


def test_claim_message_id_is_idempotent_and_fails_open(monkeypatch):
    assert whatsapp_webhook._claim_message_id("") is True

    class BrokenRedis:
        def set(self, *_args, **_kwargs):
            raise ConnectionError("redis down")

    monkeypatch.setattr("app.services.rate_limit._get_redis", lambda: BrokenRedis())

    assert whatsapp_webhook._claim_message_id("m1") is True


# ── Webhook: data deletion callback ─────────────────────────


def _signed_request(payload: dict, secret: str | None = None) -> str:
    raw = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
    if secret is None:
        return f"unsigned.{raw}"
    signature = (
        base64.urlsafe_b64encode(hmac.new(secret.encode(), raw.encode(), hashlib.sha256).digest())
        .decode()
        .rstrip("=")
    )
    return f"{signature}.{raw}"


def test_delete_user_callback_rejects_missing_or_invalid_requests(monkeypatch):
    monkeypatch.setattr(whatsapp_webhook, "APP_SECRET", "")
    monkeypatch.setattr(whatsapp_webhook, "APP_ENV", "development")
    client = TestClient(app)

    missing = client.post("/webhook/whatsapp/delete-user", data={})
    invalid = client.post("/webhook/whatsapp/delete-user", data={"signed_request": "bad"})
    no_user_id = client.post(
        "/webhook/whatsapp/delete-user", data={"signed_request": _signed_request({"foo": "bar"})}
    )

    assert missing.status_code == 400
    assert invalid.status_code == 403
    assert no_user_id.status_code == 400


def test_delete_user_callback_returns_success_even_when_no_user_is_linked(db, monkeypatch):
    app.dependency_overrides.clear()
    monkeypatch.setattr(whatsapp_webhook, "APP_SECRET", "")
    monkeypatch.setattr(whatsapp_webhook, "APP_ENV", "development")
    monkeypatch.setattr("app.database.SessionLocal", lambda: _SessionProxy(db))

    response = TestClient(app).post(
        "/webhook/whatsapp/delete-user",
        data={"signed_request": _signed_request({"user_id": "unknown-phone"})},
    )

    assert response.status_code == 200
    assert response.json()["url"].startswith("https://")
    assert response.json()["confirmation_code"]


def test_delete_user_callback_deletes_the_matching_user(db, monkeypatch):
    user = _user(db, "5491111111111")
    db.commit()
    deleted = []
    monkeypatch.setattr(whatsapp_webhook, "APP_SECRET", "meta-secret")
    monkeypatch.setattr("app.database.SessionLocal", lambda: _SessionProxy(db))
    monkeypatch.setattr(
        "app.services.account_deletion.delete_user_and_all_data",
        lambda _db, target: deleted.append(target.id),
    )
    signed = _signed_request({"user_id": user.whatsapp_phone}, secret="meta-secret")

    response = TestClient(app).post(
        "/webhook/whatsapp/delete-user", data={"signed_request": signed}
    )

    assert response.status_code == 200
    assert deleted == [user.id]


def test_delete_user_callback_reports_an_internal_error(db, monkeypatch):
    user = _user(db, "5491222222222")
    db.commit()
    monkeypatch.setattr(whatsapp_webhook, "APP_SECRET", "")
    monkeypatch.setattr(whatsapp_webhook, "APP_ENV", "development")
    monkeypatch.setattr("app.database.SessionLocal", lambda: _SessionProxy(db))
    monkeypatch.setattr(
        "app.services.account_deletion.delete_user_and_all_data",
        lambda *_args: (_ for _ in ()).throw(RuntimeError("cannot delete")),
    )

    response = TestClient(app).post(
        "/webhook/whatsapp/delete-user",
        data={"signed_request": _signed_request({"user_id": user.whatsapp_phone})},
    )

    assert response.status_code == 500


def test_parse_signed_request_validates_signature_and_encoding(monkeypatch):
    monkeypatch.setattr(whatsapp_webhook, "APP_SECRET", "meta-secret")

    assert whatsapp_webhook._parse_signed_request("no-dot") is None
    assert whatsapp_webhook._parse_signed_request("!!!.invalid") is None
    assert (
        whatsapp_webhook._parse_signed_request(
            _signed_request({"user_id": "1"}, secret="wrong-secret")
        )
        is None
    )
    assert whatsapp_webhook._parse_signed_request(
        _signed_request({"user_id": "1"}, secret="meta-secret")
    ) == {"user_id": "1"}

    monkeypatch.setattr(whatsapp_webhook, "APP_SECRET", "")
    monkeypatch.setattr(whatsapp_webhook, "APP_ENV", "production")
    assert whatsapp_webhook._parse_signed_request("unsigned.payload") is None


# ── Cloud API helpers ───────────────────────────────────────


class _Response:
    def __init__(self, status_code: int = 200, payload=None):
        self.status_code = status_code
        self._payload = payload or {"messages": [{"id": "wamid"}]}

    def json(self):
        return self._payload


def _fake_httpx(monkeypatch, response=None, raises: Exception | None = None):
    sent = []

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def post(self, url, **kwargs):
            sent.append((url, kwargs))
            if raises:
                raise raises
            return response or _Response()

    monkeypatch.setattr(bot.httpx, "AsyncClient", FakeClient)
    return sent


def test_cloud_api_helpers_send_the_expected_payloads(monkeypatch):
    sent = _fake_httpx(monkeypatch)

    text = asyncio.run(bot.send_text("123", "hola"))
    buttons = asyncio.run(
        bot.send_reply_buttons(
            "123", "elegí", [{"id": "a", "title": "A"}, {"id": "b", "title": "B"}]
        )
    )
    listing = asyncio.run(
        bot.send_list_message("123", "elegí", "ver", [{"title": "t", "rows": []}])
    )
    asyncio.run(bot.mark_as_read("wamid"))

    assert text["messages"][0]["id"] == "wamid"
    assert buttons["messages"][0]["id"] == "wamid"
    assert listing["messages"][0]["id"] == "wamid"
    assert sent[0][1]["json"]["text"]["body"] == "hola"
    assert sent[1][1]["json"]["interactive"]["type"] == "button"
    assert sent[2][1]["json"]["interactive"]["type"] == "list"
    assert sent[3][1]["json"]["status"] == "read"


def test_cloud_api_helpers_log_errors_but_return_the_body(monkeypatch):
    _fake_httpx(monkeypatch, response=_Response(500, {"error": "boom"}))

    assert asyncio.run(bot.send_text("123", "hola")) == {"error": "boom"}
    assert asyncio.run(bot.send_reply_buttons("123", "elegí", [{"id": "a", "title": "A"}])) == {
        "error": "boom"
    }
    assert asyncio.run(
        bot.send_list_message("123", "elegí", "ver", [{"title": "t", "rows": []}])
    ) == {"error": "boom"}


def test_mark_as_read_swallows_transport_errors(monkeypatch):
    _fake_httpx(monkeypatch, raises=ConnectionError("network down"))

    asyncio.run(bot.mark_as_read("wamid"))


# ── Bot text flow ───────────────────────────────────────────


def test_handle_message_asks_an_unlinked_phone_to_link(db, sends, monkeypatch):
    monkeypatch.setattr(bot, "SessionLocal", lambda: _SessionProxy(db))

    asyncio.run(
        bot.handle_whatsapp_message(
            phone="5491000000000",
            message_id="m1",
            msg_type="text",
            msg_data={"text": {"body": "hola"}},
        )
    )

    assert "vincular" in sends["text"][0][1]
    assert bot._sessions[compute_hmac("5491000000000")]["state"] == "WAITING_AUTH"


def test_handle_message_rejects_non_text_messages(db, sends, monkeypatch):
    _user(db, "5491000000001")
    db.commit()
    monkeypatch.setattr(bot, "SessionLocal", lambda: _SessionProxy(db))

    asyncio.run(
        bot.handle_whatsapp_message(
            phone="5491000000001",
            message_id="m1",
            msg_type="image",
            msg_data={},
        )
    )

    assert "solo puedo procesar mensajes de texto" in sends["text"][0][1]


def test_text_help_and_unrecognized_messages(db, sends, monkeypatch):
    user = _user(db, "5491000000002")
    session = bot._get_session("hash")

    asyncio.run(bot._handle_text_message("5491000000002", "hash", "ayuda", session, user))

    async def no_parse(_text):
        return []

    monkeypatch.setattr(bot, "_parse_expense_async", no_parse)
    asyncio.run(bot._handle_text_message("5491000000002", "hash", "??", session, user))

    assert "Así registrás" in sends["text"][0][1]
    assert "No entendí" in sends["text"][1][1]


def test_text_single_expense_asks_for_the_payment_method(db, sends, monkeypatch):
    user = _user(db, "5491000000003")
    db.commit()
    session = bot._get_session("hash")

    async def parse(_text):
        return [_parsed()]

    monkeypatch.setattr(bot, "_parse_expense_async", parse)
    monkeypatch.setattr(bot, "_is_bank_notification", lambda _text: False)
    monkeypatch.setattr(bot, "_extract_card_from_text", lambda _text: ("", "", ""))
    monkeypatch.setattr(bot, "_match_account_from_text", lambda *_args: None)
    monkeypatch.setattr(bot, "SessionLocal", lambda: _SessionProxy(db))

    asyncio.run(bot._handle_text_message("5491000000003", "hash", "farmacity 3200", session, user))

    assert session["state"] == "WAITING_PAYMENT"
    assert sends["buttons"][0][1].startswith("🛒")


def test_text_confirm_yes_saves_and_confirm_no_cancels(db, sends, monkeypatch):
    user = _user(db, "5491000000004")
    db.commit()
    saved = []

    def fake_save(parsed, **kwargs):
        saved.append((parsed, kwargs))
        return SimpleNamespace(
            description="Farmacity",
            amount=3200.0,
            currency="ARS",
            date=date(2026, 11, 20),
        )

    monkeypatch.setattr(bot, "_save_expense", fake_save)
    monkeypatch.setattr(bot, "SessionLocal", lambda: _SessionProxy(db))
    session = bot._get_session("hash-yes")
    session["state"] = "WAITING_CONFIRM"
    session["data"] = {"parsed": _parsed(), "payment_label": "Efectivo", "payment_method": "none"}

    asyncio.run(bot._handle_text_message("5491000000004", "hash-yes", "sí", session, user))

    assert saved
    assert "Gasto guardado" in sends["text"][0][1]
    assert "hash-yes" not in bot._sessions

    cancel_session = bot._get_session("hash-no")
    cancel_session["state"] = "WAITING_CONFIRM"
    cancel_session["data"] = {"parsed": _parsed()}
    asyncio.run(bot._handle_text_message("5491000000004", "hash-no", "no", cancel_session, user))
    assert "Cancelado" in sends["text"][1][1]


def test_text_batch_saves_every_parsed_item(db, sends, monkeypatch):
    user = _user(db, "5491000000005")
    db.commit()
    saved = []

    async def parse(_text):
        return [_parsed(description="Uno"), _parsed(description="Dos")]

    def fake_save(parsed, **kwargs):
        saved.append(parsed["description"])
        return SimpleNamespace(
            description=parsed["description"],
            amount=parsed["amount"],
            currency=parsed["currency"],
            date=date(2026, 11, 20),
        )

    monkeypatch.setattr(bot, "_parse_expense_async", parse)
    monkeypatch.setattr(bot, "_extract_card_from_text", lambda _text: ("", "", ""))
    monkeypatch.setattr(bot, "_match_card_from_text", lambda *_args: None)
    monkeypatch.setattr(bot, "_match_account_from_text", lambda *_args: None)
    monkeypatch.setattr(bot, "_instant_categorize", lambda *_args: (None, None))
    monkeypatch.setattr(bot, "_save_expense", fake_save)
    monkeypatch.setattr(bot, "SessionLocal", lambda: _SessionProxy(db))
    session = bot._get_session("hash-batch")

    asyncio.run(
        bot._handle_text_message("5491000000005", "hash-batch", "dos gastos", session, user)
    )

    assert saved == ["Uno", "Dos"]
    assert "2 gastos guardados" in sends["text"][0][1]


def test_text_single_expense_matches_a_card_or_account(db, sends, monkeypatch):
    user = _user(db, "5491000000006")
    card = Card(
        card_name="Visa",
        bank="Galicia",
        holder="WhatsApp",
        card_type="credito",
        user_id=user.id,
    )
    account = Account(name="Efectivo", type="efectivo", user_id=user.id)
    db.add_all([card, account])
    db.commit()
    monkeypatch.setattr(bot, "SessionLocal", lambda: _SessionProxy(db))
    monkeypatch.setattr(bot, "_is_bank_notification", lambda _text: False)
    monkeypatch.setattr(bot, "_instant_categorize", lambda *_args: (None, None))
    monkeypatch.setattr(bot, "_build_cat_levels", lambda *_args: [])
    monkeypatch.setattr(bot, "_should_ask_installments", lambda *_args: False)

    async def parse(_text):
        return [_parsed()]

    monkeypatch.setattr(bot, "_parse_expense_async", parse)
    monkeypatch.setattr(
        bot, "_extract_card_from_text", lambda _text: ("Visa", "Galicia", "credito")
    )
    monkeypatch.setattr(bot, "_match_card_from_text", lambda *_args: card)
    session = bot._get_session("hash-card")
    asyncio.run(bot._handle_text_message("5491000000006", "hash-card", "visa", session, user))
    assert session["state"] == "WAITING_CONFIRM"
    assert session["data"]["card_id"] == card.id

    monkeypatch.setattr(bot, "_extract_card_from_text", lambda _text: ("", "", ""))
    monkeypatch.setattr(bot, "_match_account_from_text", lambda *_args: account)
    session = bot._get_session("hash-account")
    asyncio.run(
        bot._handle_text_message("5491000000006", "hash-account", "efectivo", session, user)
    )
    assert session["data"]["account_id"] == account.id


# ── Bot auth, buttons and lists ─────────────────────────────


def test_handle_auth_rejects_a_bad_key_and_links_a_valid_one(db, sends, monkeypatch):
    monkeypatch.setattr(bot, "SessionLocal", lambda: _SessionProxy(db))
    session = bot._get_session("hash-auth")

    asyncio.run(bot._handle_auth("5491000000007", "phone-hash", "bad-key", session, None))

    assert "Código inválido" in sends["text"][0][1]

    user = _user(db, "5491000000007", whatsapp_key="good-key")
    db.commit()
    asyncio.run(bot._handle_auth("5491000000007", "phone-hash", "good-key", session, user))
    db.refresh(user)
    assert user.whatsapp_phone == "5491000000007"
    assert user.whatsapp_key is None
    assert session["user_id"] == user.id


def test_payment_buttons_without_cards_or_accounts_ask_for_a_name(db, sends, monkeypatch):
    user = _user(db, "5491000000008")
    db.commit()
    monkeypatch.setattr(bot, "SessionLocal", lambda: _SessionProxy(db))

    cash_session = bot._get_session("cash")
    asyncio.run(bot._handle_button_reply("1", "cash", "pay:cash", cash_session, user))
    assert cash_session["state"] == "WAITING_ACCOUNT_CREATE_NAME"
    assert "No tenés cuentas" in sends["text"][0][1]

    card_session = bot._get_session("card")
    asyncio.run(bot._handle_button_reply("1", "card", "pay:card", card_session, user))
    assert card_session["state"] == "WAITING_CARD_CREATE_NAME"
    assert "No tenés tarjetas" in sends["text"][1][1]


def test_payment_buttons_with_data_show_selection_lists(db, sends, monkeypatch):
    user = _user(db, "5491000000009")
    card = Card(
        card_name="Visa",
        bank="Galicia",
        holder="WhatsApp",
        card_type="credito",
        user_id=user.id,
    )
    account = Account(name="Efectivo", type="efectivo", user_id=user.id)
    db.add_all([card, account])
    db.commit()
    monkeypatch.setattr(bot, "SessionLocal", lambda: _SessionProxy(db))

    cash_session = bot._get_session("cash")
    asyncio.run(bot._handle_button_reply("1", "cash", "pay:cash", cash_session, user))
    card_session = bot._get_session("card")
    asyncio.run(bot._handle_button_reply("1", "card", "pay:card", card_session, user))

    assert cash_session["state"] == "WAITING_ACCOUNT_SELECT"
    assert card_session["state"] == "WAITING_CARD_SELECT"
    assert sends["list"][0][3][0]["rows"][0]["id"] == f"acct:{account.id}"
    assert sends["list"][1][3][0]["rows"][0]["id"] == f"card:{card.id}"


def test_payment_none_confirms_without_a_card_or_account(db, sends, monkeypatch):
    user = _user(db, "5491000010000")
    db.commit()
    monkeypatch.setattr(bot, "SessionLocal", lambda: _SessionProxy(db))
    monkeypatch.setattr(bot, "_instant_categorize", lambda *_args: (None, None))
    monkeypatch.setattr(bot, "_build_cat_levels", lambda *_args: [])
    session = bot._get_session("none")
    session["state"] = "WAITING_PAYMENT"
    session["data"] = {"parsed": _parsed(), "card_id": 1, "account_id": 2}

    asyncio.run(bot._handle_button_reply("1", "none", "payment_none", session, user))

    assert session["state"] == "WAITING_CONFIRM"
    assert session["data"]["payment_method"] == "none"
    assert "card_id" not in session["data"]
    assert "account_id" not in session["data"]


def test_installment_buttons_and_invalid_input(db, sends, monkeypatch):
    user = _user(db, "5491000010001")
    db.commit()
    monkeypatch.setattr(bot, "SessionLocal", lambda: _SessionProxy(db))
    monkeypatch.setattr(bot, "_build_cat_levels", lambda *_args: [])
    session = bot._get_session("inst")
    session["data"] = {"parsed": _parsed(), "payment_label": "Visa", "predicted_category_id": None}

    asyncio.run(bot._handle_button_reply("1", "inst", "installment:yes", session, user))
    assert session["state"] == "WAITING_INSTALLMENT_NUMBER"

    asyncio.run(bot._handle_installment_number("1", "inst", "1", session, user.id))
    assert "entre 2 y 60" in sends["text"][0][1]

    asyncio.run(bot._handle_installment_number("1", "inst", "3", session, user.id))
    assert session["state"] == "WAITING_CONFIRM"
    assert session["data"]["installment_total"] == 3

    no_session = bot._get_session("inst-no")
    no_session["state"] = "WAITING_INSTALLMENT_QUESTION"
    no_session["data"] = {"parsed": _parsed(), "payment_label": "Visa"}
    asyncio.run(bot._handle_button_reply("1", "inst-no", "installment:no", no_session, user))
    assert no_session["state"] == "WAITING_CONFIRM"

    asyncio.run(bot._handle_button_reply("1", "inst-num", "inst:6", session, user))
    assert session["data"]["installment_total"] == 6


def test_button_and_list_handlers_fall_back_to_help(db, sends, monkeypatch):
    user = _user(db, "5491000010002")
    db.commit()
    monkeypatch.setattr(bot, "_instant_categorize", lambda *_args: (None, None))
    monkeypatch.setattr(bot, "_build_cat_levels", lambda *_args: [])
    monkeypatch.setattr(bot, "_should_ask_installments", lambda *_args: False)

    asyncio.run(bot._handle_button_reply("1", "x", "unknown", bot._get_session("x"), user))
    asyncio.run(bot._handle_list_reply("1", "y", "unknown", bot._get_session("y"), user))

    assert "No entendí" in sends["text"][0][1]
    assert "No entendí" in sends["text"][1][1]


def test_account_and_card_creation_create_rows_and_confirm(db, sends, monkeypatch):
    user = _user(db, "5491000010003")
    db.commit()
    monkeypatch.setattr(bot, "SessionLocal", lambda: _SessionProxy(db))
    monkeypatch.setattr(bot, "_instant_categorize", lambda *_args: (None, None))
    monkeypatch.setattr(bot, "_build_cat_levels", lambda *_args: [])
    monkeypatch.setattr(bot, "_should_ask_installments", lambda *_args: False)
    monkeypatch.setattr(
        "app.telegram_bot._extract_card_info",
        lambda *_args: {"card_name": "Visa", "bank": "Galicia"},
    )

    account_session = bot._get_session("acct")
    account_session["data"] = {"parsed": _parsed()}
    asyncio.run(bot._handle_account_create_name("1", "acct", "x", account_session, user.id))
    assert "al menos 2" in sends["text"][0][1]

    asyncio.run(
        bot._handle_account_create_name("1", "acct", "Mercado Pago", account_session, user.id)
    )
    account = db.query(Account).filter(Account.user_id == user.id).one()
    assert account.type == "mercadopago"
    assert account_session["data"]["account_id"] == account.id

    card_session = bot._get_session("card")
    card_session["data"] = {"parsed": _parsed()}
    asyncio.run(bot._handle_card_create_name("1", "card", "Visa Galicia", card_session, user.id))
    card = db.query(Card).filter(Card.user_id == user.id).one()
    assert card.card_name == "Visa"

    asyncio.run(bot._handle_card_create_name("1", "card", "Visa Galicia", card_session, user.id))
    assert db.query(Card).filter(Card.user_id == user.id).count() == 1


def test_account_type_mapping_covers_each_branch(db, sends, monkeypatch):
    user = _user(db, "5491000010004")
    db.commit()
    monkeypatch.setattr(bot, "SessionLocal", lambda: _SessionProxy(db))
    monkeypatch.setattr(bot, "_instant_categorize", lambda *_args: (None, None))
    monkeypatch.setattr(bot, "_build_cat_levels", lambda *_args: [])

    for index, (name, expected) in enumerate(
        [
            ("Efectivo", "efectivo"),
            ("Caja de Ahorro", "caja_ahorro"),
            ("Cuenta Corriente", "cuenta_corriente"),
            ("Otro Banco", "cuenta_corriente"),
        ]
    ):
        session = bot._get_session(f"acct-{index}")
        session["data"] = {"parsed": _parsed()}
        asyncio.run(bot._handle_account_create_name("1", f"acct-{index}", name, session, user.id))
        accounts = db.query(Account).filter(Account.user_id == user.id).all()
        account = next(a for a in accounts if a.name == name)
        assert account.type == expected


def test_list_reply_selects_an_account_or_card(db, sends, monkeypatch):
    user = _user(db, "5491000010005")
    card = Card(
        card_name="Visa",
        bank="Galicia",
        holder="WhatsApp",
        card_type="credito",
        user_id=user.id,
    )
    account = Account(name="Efectivo", type="efectivo", user_id=user.id)
    db.add_all([card, account])
    db.commit()
    monkeypatch.setattr(bot, "SessionLocal", lambda: _SessionProxy(db))
    monkeypatch.setattr(bot, "_instant_categorize", lambda *_args: (None, None))
    monkeypatch.setattr(bot, "_build_cat_levels", lambda *_args: [])
    monkeypatch.setattr(bot, "_should_ask_installments", lambda *_args: False)

    account_session = bot._get_session("list-acct")
    account_session["data"] = {"parsed": _parsed()}
    asyncio.run(
        bot._handle_list_reply("1", "list-acct", f"acct:{account.id}", account_session, user)
    )
    assert account_session["data"]["account_id"] == account.id

    card_session = bot._get_session("list-card")
    card_session["data"] = {"parsed": _parsed()}
    asyncio.run(bot._handle_list_reply("1", "list-card", f"card:{card.id}", card_session, user))
    assert card_session["data"]["card_id"] == card.id


def test_save_expense_covers_no_data_card_account_and_failure(db, sends, monkeypatch):
    user = _user(db, "5491000010006")
    db.commit()
    monkeypatch.setattr(bot, "SessionLocal", lambda: _SessionProxy(db))
    saved = []

    def fake_save(parsed, **kwargs):
        saved.append(kwargs)
        return SimpleNamespace(
            description="Compra",
            amount=10.0,
            currency="ARS",
            date=date(2026, 11, 20),
        )

    monkeypatch.setattr(bot, "_save_expense", fake_save)

    asyncio.run(bot._do_save_expense("1", "empty", bot._get_session("empty"), user.id))
    assert "No hay gasto" in sends["text"][0][1]

    card_session = bot._get_session("save-card")
    card_session["data"] = {
        "parsed": _parsed(),
        "payment_method": "tarjeta",
        "card_selected": "Visa",
        "card_bank": "Galicia",
        "card_id": 5,
        "installment_total": 3,
        "installment_group_id": "g",
        "installment_number": 2,
    }
    asyncio.run(bot._do_save_expense("1", "save-card", card_session, user.id))
    assert saved[-1]["card_id"] == 5
    assert saved[-1]["installment_total"] == 3

    account_session = bot._get_session("save-account")
    account_session["data"] = {
        "parsed": _parsed(),
        "payment_method": "efectivo_transferencia",
        "payment_label": "Efectivo",
        "account_id": 7,
    }
    asyncio.run(bot._do_save_expense("1", "save-account", account_session, user.id))
    assert saved[-1]["account_id"] == 7

    other_session = bot._get_session("save-other")
    other_session["data"] = {"parsed": _parsed(), "payment_method": "none"}
    asyncio.run(bot._do_save_expense("1", "save-other", other_session, user.id))
    assert "account_id" not in saved[-1]

    monkeypatch.setattr(
        bot, "_save_expense", lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("db"))
    )
    failing = bot._get_session("save-fail")
    failing["data"] = {"parsed": _parsed(), "payment_method": "none"}
    asyncio.run(bot._do_save_expense("1", "save-fail", failing, user.id))
    assert "Error al guardar" in sends["text"][-1][1]


def test_bank_notification_without_a_match_asks_for_the_payment_method(db, sends, monkeypatch):
    user = _user(db, "5491000010007")
    db.commit()
    monkeypatch.setattr(bot, "SessionLocal", lambda: _SessionProxy(db))
    monkeypatch.setattr(bot, "_match_card_from_notification", lambda *_args: None)
    monkeypatch.setattr(bot, "_match_account_from_text", lambda *_args: None)
    session = bot._get_session("bank")

    asyncio.run(
        bot._handle_bank_notification(
            "1",
            "bank",
            "Compra aprobada",
            _parsed(bank="Galicia", card_type="credito"),
            session,
            user.id,
        )
    )

    assert session["state"] == "WAITING_PAYMENT"
    assert "Notificación bancaria" in sends["buttons"][0][1]


def test_bank_notification_with_a_card_confirms_or_asks_installments(db, sends, monkeypatch):
    user = _user(db, "5491000010008")
    card = Card(
        card_name="Visa",
        bank="Galicia",
        holder="WhatsApp",
        card_type="credito",
        user_id=user.id,
    )
    db.add(card)
    db.commit()
    monkeypatch.setattr(bot, "SessionLocal", lambda: _SessionProxy(db))
    monkeypatch.setattr(bot, "_match_card_from_notification", lambda *_args: card)
    monkeypatch.setattr(bot, "_instant_categorize", lambda *_args: (None, None))
    monkeypatch.setattr(bot, "_build_cat_levels", lambda *_args: [])
    monkeypatch.setattr(bot, "_installment_args", lambda _parsed: None)

    session = bot._get_session("bank-ok")
    monkeypatch.setattr(bot, "_should_ask_installments", lambda *_args: False)
    asyncio.run(
        bot._handle_bank_notification("1", "bank-ok", "Compra", _parsed(), session, user.id)
    )
    assert session["state"] == "WAITING_CONFIRM"

    installment_session = bot._get_session("bank-inst")
    monkeypatch.setattr(bot, "_should_ask_installments", lambda *_args: True)
    asyncio.run(
        bot._handle_bank_notification(
            "1", "bank-inst", "Compra", _parsed(), installment_session, user.id
        )
    )
    assert installment_session["state"] == "WAITING_INSTALLMENT_QUESTION"


def test_message_formatting_helpers():
    assert bot._wa_bold("hola") == "*hola*"
    assert bot._wa_italic("hola") == "_hola_"
    confirm = bot._confirm_text_wa(_parsed(), "Visa", ["Comida", "Delivery"], "📋 Cuota 1 de 3")
    assert "Visa" in confirm
    assert "Cuota 1 de 3" in confirm
    saved = bot._saved_text_wa(
        SimpleNamespace(
            description="Compra",
            amount=10.0,
            currency="ARS",
            date=date(2026, 11, 20),
        ),
        "Efectivo",
    )
    assert "Gasto guardado" in saved
    assert "20/11/2026" in saved
