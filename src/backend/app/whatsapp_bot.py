"""WhatsApp Business API bot for expense logging.

Uses Meta Cloud API (https://developers.facebook.com/docs/whatsapp/cloud-api).
Shares business logic with telegram_bot.py for parsing, categorization, and persistence.
"""

import contextlib
import logging
import os
import uuid
from datetime import datetime

import httpx

from app.database import SessionLocal
from app.models import Account, Card, User
from app.services.encryption import compute_hmac

logger = logging.getLogger(__name__)

# WhatsApp API config
WHATSAPP_TOKEN = os.getenv("WHATSAPP_TOKEN", "")
WHATSAPP_PHONE_ID = os.getenv("WHATSAPP_PHONE_ID", "")
WHATSAPP_API_URL = f"https://graph.facebook.com/v21.0/{WHATSAPP_PHONE_ID}/messages"

# Timezone
try:
    from zoneinfo import ZoneInfo
except ImportError:
    from backports.zoneinfo import ZoneInfo

BUE = ZoneInfo("America/Argentina/Buenos_Aires")


# ---------------------------------------------------------------------------
# WhatsApp API helpers
# ---------------------------------------------------------------------------


async def send_text(phone: str, text: str) -> dict:
    """Send a text message via WhatsApp Cloud API."""
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            WHATSAPP_API_URL,
            headers={
                "Authorization": f"Bearer {WHATSAPP_TOKEN}",
                "Content-Type": "application/json",
            },
            json={
                "messaging_product": "whatsapp",
                "recipient_type": "individual",
                "to": phone,
                "type": "text",
                "text": {"preview_url": False, "body": text},
            },
        )
        data = resp.json()
        if resp.status_code != 200:
            logger.error("[WA] send_text error: %s", data)
        return data


async def send_reply_buttons(phone: str, body_text: str, buttons: list[dict]) -> dict:
    """Send interactive reply buttons (max 3 buttons).

    Each button: {"id": str, "title": str}
    """
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            WHATSAPP_API_URL,
            headers={
                "Authorization": f"Bearer {WHATSAPP_TOKEN}",
                "Content-Type": "application/json",
            },
            json={
                "messaging_product": "whatsapp",
                "recipient_type": "individual",
                "to": phone,
                "type": "interactive",
                "interactive": {
                    "type": "button",
                    "body": {"text": body_text},
                    "action": {
                        "buttons": [
                            {
                                "type": "reply",
                                "reply": {"id": b["id"], "title": b["title"]},
                            }
                            for b in buttons[:3]
                        ]
                    },
                },
            },
        )
        data = resp.json()
        if resp.status_code != 200:
            logger.error("[WA] send_reply_buttons error: %s", data)
        return data


async def send_list_message(
    phone: str, body_text: str, button_text: str, sections: list[dict]
) -> dict:
    """Send an interactive list message.

    Each section: {"title": str, "rows": [{"id": str, "title": str, "description": str}]}
    """
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            WHATSAPP_API_URL,
            headers={
                "Authorization": f"Bearer {WHATSAPP_TOKEN}",
                "Content-Type": "application/json",
            },
            json={
                "messaging_product": "whatsapp",
                "recipient_type": "individual",
                "to": phone,
                "type": "interactive",
                "interactive": {
                    "type": "list",
                    "body": {"text": body_text},
                    "action": {
                        "button": button_text,
                        "sections": sections,
                    },
                },
            },
        )
        data = resp.json()
        if resp.status_code != 200:
            logger.error("[WA] send_list_message error: %s", data)
        return data


async def mark_as_read(message_id: str) -> None:
    """Mark a message as read (best-effort, non-critical)."""
    try:
        async with httpx.AsyncClient() as client:
            await client.post(
                WHATSAPP_API_URL,
                headers={
                    "Authorization": f"Bearer {WHATSAPP_TOKEN}",
                    "Content-Type": "application/json",
                },
                json={
                    "messaging_product": "whatsapp",
                    "status": "read",
                    "message_id": message_id,
                },
            )
    except Exception as e:
        logger.warning("[WA] mark_as_read failed (non-critical): %s", e)


# ---------------------------------------------------------------------------
# Session management (in-memory, keyed by phone hash)
# ---------------------------------------------------------------------------

_sessions: dict[str, dict] = {}


def _get_session(phone_hash: str) -> dict:
    """Get or create a session for a phone number."""
    if phone_hash not in _sessions:
        _sessions[phone_hash] = {"state": None, "data": {}}
    return _sessions[phone_hash]


def _clear_session(phone_hash: str) -> None:
    """Clear a session."""
    _sessions.pop(phone_hash, None)


# ---------------------------------------------------------------------------
# Shared business logic (imported from telegram_bot)
# ---------------------------------------------------------------------------

from app.telegram_bot import (  # noqa: E402
    _build_cat_levels,
    _cat_emoji,
    _extract_card_from_text,
    _format_amount,
    _format_date_es,
    _instant_categorize,
    _is_bank_notification,
    _match_account_from_text,
    _match_card_from_notification,
    _parse_expense,
    _save_expense,
    _should_ask_installments,
)

# ---------------------------------------------------------------------------
# WhatsApp message formatting
# ---------------------------------------------------------------------------


def _wa_bold(text: str) -> str:
    return f"*{text}*"


def _wa_italic(text: str) -> str:
    return f"_{text}_"


def _confirm_text_wa(
    parsed: dict, payment_label: str, cat_levels: list[str], installment_info: str = ""
) -> str:
    """Build confirmation message in WhatsApp markdown format."""
    desc = parsed.get("description", "")
    amount = parsed.get("amount", 0)
    currency = parsed.get("currency", "ARS")
    date_str = parsed.get("date", datetime.now(BUE).date().strftime("%Y-%m-%d"))

    lines = [
        _wa_bold(desc),
        f"💰 {_format_amount(amount, currency)}",
        f"📅 {_format_date_es(date_str)}",
        f"💳 {payment_label}",
    ]
    if installment_info:
        lines.append(installment_info)
    if cat_levels:
        cat_tree = ""
        indents = ["", "  └ ", "      └ "]
        for i, name in enumerate(cat_levels):
            indent = indents[i] if i < len(indents) else indents[-1]
            cat_tree += f"{indent}{_cat_emoji(name)} {name}\n"
        lines.append(cat_tree.strip())
    lines.append("")
    lines.append("¿Lo guardamos? (responde *sí* o *no*)")
    return "\n".join(lines)


def _saved_text_wa(expense, payment_label: str) -> str:
    """Build 'expense saved' message in WhatsApp markdown format."""
    desc = expense.description or ""
    amount = expense.amount or 0
    currency = expense.currency or "ARS"
    date_str = expense.date.strftime("%d/%m/%Y") if expense.date else ""

    lines = [
        "✅ *Gasto guardado*",
        "",
        f"🛒 {_wa_bold(desc)}",
        f"💰 {_format_amount(amount, currency)}",
        f"📅 {date_str}",
        f"💳 {payment_label}",
    ]
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Main message handler
# ---------------------------------------------------------------------------


async def handle_whatsapp_message(
    phone: str, message_id: str, msg_type: str, msg_data: dict
) -> None:
    """Handle an incoming WhatsApp message.

    Args:
        phone: Sender's phone number (E.164 format, e.g., "5491112345678")
        message_id: WhatsApp message ID
        msg_type: Message type ("text", "interactive", "image", etc.)
        msg_data: Full message object from webhook payload
    """
    # Non-critical: mark as read (best-effort)
    with contextlib.suppress(Exception):
        await mark_as_read(message_id)

    # Find user by phone hash
    phone_hash = compute_hmac(phone)
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.whatsapp_phone_hash == phone_hash).first()
    finally:
        db.close()

    if not user:
        await send_text(
            phone,
            "👋 ¡Hola! Para usar Oikonomia por WhatsApp, necesitás vincular tu número.\n\n"
            "1. Entrá a la app → Configuración → WhatsApp Bot\n"
            "2. Copiá el código de 12 caracteres\n"
            "3. Mandámelo acá",
        )
        _get_session(phone_hash)["state"] = "WAITING_AUTH"
        return

    # Mark user as verified if not already
    if not user.whatsapp_verified:
        db = SessionLocal()
        try:
            u = db.query(User).filter(User.id == user.id).first()
            if u:
                u.whatsapp_verified = True
                db.commit()
        finally:
            db.close()

    session = _get_session(phone_hash)
    session["user_id"] = user.id
    session["phone"] = phone

    # Route based on message type
    if msg_type == "text":
        text = msg_data.get("text", {}).get("body", "").strip()
        await _handle_text_message(phone, phone_hash, text, session, user)
    elif msg_type == "interactive":
        interactive = msg_data.get("interactive", {})
        interactive_type = interactive.get("type")
        if interactive_type == "button_reply":
            button_id = interactive.get("button_reply", {}).get("id", "")
            await _handle_button_reply(phone, phone_hash, button_id, session, user)
        elif interactive_type == "list_reply":
            list_id = interactive.get("list_reply", {}).get("id", "")
            await _handle_list_reply(phone, phone_hash, list_id, session, user)
    else:
        await send_text(
            phone,
            "📝 Por ahora solo puedo procesar mensajes de texto. Mandame un gasto o escribí *ayuda*.",
        )


# ---------------------------------------------------------------------------
# Text message handler
# ---------------------------------------------------------------------------


async def _handle_text_message(
    phone: str, phone_hash: str, text: str, session: dict, user: User
) -> None:
    """Handle a text message based on current session state."""
    state = session.get("state")
    user_id = user.id

    # Authentication flow
    if state == "WAITING_AUTH":
        await _handle_auth(phone, phone_hash, text, session, user)
        return

    # Installment number input
    if state == "WAITING_INSTALLMENT_NUMBER":
        await _handle_installment_number(phone, phone_hash, text, session, user_id)
        return

    # Account create name
    if state == "WAITING_ACCOUNT_CREATE_NAME":
        await _handle_account_create_name(phone, phone_hash, text, session, user_id)
        return

    # Card create name
    if state == "WAITING_CARD_CREATE_NAME":
        await _handle_card_create_name(phone, phone_hash, text, session, user_id)
        return

    # Confirm (text-based yes/no)
    if state == "WAITING_CONFIRM":
        lower = text.lower().strip()
        if lower in ("sí", "si", "yes", "s", "guardar", "ok"):
            await _do_save_expense(phone, phone_hash, session, user_id)
            return
        elif lower in ("no", "n", "cancelar", "cancel"):
            _clear_session(phone_hash)
            await send_text(phone, "❌ Cancelado. Cuando quieras, mandame otro gasto.")
            return

    # Help
    if text.lower().strip() in ("ayuda", "help", "?", "comandos"):
        await _send_help(phone)
        return

    # Parse expense
    parsed = await _parse_expense_async(text)
    if not parsed or not parsed.get("amount"):
        await send_text(
            phone,
            "🤔 No entendí bien. Mandame un gasto como:\n\n"
            '• "farmacity 3200"\n'
            '• "uber ayer 1800"\n'
            '• "Netflix USD 5"\n\n'
            "O escribí *ayuda* para ver los comandos.",
        )
        return

    session["data"]["parsed"] = parsed
    session["data"]["tg_user"] = user.full_name or ""

    # Check if it's a bank notification
    if _is_bank_notification(text):
        await _handle_bank_notification(phone, phone_hash, text, parsed, session, user_id)
        return

    # Try card matching from text
    text_card_name, text_bank, text_card_type = _extract_card_from_text(text)
    if text_card_name:
        db = SessionLocal()
        try:
            cards = db.query(Card).filter(Card.user_id == user_id).all()
            matched_card = None
            for card in cards:
                card_lower = card.card_name.lower()
                text_lower = text_card_name.lower()
                # Match if DB card starts with the extracted name or vice versa
                # e.g. "visa" matches "visa debito", "visa debito" matches "visa"
                name_match = (
                    card_lower == text_lower
                    or card_lower.startswith(text_lower)
                    or text_lower.startswith(card_lower)
                )
                # Match card type if extracted (debito/credito)
                type_match = not text_card_type or card.card_type == text_card_type
                if (
                    name_match
                    and type_match
                    and (not text_bank or (card.bank and card.bank.lower() == text_bank.lower()))
                ):
                    matched_card = card
                    break
            if not matched_card and text_bank:
                for card in cards:
                    if card.bank and card.bank.lower() == text_bank.lower():
                        matched_card = card
                        break

            if matched_card:
                await _confirm_with_card(phone, phone_hash, matched_card, parsed, session, user_id)
                return
        finally:
            db.close()

    # Try account matching from text
    db = SessionLocal()
    try:
        matched_account = _match_account_from_text(text, user_id, db)
        if matched_account:
            await _confirm_with_account(
                phone, phone_hash, matched_account, parsed, session, user_id
            )
            return
    finally:
        db.close()

    # No match — ask for payment method
    await _ask_payment_method(phone, phone_hash, parsed, session)


# ---------------------------------------------------------------------------
# Auth handler
# ---------------------------------------------------------------------------


async def _handle_auth(phone: str, phone_hash: str, text: str, session: dict, user: User) -> None:
    """Handle WhatsApp key authentication."""
    key = text.strip()
    db = SessionLocal()
    try:
        auth_user = db.query(User).filter(User.whatsapp_key == key).first()
        if not auth_user:
            await send_text(phone, "❌ Código inválido. Verificá e intentá de nuevo.")
            return

        # Link phone to user
        auth_user.whatsapp_phone = phone
        auth_user.whatsapp_phone_hash = phone_hash
        auth_user.whatsapp_key = None  # Invalidate key
        db.commit()

        session["user_id"] = auth_user.id
        session["state"] = None

        await send_text(
            phone,
            f"🎉 ¡Listo, *{auth_user.full_name}*! Tu cuenta está conectada.\n\n"
            "Mandame un gasto como le dirías a un amigo:\n"
            '• "gasté 1500 en farmacity"\n'
            '• "uber 3200 ayer"\n'
            '• "Netflix USD 5"\n\n'
            "Escribí *ayuda* para ver los comandos disponibles.",
        )
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Bank notification handler
# ---------------------------------------------------------------------------


async def _handle_bank_notification(
    phone: str, phone_hash: str, text: str, parsed: dict, session: dict, user_id: int
) -> None:
    """Handle a bank notification message."""
    db = SessionLocal()
    try:
        card = _match_card_from_notification(
            user_id,
            parsed.get("card_last4"),
            parsed.get("bank"),
            parsed.get("card_type"),
            parsed.get("card_name"),
            db,
        )

        if not card:
            # For debit, try account matching
            if parsed.get("card_type") == "debito" and parsed.get("bank"):
                account = _match_account_from_text(parsed["bank"], user_id, db)
                if account:
                    await _confirm_with_account(
                        phone, phone_hash, account, parsed, session, user_id
                    )
                    return

            # No match — ask for payment method
            desc = parsed.get("description", "")
            amount_str = _format_amount(parsed["amount"], parsed.get("currency", "ARS"))
            await send_text(
                phone,
                f"🔔 *Notificación bancaria detectada*\n\n"
                f"🛒 {desc}\n"
                f"💰 {amount_str}\n\n"
                "No encontré esta tarjeta. ¿Cómo pagaste?\n\n"
                "1️⃣ Efectivo/Transferencia\n"
                "2️⃣ Tarjeta",
            )
            session["state"] = "WAITING_PAYMENT"
            return

        # Card matched — check installments
        parsed_installment_total = parsed.get("installment_total")
        installment_info = ""

        if parsed_installment_total and parsed_installment_total >= 2:
            session["data"]["installment_total"] = parsed_installment_total
            session["data"]["installment_group_id"] = str(uuid.uuid4())
            installment_amount = round(parsed["amount"] / parsed_installment_total, 2)
            installment_info = (
                f"📋 Cuota {parsed.get('installment_number', 1)} de {parsed_installment_total}\n"
                f"💰 Cuota: {_format_amount(installment_amount, parsed.get('currency', 'ARS'))}"
            )
        elif _should_ask_installments(
            _instant_categorize(parsed, user_id, db)[0], db, parsed.get("amount", 0), card.card_type
        ):
            await send_reply_buttons(
                phone,
                "¿Lo pagaste en cuotas?",
                [
                    {"id": "installment:yes", "title": "Sí"},
                    {"id": "installment:no", "title": "No"},
                ],
            )
            session["state"] = "WAITING_INSTALLMENT_QUESTION"
            session["data"]["card_id"] = card.id
            session["data"]["card_selected"] = card.card_name
            session["data"]["card_bank"] = card.bank or ""
            session["data"]["payment_label"] = (
                f"{card.bank} {card.card_name}".strip() if card.bank else card.card_name
            )
            session["data"]["payment_method"] = "tarjeta"
            return

        # Build confirmation
        payment_label = f"{card.bank} {card.card_name}".strip() if card.bank else card.card_name
        session["data"]["card_id"] = card.id
        session["data"]["card_selected"] = card.card_name
        session["data"]["card_bank"] = card.bank or ""
        session["data"]["payment_label"] = payment_label
        session["data"]["payment_method"] = "tarjeta"

        predicted_category_id, _ = _instant_categorize(parsed, user_id, db)
        session["data"]["predicted_category_id"] = predicted_category_id

        cat_levels = _build_cat_levels(predicted_category_id, db)
        confirm_text = _confirm_text_wa(parsed, payment_label, cat_levels, installment_info)

        await send_text(phone, confirm_text)
        session["state"] = "WAITING_CONFIRM"
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Payment method & card/account selection
# ---------------------------------------------------------------------------


async def _ask_payment_method(phone: str, phone_hash: str, parsed: dict, session: dict) -> None:
    """Ask how the user paid."""
    desc = parsed.get("description", "")
    amount_str = _format_amount(parsed["amount"], parsed.get("currency", "ARS"))

    await send_reply_buttons(
        phone,
        f"🛒 *{desc}* — {amount_str}\n\n¿Cómo pagaste?",
        [
            {"id": "pay:cash", "title": "💵 Efectivo/Transfer."},
            {"id": "pay:card", "title": "💳 Tarjeta"},
        ],
    )
    session["state"] = "WAITING_PAYMENT"


async def _confirm_with_card(
    phone: str, phone_hash: str, card: Card, parsed: dict, session: dict, user_id: int
) -> None:
    """Build confirmation with a matched card."""
    payment_label = f"{card.bank} {card.card_name}".strip() if card.bank else card.card_name
    session["data"]["card_id"] = card.id
    session["data"]["card_selected"] = card.card_name
    session["data"]["card_bank"] = card.bank or ""
    session["data"]["payment_label"] = payment_label
    session["data"]["payment_method"] = "tarjeta"

    db = SessionLocal()
    try:
        predicted_category_id, _ = _instant_categorize(parsed, user_id, db)
        session["data"]["predicted_category_id"] = predicted_category_id

        # Check installments
        if _should_ask_installments(
            predicted_category_id, db, parsed.get("amount", 0), card.card_type
        ):
            await send_reply_buttons(
                phone,
                "¿Lo pagaste en cuotas?",
                [
                    {"id": "installment:yes", "title": "Sí"},
                    {"id": "installment:no", "title": "No"},
                ],
            )
            session["state"] = "WAITING_INSTALLMENT_QUESTION"
            return

        cat_levels = _build_cat_levels(predicted_category_id, db)
    finally:
        db.close()

    confirm_text = _confirm_text_wa(parsed, payment_label, cat_levels)
    await send_text(phone, confirm_text)
    session["state"] = "WAITING_CONFIRM"


async def _confirm_with_account(
    phone: str, phone_hash: str, account: Account, parsed: dict, session: dict, user_id: int
) -> None:
    """Build confirmation with a matched account."""
    session["data"]["account_id"] = account.id
    session["data"]["payment_label"] = account.name
    session["data"]["payment_method"] = "efectivo_transferencia"

    db = SessionLocal()
    try:
        predicted_category_id, _ = _instant_categorize(parsed, user_id, db)
        session["data"]["predicted_category_id"] = predicted_category_id
        cat_levels = _build_cat_levels(predicted_category_id, db)
    finally:
        db.close()

    lines = [
        _wa_bold(parsed.get("description", "")),
        f"💰 {_format_amount(parsed['amount'], parsed.get('currency', 'ARS'))}",
        f"📅 {_format_date_es(parsed.get('date', ''))}",
        f"🏦 {account.name}",
    ]
    if cat_levels:
        cat_tree = ""
        indents = ["", "  └ ", "      └ "]
        for i, name in enumerate(cat_levels):
            indent = indents[i] if i < len(indents) else indents[-1]
            cat_tree += f"{indent}{_cat_emoji(name)} {name}\n"
        lines.append(cat_tree.strip())
    lines.append("")
    lines.append("¿Lo guardamos? (responde *sí* o *no*)")

    await send_text(phone, "\n".join(lines))
    session["state"] = "WAITING_CONFIRM"


# ---------------------------------------------------------------------------
# Button/list reply handlers
# ---------------------------------------------------------------------------


async def _handle_button_reply(
    phone: str, phone_hash: str, button_id: str, session: dict, user: User
) -> None:
    """Handle interactive button replies."""
    state = session.get("state")
    data = session.get("data", {})
    user_id = user.id

    # Payment method selection
    if state == "WAITING_PAYMENT" or button_id.startswith("pay:"):
        if button_id == "pay:cash":
            session["data"]["payment_method"] = "efectivo_transferencia"
            db = SessionLocal()
            try:
                accounts = db.query(Account).filter(Account.user_id == user_id).all()
            finally:
                db.close()

            if not accounts:
                await send_text(
                    phone,
                    "🏦 No tenés cuentas registradas.\n\n"
                    "¿Qué nombre le ponemos a tu cuenta?\n"
                    "Ejemplo: *Mercado Pago*, *Efectivo*, *Santander*",
                )
                session["state"] = "WAITING_ACCOUNT_CREATE_NAME"
                return

            # Show account list
            sections = [
                {
                    "title": "Tus cuentas",
                    "rows": [
                        {
                            "id": f"acct:{a.id}",
                            "title": a.name[:20],
                            "description": a.type,
                        }
                        for a in accounts
                    ],
                }
            ]
            await send_list_message(
                phone,
                "¿Desde qué cuenta?",
                "Seleccionar cuenta",
                sections,
            )
            session["state"] = "WAITING_ACCOUNT_SELECT"
            return

        elif button_id == "pay:card":
            session["data"]["payment_method"] = "tarjeta"
            db = SessionLocal()
            try:
                cards = db.query(Card).filter(Card.user_id == user_id).all()
            finally:
                db.close()

            if not cards:
                await send_text(
                    phone,
                    "💳 No tenés tarjetas registradas.\n\n"
                    "¿Qué tarjeta fue? (ej: *Visa Galicia*, *Mastercard Santander*)",
                )
                session["state"] = "WAITING_CARD_CREATE_NAME"
                return

            # Group by bank
            by_bank: dict[str, list[Card]] = {}
            for c in cards:
                bank = c.bank or "Sin banco"
                by_bank.setdefault(bank, []).append(c)

            sections = []
            for bank, bank_cards in by_bank.items():
                sections.append(
                    {
                        "title": bank[:20],
                        "rows": [
                            {
                                "id": f"card:{c.id}",
                                "title": c.card_name[:20],
                                "description": f"{c.card_type} — {bank}",
                            }
                            for c in bank_cards
                        ],
                    }
                )

            await send_list_message(
                phone,
                "¿Qué tarjeta?",
                "Seleccionar tarjeta",
                sections,
            )
            session["state"] = "WAITING_CARD_SELECT"
            return

    # Installment question
    if state == "WAITING_INSTALLMENT_QUESTION" or button_id.startswith("installment:"):
        if button_id == "installment:yes":
            await send_text(phone, "¿Cuántas cuotas? (Escribí un número entre 2 y 60)")
            session["state"] = "WAITING_INSTALLMENT_NUMBER"
            return
        elif button_id == "installment:no":
            # Go to confirmation
            db = SessionLocal()
            try:
                predicted_category_id = data.get("predicted_category_id")
                cat_levels = _build_cat_levels(predicted_category_id, db)
            finally:
                db.close()
            confirm_text = _confirm_text_wa(
                data.get("parsed", {}),
                data.get("payment_label", ""),
                cat_levels,
            )
            await send_text(phone, confirm_text)
            session["state"] = "WAITING_CONFIRM"
            return

    # Installment number from button (if we ever add quick buttons for common numbers)
    if button_id.startswith("inst:"):
        count = int(button_id.split(":")[1])
        await _set_installments(phone, phone_hash, count, session, user_id)
        return

    await send_text(phone, "🤔 No entendí. Escribí *ayuda* para ver los comandos.")


async def _handle_list_reply(
    phone: str, phone_hash: str, list_id: str, session: dict, user: User
) -> None:
    """Handle interactive list replies."""
    user_id = user.id

    # Account selection
    if list_id.startswith("acct:"):
        account_id = int(list_id.split(":")[1])
        db = SessionLocal()
        try:
            account = db.query(Account).filter(Account.id == account_id).first()
        finally:
            db.close()

        if account:
            await _confirm_with_account(
                phone,
                phone_hash,
                account,
                session.get("data", {}).get("parsed", {}),
                session,
                user_id,
            )
        return

    # Card selection
    if list_id.startswith("card:"):
        card_id = int(list_id.split(":")[1])
        db = SessionLocal()
        try:
            card = db.query(Card).filter(Card.id == card_id).first()
        finally:
            db.close()

        if card:
            await _confirm_with_card(
                phone,
                phone_hash,
                card,
                session.get("data", {}).get("parsed", {}),
                session,
                user_id,
            )
        return

    await send_text(phone, "🤔 No entendí. Escribí *ayuda* para ver los comandos.")


# ---------------------------------------------------------------------------
# Installment number handler
# ---------------------------------------------------------------------------


async def _handle_installment_number(
    phone: str, phone_hash: str, text: str, session: dict, user_id: int
) -> None:
    """Handle numeric input for installment count."""
    try:
        count = int(text.strip())
        if count < 2 or count > 60:
            raise ValueError
    except ValueError:
        await send_text(phone, "❌ Escribí un número entre 2 y 60.")
        return

    await _set_installments(phone, phone_hash, count, session, user_id)


async def _set_installments(
    phone: str, phone_hash: str, count: int, session: dict, user_id: int
) -> None:
    """Set installments and show confirmation."""
    data = session.get("data", {})
    parsed = data.get("parsed", {})

    session["data"]["installment_total"] = count
    session["data"]["installment_group_id"] = str(uuid.uuid4())

    total = parsed.get("amount", 0)
    per_installment = round(total / count, 2)

    db = SessionLocal()
    try:
        predicted_category_id = data.get("predicted_category_id")
        cat_levels = _build_cat_levels(predicted_category_id, db)
    finally:
        db.close()

    installment_info = (
        f"📋 {count} cuotas de {_format_amount(per_installment, parsed.get('currency', 'ARS'))}"
    )
    confirm_text = _confirm_text_wa(
        parsed, data.get("payment_label", ""), cat_levels, installment_info
    )
    await send_text(phone, confirm_text)
    session["state"] = "WAITING_CONFIRM"


# ---------------------------------------------------------------------------
# Account/card creation handlers
# ---------------------------------------------------------------------------


async def _handle_account_create_name(
    phone: str, phone_hash: str, text: str, session: dict, user_id: int
) -> None:
    """Handle account name input for creation."""
    name = text.strip()
    if len(name) < 2:
        await send_text(phone, "❌ El nombre debe tener al menos 2 caracteres.")
        return

    # Determine type from name
    lower = name.lower()
    if "mercadopago" in lower or "mercado pago" in lower or "mp" in lower:
        acct_type = "mercadopago"
    elif "efectivo" in lower or "cash" in lower:
        acct_type = "efectivo"
    elif "caja" in lower and "ahorro" in lower:
        acct_type = "caja_ahorro"
    elif "corriente" in lower:
        acct_type = "cuenta_corriente"
    else:
        acct_type = "cuenta_corriente"

    db = SessionLocal()
    try:
        account = Account(name=name, type=acct_type, user_id=user_id)
        db.add(account)
        db.commit()
        db.refresh(account)
        session["data"]["account_id"] = account.id
        session["data"]["payment_label"] = account.name
    finally:
        db.close()

    await _confirm_with_account(
        phone,
        phone_hash,
        account,
        session.get("data", {}).get("parsed", {}),
        session,
        user_id,
    )


async def _handle_card_create_name(
    phone: str, phone_hash: str, text: str, session: dict, user_id: int
) -> None:
    """Handle card name input for creation."""
    # Extract card info using LLM
    from app.telegram_bot import _extract_card_info

    info = _extract_card_info(text, "credito")
    card_name = info.get("card_name", text.strip())
    bank = info.get("bank", "")

    # Check for duplicates
    db = SessionLocal()
    try:
        existing = (
            db.query(Card)
            .filter(
                Card.user_id == user_id,
                Card.card_name_hmac == compute_hmac(card_name.lower()),
                Card.bank_hmac == compute_hmac(bank.lower()),
            )
            .first()
        )

        if existing:
            await _confirm_with_card(
                phone,
                phone_hash,
                existing,
                session.get("data", {}).get("parsed", {}),
                session,
                user_id,
            )
            return

        # Create card
        card = Card(
            card_name=card_name,
            card_name_hmac=compute_hmac(card_name.lower()),
            bank=bank,
            bank_hmac=compute_hmac(bank.lower()),
            card_type="credito",
            user_id=user_id,
        )
        db.add(card)
        db.commit()
        db.refresh(card)

        await _confirm_with_card(
            phone,
            phone_hash,
            card,
            session.get("data", {}).get("parsed", {}),
            session,
            user_id,
        )
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Save expense
# ---------------------------------------------------------------------------


async def _do_save_expense(phone: str, phone_hash: str, session: dict, user_id: int) -> None:
    """Save the expense from session data."""
    data = session.get("data", {})
    parsed = data.get("parsed")
    if not parsed:
        await send_text(phone, "❌ No hay gasto para guardar.")
        _clear_session(phone_hash)
        return

    payment_label = data.get("payment_label", "")
    method = data.get("payment_method", "")
    person = data.get("tg_user", "")
    installment_total = data.get("installment_total")
    installment_group_id = data.get("installment_group_id")
    predicted_category_id = data.get("predicted_category_id")

    db = SessionLocal()
    try:
        if method == "tarjeta":
            expense = _save_expense(
                parsed,
                payment=data.get("card_selected", ""),
                person=person,
                bank=data.get("card_bank", ""),
                card=data.get("card_selected", ""),
                user_id=user_id,
                installment_total=installment_total,
                installment_group_id=installment_group_id,
                predicted_category_id=predicted_category_id,
                card_id=data.get("card_id"),
            )
        elif method == "efectivo_transferencia":
            expense = _save_expense(
                parsed,
                payment=payment_label,
                person=person,
                user_id=user_id,
                predicted_category_id=predicted_category_id,
                account_id=data.get("account_id"),
            )
        else:
            expense = _save_expense(
                parsed,
                payment=payment_label,
                person=person,
                user_id=user_id,
                predicted_category_id=predicted_category_id,
            )

        # Create ScheduledExpenses for future installments
        if installment_total and installment_group_id and installment_total >= 2:
            from app.models import ScheduledExpense
            from app.services.date_utils import add_months

            for i in range(2, installment_total + 1):
                scheduled = ScheduledExpense(
                    installment_group_id=installment_group_id,
                    installment_number=i,
                    installment_total=installment_total,
                    scheduled_date=add_months(expense.date, i - 1),
                    amount=expense.amount,
                    currency=expense.currency,
                    description=expense.description,
                    description_hmac=compute_hmac(expense.description),
                    card_id=expense.card_id,
                    account_id=expense.account_id,
                    category_id=expense.category_id,
                    status="PENDING",
                    user_id=user_id,
                )
                db.add(scheduled)
            db.commit()

        saved_text = _saved_text_wa(expense, payment_label)
        await send_text(phone, saved_text)
    except Exception as e:
        logger.error("[WA] save expense error: %s", e)
        await send_text(phone, "❌ Error al guardar el gasto. Intentá de nuevo.")
    finally:
        db.close()

    _clear_session(phone_hash)


# ---------------------------------------------------------------------------
# Help text
# ---------------------------------------------------------------------------


async def _send_help(phone: str) -> None:
    """Send help text."""
    await send_text(
        phone,
        "📝 *Así registrás tus gastos:*\n\n"
        "Escribime de forma natural:\n"
        '• "farmacity 3200"\n'
        '• "almuerzo con el equipo 8500 pesos"\n'
        '• "uber ayer 1800"\n'
        '• "Netflix USD 5"\n\n'
        "🔔 *O reenviame notificaciones de tu banco:*\n"
        '• "Compra aprobada Visa ****4521 $15.200 Supermercado"\n'
        '• "Débito Mastercard ****1234 $8.500 Netflix"\n\n'
        "Si detecto los datos de tu tarjeta, te muestro todo junto para confirmar.\n\n"
        "📌 *Comandos:*\n"
        "• *ayuda* — Mostrar esta ayuda\n"
        "• *sí* / *no* — Confirmar o cancelar un gasto",
    )


# ---------------------------------------------------------------------------
# Async wrappers for blocking functions
# ---------------------------------------------------------------------------


async def _parse_expense_async(text: str) -> dict | None:
    """Async wrapper for _parse_expense."""
    import asyncio

    return await asyncio.to_thread(_parse_expense, text)
