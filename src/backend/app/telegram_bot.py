import asyncio
import json
import logging
import os
import re
import unicodedata
import uuid
from datetime import datetime
from zoneinfo import ZoneInfo

BUE = ZoneInfo("America/Argentina/Buenos_Aires")

import telegram
from google import genai
from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import (
    Application,
    CallbackQueryHandler,
    CommandHandler,
    ContextTypes,
    ConversationHandler,
    MessageHandler,
    filters,
)

from app.database import SessionLocal
from app.models import Account, Card, Category, Expense, User
from app.prompts import CARD_EXTRACT_PROMPT, EXPENSE_PARSE_PROMPT
from app.services.categorization import auto_categorize, llm_categorize
from app.services.encryption import compute_hmac
from app.services.import_utils import _normalize_text

logger = logging.getLogger(__name__)

APP_ENV = os.getenv("APP_ENV", "development")
DEBUG_CAT = APP_ENV != "production" or os.getenv("DEBUG_CATEGORIZATION") == "1"

# Module-level bot app reference for proactive messaging from web
_bot_app: Application | None = None

WAITING_AUTH = 0
WAITING_PAYMENT = 1
WAITING_CARD_BANK = 2
WAITING_CARD_TYPE = 3
WAITING_CONFIRM = 4
WAITING_CARD_MANUAL = 5
WAITING_INSTALLMENT_QUESTION = 6
WAITING_INSTALLMENT_NUMBER = 7
WAITING_ACCOUNT_SELECT = 8
WAITING_ACCOUNT_CREATE_NAME = 9
WAITING_ACCOUNT_CREATE_TYPE = 10
WAITING_CARD_CREATE_CHOICE = 11
WAITING_CARD_CREATE_TYPE = 12
WAITING_CARD_CREATE_NAME = 13
WAITING_CARD_CREATE_CONFIRM = 14
WAITING_EVENT_CONFIRM = 15


def _gemini_client() -> genai.Client:
    return genai.Client(api_key=os.getenv("MESSAGES_BOT_LLM_API_KEY", ""))


def _parse_expense(text: str) -> dict | None:
    today = datetime.now(BUE).date().strftime("%Y-%m-%d")
    prompt = EXPENSE_PARSE_PROMPT.format(today=today) + f"\n\nMensaje: {text}"
    logger.debug(f"[PARSE] Prompt:\n{prompt}")
    try:
        client = _gemini_client()
        response = client.models.generate_content(
            model=os.getenv("LLM_MODEL_NAME", "gemini-flash-latest"),
            contents=prompt,
        )
        raw = response.text.strip()
        logger.debug(f"[PARSE] Raw response: {raw}")
        # Strip markdown code fences if present
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        result = json.loads(raw.strip())
        logger.info("Gemini parsed result: %s", result)
        return result
    except Exception as e:
        logger.error("Gemini parse error: %s", e)
        logger.debug(f"[PARSE] Failed text input: {text}")
        return None


def _extract_card_info(raw_input: str, card_type: str) -> dict:
    """Extract card_name and bank from user input using LLM."""
    prompt = CARD_EXTRACT_PROMPT.format(raw_input=raw_input, card_type=card_type)
    api_key = os.getenv("LLM_API_KEY")
    if not api_key:
        return {"card_name": raw_input, "bank": ""}

    try:
        client = genai.Client(api_key=api_key)
        response = client.models.generate_content(
            model=os.getenv("LLM_MODEL_NAME", "gemini-flash-latest"),
            contents=prompt,
        )
        raw = response.text.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        result = json.loads(raw.strip())
        logger.info("Card extract result: %s", result)
        return result
    except Exception as e:
        logger.error("Card extract error: %s", e)
        return {"card_name": raw_input, "bank": ""}


# ─── Bank notification detection ──────────────────────────────────────────────

BANK_NOTIFICATION_PATTERNS = [
    r"compra\s+(aprobada|confirmada|registrada)",
    r"d[eé]bito\s+(aprobado|confirmado|registrado|autom[aá]tico)",
    r"d[eé]bito\s+en\s+cuenta",
    r"consumo\s+(aprobado|confirmado|registrado)",
    r"tarjeta\s+(terminada|\*{4}|\d{4})",
    r"visa\s+terminada",
    r"mastercard\s+terminada",
    r"naranja\s+terminada",
    r"cr[eé]dito\s+(aprobado|confirmado|registrado)",
    r"transferencia\s+(saliente|enviada|realizada)",
    r"extracci[oó]n\s+(cajero|autom[aá]tico)",
]


def _is_bank_notification(text: str) -> bool:
    """Detect if a message looks like a bank notification (not natural language)."""
    lower = text.lower()
    return any(re.search(p, lower) for p in BANK_NOTIFICATION_PATTERNS)


CARD_NAME_PATTERNS = [
    r"\b(visa\s+(?:d[eé]bito|credito|cr[eé]dito))\b",
    r"\b(mastercard\s+(?:d[eé]bito|credito|cr[eé]dito))\b",
    r"\b(visa|mastercard|naranja|amex|cabal|cmr|cordobesa|tarjeta naranja)\b",
]
BANK_NAME_PATTERNS = [
    r"\b(galicia|santander|bbva|hsbc|macro|banco nacion|banco provincia|"
    r"ciudad|superville|bind|brubank|ualabu| Mercado Pago|merpago|"
    r"rei|patagonia|comafi|hipotecario|sucursal central|banco web)\b",
]


def _strip_accents(s: str) -> str:
    """Strip accents from text for accent-insensitive matching."""
    nfkd = unicodedata.normalize("NFKD", s.lower().strip())
    return "".join(c for c in nfkd if not unicodedata.combining(c))


def _extract_card_from_text(text: str) -> tuple[str | None, str | None, str | None]:
    """Try to extract card_name, bank, and card_type from natural language text."""
    lower = text.lower()
    card_name = None
    bank = None
    card_type = None
    for p in CARD_NAME_PATTERNS:
        m = re.search(p, lower)
        if m:
            card_name = m.group(1).title()
            break
    for p in BANK_NAME_PATTERNS:
        m = re.search(p, lower)
        if m:
            bank = m.group(1).title()
            break
    # Extract card type (debito/credito) from the text
    if re.search(r"\bd[eé]bito\b", lower):
        card_type = "debito"
    elif re.search(r"\bcredito|cr[eé]dito\b", lower):
        card_type = "credito"
    return card_name, bank, card_type


ACCOUNT_TYPE_KEYWORDS = {
    "efectivo": ["efectivo", "cash"],
    "mercadopago": ["mercadopago", "mercado pago", "mp", "merpago"],
    "cuenta_corriente": ["cuenta corriente", "c/c"],
    "caja_ahorro": ["caja de ahorro", "caja ahorro", "c/a"],
}


def _match_account_from_text(text: str, user_id: int, db) -> "Account | None":
    """Try to match an account from natural language text."""
    lower = text.lower()

    # Try to match by account type keywords
    for acct_type, keywords in ACCOUNT_TYPE_KEYWORDS.items():
        for kw in keywords:
            if kw in lower:
                account = (
                    db.query(Account)
                    .filter(
                        Account.user_id == user_id,
                        Account.type == acct_type,
                    )
                    .first()
                )
                if account:
                    return account

    # Try to match by account name (exact substring match)
    accounts = db.query(Account).filter(Account.user_id == user_id).all()
    for account in accounts:
        if account.name and account.name.lower() in lower:
            return account

    return None


def _parse_bank_notification(text: str) -> dict | None:
    """Parse a bank notification using LLM to extract structured data."""
    from app.prompts import BANK_NOTIFICATION_PARSE_PROMPT

    today = datetime.now(BUE).date().strftime("%Y-%m-%d")
    prompt = BANK_NOTIFICATION_PARSE_PROMPT.format(today=today) + f"\n\nNotificación: {text}"

    try:
        logger.info("[BANK_PARSE] Parsing bank notification: %s", text[:100])
        client = _gemini_client()
        response = client.models.generate_content(
            model=os.getenv("LLM_MODEL_NAME", "gemini-flash-latest"), contents=prompt
        )
        raw = response.text.strip()
        if "```" in raw:
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
            raw = raw.strip()
        result = json.loads(raw)
        logger.info("[BANK_PARSE] LLM result: %s", result)

        # Strip payment entity prefixes from description (e.g., "MERPAGO*BABYPOP" -> "BABYPOP")
        if result and result.get("description"):
            original = result["description"]
            result["description"] = _strip_payment_prefix(result["description"])
            if original != result["description"]:
                logger.info(
                    "[BANK_PARSE] Stripped prefix: '%s' -> '%s'", original, result["description"]
                )

        # Extract card_last4 from notification text if LLM didn't provide it
        if result and not result.get("card_last4"):
            last4_match = re.search(
                r"(?:terminada?\s+en|\*{4}|\*{2})\s*(\d{4})", text, re.IGNORECASE
            )
            if not last4_match:
                last4_match = re.search(r"\*{4}(\d{4})", text)
            if last4_match:
                result["card_last4"] = last4_match.group(1)
                logger.info("[BANK_PARSE] Extracted card_last4 from text: %s", result["card_last4"])

        return result
    except Exception as e:
        logger.error("Bank notification parse error: %s", e)
        return None


def _match_card_from_notification(
    user_id: int,
    bank: str | None,
    card_type: str | None,
    card_name: str | None,
    db,
) -> Card | None:
    """Match a bank notification to an existing card in DB.

    Matching priority:
      Pass 1: card_name + bank (ignore card_type) — card_name is the most reliable identifier
      Pass 2: bank + card_type (fallback when card_name doesn't match)
      Pass 3: card_type only (last resort — auto-select if single card of that type)
    """
    cards = db.query(Card).filter(Card.user_id == user_id).all()
    if not cards:
        return None

    target_type = card_type or "credito"

    # Pass 1: match by card_name + bank (ignore card_type)
    # card_name is the most reliable identifier — the LLM often gets card_type wrong
    if card_name:
        matches = []
        for card in cards:
            if bank and card.bank and card.bank.lower() != bank.lower():
                continue
            card_lower = _strip_accents(card.card_name)
            name_lower = _strip_accents(card_name)
            if name_lower in card_lower or card_lower in name_lower:
                matches.append(card)

        if len(matches) == 1:
            logger.debug(
                "[CARD_MATCH] Pass 1 (card_name+bank): matched %s",
                matches[0].card_name,
            )
            return matches[0]
        elif len(matches) > 1:
            # Disambiguate by card_type when multiple cards match
            for card in matches:
                if card.card_type == target_type:
                    logger.debug(
                        "[CARD_MATCH] Pass 1 (card_name+bank+type): matched %s",
                        card.card_name,
                    )
                    return card
            logger.debug(
                "[CARD_MATCH] Pass 1 (card_name+bank): multiple matches, returning first: %s",
                matches[0].card_name,
            )
            return matches[0]

    # Pass 2: match by bank + card_type (ignore card_name)
    for card in cards:
        if card.card_type != target_type:
            continue
        if bank and card.bank and card.bank.lower() == bank.lower():
            logger.debug(
                "[CARD_MATCH] Pass 2 (bank+type): matched %s",
                card.card_name,
            )
            return card

    # Pass 3: match by card_type only — if only one card of that type, auto-select
    type_cards = [c for c in cards if c.card_type == target_type]
    if len(type_cards) == 1:
        logger.debug(
            "[CARD_MATCH] Pass 3 (type only): matched %s",
            type_cards[0].card_name,
        )
        return type_cards[0]

    logger.debug(
        "[CARD_MATCH] No match found. card_name=%s, bank=%s, card_type=%s",
        card_name,
        bank,
        card_type,
    )
    return None


def _get_accounts(user_id: int) -> list[dict]:
    """Returns list of account dicts for the authenticated user."""
    db = SessionLocal()
    try:
        accounts = db.query(Account).filter(Account.user_id == user_id).all()
        return [{"id": a.id, "name": a.name, "type": a.type} for a in accounts]
    finally:
        db.close()


def _get_card_options(user_id: int) -> dict:
    """Returns {bank: [card_name, ...]} from Card table for the authenticated user."""
    db = SessionLocal()
    try:
        cards = db.query(Card).filter(Card.user_id == user_id).all()
        result: dict = {}
        for card in cards:
            bank = card.bank or "Sin banco"
            result.setdefault(bank, []).append(card.card_name)
        return {b: sorted(cards) for b, cards in result.items()}
    finally:
        db.close()


def _save_expense(
    parsed: dict,
    payment: str,
    person: str,
    bank: str = "",
    card: str = "",
    user_id: int | None = None,
    installment_total: int | None = None,
    installment_group_id: str | None = None,
    predicted_category_id: int | None = None,
    account_id: int | None = None,
    card_id: int | None = None,
) -> Expense:
    db = SessionLocal()
    try:
        if predicted_category_id is not None:
            category_id = predicted_category_id
        else:
            cats = db.query(Category).all()
            category_id = auto_categorize(parsed.get("description", ""), cats)

        raw_date = parsed.get("date") or datetime.now(BUE).date().strftime("%Y-%m-%d")
        try:
            expense_date = datetime.strptime(raw_date, "%Y-%m-%d").date()
        except ValueError:
            expense_date = datetime.now(BUE).date()

        raw_amount = float(parsed.get("amount") or 0)
        if installment_total and installment_total >= 2:
            installment_amount = round(raw_amount / installment_total, 2)
        else:
            installment_amount = raw_amount

        expense = Expense(
            date=expense_date,
            description=_normalize_text(parsed.get("description", "")),
            description_hmac=compute_hmac(_normalize_text(parsed.get("description", ""))),
            amount=installment_amount,
            currency=parsed.get("currency", "ARS"),
            category_id=category_id,
            user_id=user_id,
            installment_number=1 if installment_total else None,
            installment_total=installment_total,
            installment_group_id=installment_group_id,
            account_id=account_id,
            card_id=card_id,
        )
        db.add(expense)
        db.commit()
        db.refresh(expense)

        # Link to recurring expense if matches
        from app.services.recurring_linker import link_to_recurring

        link_to_recurring(expense.id, expense.description, user_id, db)

        # Resolve up to 3 levels: cat → parent → grandparent
        expense._cat_levels = []
        if expense.category_id:
            cat = db.query(Category).filter(Category.id == expense.category_id).first()
            if cat:
                levels = [cat.name]
                node = cat
                while node.parent_id:
                    node = db.query(Category).filter(Category.id == node.parent_id).first()
                    if not node:
                        break
                    levels.append(node.name)
                expense._cat_levels = list(reversed(levels))

        return expense
    finally:
        db.close()


def _should_ask_installments(
    category_id: int | None, db, amount: float = 0, card_type: str = ""
) -> bool:
    """
    Returns True if category matches installment rules OR
    amount > 10000 on a credit card.
    """
    # Category-based check
    if category_id:
        category = db.query(Category).filter(Category.id == category_id).first()
        if category:
            if category.parent_id is None:
                if category.name in ("Viajes", "Educación", "Indumentaria"):
                    return True
            else:
                parent = db.query(Category).filter(Category.id == category.parent_id).first()
                if parent and parent.name in (
                    "Mantenimiento",
                    "Mobiliario",
                    "Viajes",
                    "Educación",
                    "Indumentaria",
                ):
                    return True

    # Amount + card type check
    return card_type == "credito" and amount > 10000


def _format_amount(amount: float, currency: str) -> str:
    if currency == "USD":
        return f"USD {amount:,.2f}"
    return f"${amount:,.0f}"


# Payment entity prefixes to strip from bank notification descriptions
_PAYMENT_PREFIXES = [
    "MERPAGO*",
    "MP*",
    "MERCADOPAGO*",
    "PAGO*MISCUENTAS*",
    "PAGO*",
    "DEB.CAJERO*",
    "DEBITO*",
    "DEB*",
    "COMPRA*",
]


def _strip_payment_prefix(description: str) -> str:
    """Strip payment entity prefixes from bank notification descriptions.

    Examples:
        "MERPAGO*BABYPOP" -> "BABYPOP"
        "MP*STARBUCKS" -> "STARBUCKS"
        "COMPRA*NOMBRE LOCAL" -> "NOMBRE LOCAL"
        "Uber Eats" -> "Uber Eats" (no change)
    """
    if not description:
        return description
    upper = description.upper().strip()
    for prefix in _PAYMENT_PREFIXES:
        if upper.startswith(prefix):
            cleaned = description[len(prefix) :].strip()
            if cleaned:
                return cleaned
    return description


_MONTHS_ES = [
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "octubre",
    "noviembre",
    "diciembre",
]


def _format_date_es(date_str: str) -> str:
    try:
        d = datetime.strptime(date_str, "%Y-%m-%d").date()
        return f"{d.day} de {_MONTHS_ES[d.month - 1]} de {d.year}"
    except ValueError:
        return date_str


def _build_cat_levels(category_id: int | None, db) -> list[str]:
    """Build category hierarchy list from category_id."""
    if not category_id:
        return []
    cat = db.query(Category).filter(Category.id == category_id).first()
    if not cat:
        return []
    levels = [cat.name]
    node = cat
    while node.parent_id:
        node = db.query(Category).filter(Category.id == node.parent_id).first()
        if not node:
            break
        levels.append(node.name)
    return list(reversed(levels))


def _confirm_text(
    parsed: dict,
    payment_label: str,
    cat_levels: list[str] = None,
    debug_info: str = "",
    installments: int | None = None,
) -> str:
    desc = _escape_html(parsed.get("description", ""))
    total_amount = parsed["amount"]
    currency = parsed.get("currency", "ARS")
    date_str = _format_date_es(parsed.get("date", datetime.now(BUE).date().strftime("%Y-%m-%d")))
    safe_label = _escape_html(payment_label)
    cat_tree = ""
    if cat_levels:
        indents = ["", "  └ ", "      └ "]
        for i, name in enumerate(cat_levels):
            indent = indents[i] if i < len(indents) else indents[-1]
            cat_tree += f"{indent}{_cat_emoji(name)} {name}\n"
    debug_line = f"\n<code>{debug_info}</code>" if debug_info else ""
    if installments and installments >= 2:
        per_cuota = round(total_amount / installments, 2)
        amount_line = (
            f"💰 {_format_amount(total_amount, currency)} → "
            f"{installments}× {_format_amount(per_cuota, currency)}"
        )
    else:
        amount_line = f"💰 {_format_amount(total_amount, currency)}"
    return (
        f"Esto es lo que voy a guardar:\n\n"
        f"🛒 <b>{desc}</b>\n"
        f"{amount_line}\n"
        f"📅 {date_str}\n"
        f"💳 {safe_label}\n"
        f"{cat_tree}"
        f"{debug_line}"
        f"\n¿Lo guardamos?"
    )


def _cat_debug_str(result: dict | None, description: str, categories: list) -> str:
    """Build debug info string for confirmation text when DEBUG_CATEGORIZATION=1."""
    if not DEBUG_CAT:
        return ""
    if result:
        parent = result.get("parent_name") or "?"
        return f"AI: {parent} > {result['category_name']} ({result['confidence']:.0%})"
    kw_id = auto_categorize(description, categories)
    if kw_id:
        cat = next((c for c in categories if c.id == kw_id), None)
        return f"KW: {cat.name}" if cat else "KW fallback"
    return "sin categoria"


def _instant_categorize(parsed: dict, user_id: int, db) -> tuple[int | None, list]:
    """Keyword-only categorization (instant). Returns (category_id, categories_list)."""
    cats = db.query(Category).filter(Category.user_id == user_id).all()
    cat_id = auto_categorize(parsed.get("description", ""), cats)
    return cat_id, cats


async def _enhance_with_llm(
    chat_id: int,
    message_id: int | None,
    parsed: dict,
    user_id: int,
    cats: list,
    current_cat_id: int | None,
    payment_label: str,
    context,
):
    """Run LLM in background thread, update confirmation message if better category found."""
    if not message_id:
        return  # Can't edit message without message_id (new messages from bank notification)
    try:
        result = await asyncio.to_thread(
            llm_categorize,
            parsed.get("description", ""),
            parsed.get("amount"),
            cats,
            user_id,
            SessionLocal(),
        )
        if not result or result["category_id"] == current_cat_id:
            return

        # Update stored data so _save_expense uses the better category
        context.user_data["predicted_category_id"] = result["category_id"]
        context.user_data["llm_result"] = result
        context.user_data["cat_debug"] = _cat_debug_str(result, parsed.get("description", ""), cats)

        cat_levels = _build_cat_levels(result["category_id"], SessionLocal())
        confirm_keyboard = [
            [
                InlineKeyboardButton("✅ Sí, guardar", callback_data="confirm:yes"),
                InlineKeyboardButton("❌ Cancelar", callback_data="confirm:no"),
            ]
        ]
        await _bot_app.bot.edit_message_text(
            _confirm_text(
                parsed,
                payment_label,
                cat_levels,
                context.user_data.get("cat_debug", ""),
                context.user_data.get("installment_total"),
            ),
            chat_id=chat_id,
            message_id=message_id,
            parse_mode="HTML",
            reply_markup=InlineKeyboardMarkup(confirm_keyboard),
        )
    except Exception:
        pass  # Message already edited by user confirming, or Telegram error


_CAT_EMOJI: dict[str, str] = {
    # Categorías raíz
    "salud": "🏥",
    "alimentación": "🍽️",
    "alimentos": "🍽️",
    "supermercado": "🛒",
    "transporte": "🚗",
    "servicios": "⚡",
    "entretenimiento": "🎬",
    "educación": "📚",
    "ropa": "👕",
    "indumentaria": "👕",
    "viajes": "✈️",
    "hogar": "🏠",
    "tecnología": "💻",
    "mascotas": "🐾",
    "deporte": "🏋️",
    "inversiones": "📈",
    "impuestos": "🧾",
    "seguros": "🛡️",
    "banco": "🏦",
    "suscripciones": "📲",
    # Subcategorías
    "farmacia": "💊",
    "médico": "🩺",
    "médicos": "🩺",
    "taxi": "🚕",
    "uber": "🚕",
    "combustible": "⛽",
    "nafta": "⛽",
    "restaurante": "🍴",
    "café": "☕",
    "cafetería": "☕",
    "bar": "🍺",
    "fast food": "🍔",
    "netflix": "📺",
    "spotify": "🎵",
    "streaming": "📺",
    "gimnasio": "🏋️",
    "librería": "📖",
    "colegio": "🏫",
    "universidad": "🎓",
    "luz": "💡",
    "gas": "🔥",
    "agua": "💧",
    "internet": "🌐",
    "celular": "📱",
    "supermercados": "🛒",
    "almacén": "🛒",
    "verdulería": "🥦",
}


def _escape_html(text: str) -> str:
    """Escape HTML special characters for Telegram."""
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


async def _reply_html(update, text: str, **kwargs):
    """Reply with HTML, fallback to plain text on error."""
    import re as _re

    try:
        await update.message.reply_text(text, parse_mode="HTML", **kwargs)
    except telegram.error.BadRequest as e:
        logger.warning(f"[TELEGRAM] HTML parse failed, retrying as plain text: {e}")
        plain = _re.sub(r"<[^>]+>", "", text)
        await update.message.reply_text(plain, **kwargs)


async def _edit_html(query, text: str, **kwargs):
    """Edit message with HTML, fallback to plain text on error."""
    import re as _re

    try:
        await query.edit_message_text(text, parse_mode="HTML", **kwargs)
    except telegram.error.BadRequest as e:
        logger.warning(f"[TELEGRAM] HTML parse failed, retrying as plain text: {e}")
        plain = _re.sub(r"<[^>]+>", "", text)
        await query.edit_message_text(plain, **kwargs)


def _cat_emoji(name: str) -> str:
    return _CAT_EMOJI.get(name.lower(), "📂")


def _saved_text(expense: "Expense", payment_label: str) -> str:
    amount_str = _format_amount(expense.amount, expense.currency)
    date_str = _format_date_es(expense.date.strftime("%Y-%m-%d"))
    safe_label = _escape_html(payment_label)
    levels = getattr(expense, "_cat_levels", [])

    # Build category tree with emojis; description is always the leaf with 📝
    indents = ["", "  └ ", "      └ "]
    tree_lines = []
    for i, name in enumerate(levels):
        indent = indents[i] if i < len(indents) else indents[-1]
        tree_lines.append(f"{indent}{_cat_emoji(name)} {name}")
    # Description as final leaf
    leaf_indent = indents[min(len(levels), len(indents) - 1)]
    tree_lines.append(f"{leaf_indent}📝 {_escape_html(expense.description)}")
    cat_tree = "\n".join(tree_lines)

    installment_info = ""
    if expense.installment_total and expense.installment_total >= 2:
        total = round(expense.amount * expense.installment_total, 2)
        installment_info = (
            f"\n💳 {_escape_html(payment_label)} — {expense.installment_total} cuotas\n"
            f"💰 {_format_amount(total, expense.currency)} → "
            f"{expense.installment_total}× {amount_str}"
        )

    return (
        f"✅ ¡Listo! Guardé el gasto.\n\n"
        f"💰 {amount_str}\n"
        f"💳 {safe_label}\n"
        f"📅 {date_str}\n\n"
        f"{cat_tree}"
        f"{installment_info}"
    )


def _get_user_by_chat_id(chat_id: str) -> User | None:
    db = SessionLocal()
    try:
        from app.services.encryption import compute_hmac

        chat_hash = compute_hmac(chat_id)
        return db.query(User).filter(User.telegram_chat_hash == chat_hash).first()
    finally:
        db.close()


async def _validate_session(update: Update, context: ContextTypes.DEFAULT_TYPE) -> bool:
    """Validate that the user's session is still active. Returns True if valid."""
    chat_id = str(update.effective_chat.id)
    user = _get_user_by_chat_id(chat_id)
    if not user or user.id != context.user_data.get("user_id"):
        query = update.callback_query
        await query.answer()
        await query.edit_message_text(
            "🔒 Tu sesión fue desconectada desde la web.\nUsá /start para reconectarte."
        )
        return False
    return True


def send_disconnect_notification(chat_id: str) -> None:
    """Send a disconnect notification to a Telegram chat. Safe to call from any thread."""

    if not _bot_app or not _bot_app.bot:
        logger.warning("[TELEGRAM] Bot app not available, cannot send disconnect notification")
        return

    async def _send():
        try:
            await _bot_app.bot.send_message(
                chat_id=chat_id,
                text="🔒 Tu sesión fue desconectada desde la web.\nUsá /start para reconectarte.",
            )
        except Exception as e:
            logger.warning(f"[TELEGRAM] Could not send disconnect notification: {e}")

    loop = _bot_app.bot._local._loop if hasattr(_bot_app.bot, "_local") else None
    if loop and loop.is_running():
        asyncio.run_coroutine_threadsafe(_send(), loop)
    else:
        logger.warning("[TELEGRAM] Bot event loop not available")


def send_message_to_chat(chat_id: str, text: str) -> None:
    """Send an arbitrary message to a Telegram chat. Safe to call from any thread."""
    if not _bot_app or not _bot_app.bot:
        logger.warning("[TELEGRAM] Bot app not available, cannot send message")
        return

    async def _send():
        try:
            await _bot_app.bot.send_message(chat_id=chat_id, text=text, parse_mode="HTML")
        except Exception as e:
            logger.warning(f"[TELEGRAM] Could not send message to {chat_id}: {e}")

    loop = _bot_app.bot._local._loop if hasattr(_bot_app.bot, "_local") else None
    if loop and loop.is_running():
        asyncio.run_coroutine_threadsafe(_send(), loop)
    else:
        logger.warning("[TELEGRAM] Bot event loop not available")


def send_photo_to_chat(chat_id: str, image_bytes: bytes, caption: str = None) -> bool:
    """Send an image to a Telegram chat. Returns True on success."""
    # Try using bot instance first
    if _bot_app and _bot_app.bot:

        async def _send():
            try:
                from io import BytesIO

                photo = BytesIO(image_bytes)
                photo.name = "report.png"
                await _bot_app.bot.send_photo(
                    chat_id=chat_id, photo=photo, caption=caption, parse_mode="HTML"
                )
                return True
            except Exception as e:
                logger.warning(f"[TELEGRAM] Could not send photo to {chat_id}: {e}")
                return False

        loop = _bot_app.bot._local._loop if hasattr(_bot_app.bot, "_local") else None
        if loop and loop.is_running():
            future = asyncio.run_coroutine_threadsafe(_send(), loop)
            try:
                return future.result(timeout=30)
            except Exception:
                return False

    # Fallback: use direct Telegram Bot API (for celery workers)
    return _send_photo_via_api(chat_id, image_bytes, caption)


def _send_photo_via_api(chat_id: str, image_bytes: bytes, caption: str = None) -> bool:
    """Send photo using direct Telegram Bot API HTTP call. Returns True on success."""
    import os

    token = os.getenv("TELEGRAM_BOT_TOKEN")
    if not token:
        logger.warning("[TELEGRAM] No bot token available, cannot send photo")
        return False

    try:
        from io import BytesIO

        import httpx

        url = f"https://api.telegram.org/bot{token}/sendPhoto"

        files = {"photo": ("report.png", BytesIO(image_bytes), "image/png")}
        data = {"chat_id": chat_id, "parse_mode": "HTML"}
        if caption:
            data["caption"] = caption[:1024]

        with httpx.Client(timeout=30) as client:
            resp = client.post(url, files=files, data=data)
            if resp.status_code != 200:
                logger.warning(f"[TELEGRAM] API error {resp.status_code}: {resp.text[:200]}")
                return False
            logger.info(f"[TELEGRAM] Photo sent to {chat_id}")
            return True
    except Exception as e:
        logger.warning(f"[TELEGRAM] Could not send photo via API to {chat_id}: {e}")
        return False


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    chat_id = str(update.effective_chat.id)
    db = SessionLocal()
    try:
        from app.services.encryption import compute_hmac

        chat_hash = compute_hmac(chat_id)
        user = db.query(User).filter(User.telegram_chat_hash == chat_hash).first()
        if user:
            await update.message.reply_text(
                f"¡Hola <b>{user.full_name}</b>! 👋 ¿Qué gastaste hoy?\n\n"
                "💡 Mandame un gasto o usá /ayuda para ver los comandos disponibles.",
                parse_mode="HTML",
            )
            return ConversationHandler.END
    finally:
        db.close()

    await update.message.reply_text(
        "👋 ¡Hola! Soy *NikoFin*, tu asistente de finanzas personales.\n\n"
        "¿Qué puedo hacer?\n"
        "• Registrá gastos con lenguaje natural\n"
        "• Te muestro resúmenes semanales y mensuales\n"
        "• Te aviso de suscripciones y vencimientos\n"
        "• Categorizo automáticamente con IA\n\n"
        "Para empezar, ingresá tu clave de 12 caracteres.\n"
        "La encontrás en la app → Configuración → Telegram Bot.",
        parse_mode="HTML",
    )
    return WAITING_AUTH


async def handle_auth(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    key = update.message.text.strip()
    chat_id = str(update.effective_chat.id)
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.telegram_key == key).first()
        if not user:
            await update.message.reply_text("Clave incorrecta. Intentá de nuevo.")
            return WAITING_AUTH
        user.telegram_chat_id = chat_id
        from app.services.encryption import compute_hmac

        user.telegram_chat_hash = compute_hmac(chat_id)
        user.telegram_key = None  # Invalidate key after use
        db.commit()
        db.refresh(user)
        await update.message.reply_text(
            f"🎉 ¡Listo, <b>{user.full_name}</b>! Tu cuenta está conectada.\n\n"
            "Mandame un gasto como le dirías a un amigo:\n"
            '• _"gasté 1500 en farmacity"_\n'
            '• _"uber 3200 ayer"_\n'
            '• _"Netflix USD 5"_\n\n'
            "📌 <b>Comandos disponibles:</b>\n"
            "/gastos — Ver gastos del mes\n"
            "/presupuesto — Ver presupuestos\n"
            "/suscripciones — Ver suscripciones\n"
            "/inversiones — Ver inversiones\n"
            "/cuotas — Ver cuotas pendientes\n"
            "/ayuda — Ver todos los comandos",
            parse_mode="HTML",
        )
        return ConversationHandler.END
    finally:
        db.close()


_HELP_TEXT = (
    "📝 <b>Así registrás tus gastos con NikoFin:</b>\n\n"
    "Escribime de forma natural:\n"
    '• <i>"farmacity 3200"</i>\n'
    '• <i>"almuerzo con el equipo 8500 pesos"</i>\n'
    '• <i>"uber ayer 1800"</i>\n'
    '• <i>"Netflix USD 5"</i>\n'
    '• <i>"cargué nafta 15000 el viernes"</i>\n\n'
    "🔔 <b>O reenviame notificaciones de tu banco:</b>\n"
    '• <i>"Compra aprobada Visa ****4521 $15.200 Supermercado"</i>\n'
    '• <i>"Débito Mastercard ****1234 $8.500 Netflix"</i>\n\n'
    "Si detecto los datos de tu tarjeta, te muestro todo junto para confirmar.\n\n"
    "📌 <b>Comandos disponibles:</b>\n"
    "/start — Iniciar o reconectar\n"
    "/gastos — Ver gastos del mes\n"
    "/presupuesto — Ver presupuestos\n"
    "/suscripciones — Ver suscripciones\n"
    "/inversiones — Ver inversiones\n"
    "/cuotas — Ver cuotas pendientes\n"
    "/cancelar — Cancelar operación actual\n"
    "/ayuda — Mostrar esta ayuda"
)

_UNRECOGNIZED_MESSAGES = [
    "No encontré un monto en tu mensaje. ¿Podés contarme qué gastaste y cuánto?",
    "Necesito al menos el monto para registrar el gasto. ¿Cuánto fue?",
    'No pude identificar el importe. Probá con algo como <i>"supermercado 4500"</i> o <i>"taxi 1200 ayer"</i>.',
    "Hmm, no entendí bien. ¿Podés decirme qué compraste y por cuánto?",
]


async def _handle_bank_notification(
    update: Update, context: ContextTypes.DEFAULT_TYPE, text: str
) -> int:
    """Handle a bank notification: parse, match card, show single confirmation."""
    parsed = await asyncio.to_thread(_parse_bank_notification, text)

    if not parsed or not parsed.get("amount"):
        await update.message.reply_text(
            "🔔 Notificación bancaria detectada pero no pude parsear el monto.\n"
            "¿Podés decirme cuánto fue?",
            parse_mode="HTML",
        )
        # Fall back to normal flow — store partial data
        fallback_parsed = await asyncio.to_thread(_parse_expense, text)
        if fallback_parsed and fallback_parsed.get("amount"):
            context.user_data["parsed"] = fallback_parsed
            context.user_data["tg_user"] = update.effective_user.full_name or ""
            keyboard = [
                [
                    InlineKeyboardButton(
                        "💵 Efectivo/Transferencia", callback_data="pay:efectivo_transferencia"
                    ),
                    InlineKeyboardButton("💳 Tarjeta", callback_data="pay:tarjeta"),
                ],
                [InlineKeyboardButton("❌ Cancelar", callback_data="cancel")],
            ]
            desc = _escape_html(fallback_parsed.get("description", ""))
            amount_str = _format_amount(
                fallback_parsed["amount"], fallback_parsed.get("currency", "ARS")
            )
            await update.message.reply_text(
                f"<b>{desc}</b> — {amount_str}\n\n¿Cómo pagaste?",
                parse_mode="HTML",
                reply_markup=InlineKeyboardMarkup(keyboard),
            )
            return WAITING_PAYMENT
        await update.message.reply_text(_HELP_TEXT, parse_mode="HTML")
        return ConversationHandler.END

    user_id = context.user_data["user_id"]
    db = SessionLocal()
    try:
        # Match card from notification
        card = _match_card_from_notification(
            user_id,
            parsed.get("bank"),
            parsed.get("card_type"),
            parsed.get("card_name"),
            db,
        )

        if not card:
            # For debit notifications, try matching an account as fallback
            if parsed.get("card_type") == "debito" and parsed.get("bank"):
                account = _match_account_from_text(parsed["bank"], user_id, db)
                if account:
                    context.user_data["parsed"] = parsed
                    context.user_data["account_id"] = account.id
                    context.user_data["payment_label"] = account.name
                    context.user_data["payment_method"] = "efectivo_transferencia"

                    predicted_category_id, cats = _instant_categorize(parsed, user_id, db)
                    context.user_data["predicted_category_id"] = predicted_category_id
                    context.user_data["cat_debug"] = ""

                    cat_levels = _build_cat_levels(predicted_category_id, db)
                    cat_tree = ""
                    if cat_levels:
                        indents = ["", "  └ ", "      └ "]
                        for i, name in enumerate(cat_levels):
                            indent = indents[i] if i < len(indents) else indents[-1]
                            cat_tree += f"{indent}{_cat_emoji(name)} {name}\n"

                    desc = _escape_html(parsed.get("description", ""))
                    amount_str = _format_amount(parsed["amount"], parsed.get("currency", "ARS"))
                    date_str = _format_date_es(
                        parsed.get("date", datetime.now(BUE).date().strftime("%Y-%m-%d"))
                    )
                    confirm_keyboard = [
                        [
                            InlineKeyboardButton("✅ Sí, guardar", callback_data="confirm:yes"),
                            InlineKeyboardButton("❌ Cancelar", callback_data="confirm:no"),
                        ]
                    ]
                    await update.message.reply_text(
                        f"🔔 <b>Notificación de débito detectada</b>\n\n"
                        f"🛒 <b>{desc}</b>\n"
                        f"💰 {amount_str}\n"
                        f"📅 {date_str}\n"
                        f"🏦 {account.name}\n"
                        f"{cat_tree}"
                        f"\n¿Lo guardamos?",
                        parse_mode="HTML",
                        reply_markup=InlineKeyboardMarkup(confirm_keyboard),
                    )
                    return WAITING_CONFIRM

            # Card not found — show notification info and fall back to normal flow
            desc = _escape_html(parsed.get("description", ""))
            amount_str = _format_amount(parsed["amount"], parsed.get("currency", "ARS"))
            card_info = f"••{parsed.get('card_last4', '????')}" if parsed.get("card_last4") else ""
            bank_info = parsed.get("bank", "")
            label = f"{bank_info} {card_info}".strip()

            await update.message.reply_text(
                f"🔔 Notificación bancaria detectada:\n\n"
                f"<b>{desc}</b> — {amount_str}\n"
                f"💳 {label}\n\n"
                f"No encontré esta tarjeta en tu cuenta.\n"
                f"Elegí el medio de pago:",
                parse_mode="HTML",
                reply_markup=InlineKeyboardMarkup(
                    [
                        [
                            InlineKeyboardButton(
                                "💵 Efectivo/Transferencia",
                                callback_data="pay:efectivo_transferencia",
                            ),
                            InlineKeyboardButton("💳 Tarjeta", callback_data="pay:tarjeta"),
                        ]
                    ]
                ),
            )
            # Store parsed data for the normal flow to continue
            context.user_data["parsed"] = parsed
            context.user_data["tg_user"] = update.effective_user.full_name or ""
            return WAITING_PAYMENT

        # Card matched — build single confirmation
        payment_label = f"{card.bank} {card.card_name}".strip() if card.bank else card.card_name
        context.user_data["parsed"] = parsed
        context.user_data["card_id"] = card.id
        context.user_data["card_selected"] = card.card_name
        context.user_data["card_bank"] = card.bank or ""
        context.user_data["payment_label"] = payment_label
        context.user_data["payment_method"] = "tarjeta"

        # Auto-categorize
        predicted_category_id, cats = _instant_categorize(parsed, user_id, db)
        context.user_data["predicted_category_id"] = predicted_category_id
        context.user_data["cat_debug"] = ""

        # Check if LLM already detected installments from the notification
        parsed_installment_total = parsed.get("installment_total")
        parsed_installment_number = parsed.get("installment_number")
        installment_info = ""

        if parsed_installment_total and parsed_installment_total >= 2:
            # LLM detected installments — auto-populate, skip question
            context.user_data["installment_total"] = parsed_installment_total
            context.user_data["installment_group_id"] = str(uuid.uuid4())
            installment_amount = round(parsed["amount"] / parsed_installment_total, 2)
            installment_info = (
                f"📋 Cuota {parsed_installment_number or 1} de {parsed_installment_total}\n"
                f"💰 Cuota: {_format_amount(installment_amount, parsed.get('currency', 'ARS'))}\n"
            )
        elif _should_ask_installments(
            predicted_category_id, db, parsed.get("amount", 0), card.card_type
        ):
            installment_keyboard = [
                [
                    InlineKeyboardButton("✅ Sí", callback_data="installment:yes"),
                    InlineKeyboardButton("❌ No", callback_data="installment:no"),
                ]
            ]
            await update.message.reply_text(
                "¿Lo pagaste en cuotas?",
                reply_markup=InlineKeyboardMarkup(installment_keyboard),
            )
            return WAITING_INSTALLMENT_QUESTION

        cat_levels = _build_cat_levels(predicted_category_id, db)
        cat_tree = ""
        if cat_levels:
            indents = ["", "  └ ", "      └ "]
            for i, name in enumerate(cat_levels):
                indent = indents[i] if i < len(indents) else indents[-1]
                cat_tree += f"{indent}{_cat_emoji(name)} {name}\n"

        desc = _escape_html(parsed.get("description", ""))
        amount_str = _format_amount(parsed["amount"], parsed.get("currency", "ARS"))
        date_str = _format_date_es(
            parsed.get("date", datetime.now(BUE).date().strftime("%Y-%m-%d"))
        )

        confirm_keyboard = [
            [
                InlineKeyboardButton("✅ Sí, guardar", callback_data="confirm:yes"),
                InlineKeyboardButton("❌ Cancelar", callback_data="confirm:no"),
            ]
        ]
        await update.message.reply_text(
            f"🔔 <b>Notificación bancaria detectada</b>\n\n"
            f"🛒 <b>{desc}</b>\n"
            f"💰 {amount_str}\n"
            f"📅 {date_str}\n"
            f"💳 {payment_label}\n"
            f"{installment_info}"
            f"{cat_tree}"
            f"\n¿Lo guardamos?",
            parse_mode="HTML",
            reply_markup=InlineKeyboardMarkup(confirm_keyboard),
        )

        return WAITING_CONFIRM
    finally:
        db.close()


async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    chat_id = str(update.effective_chat.id)
    auth_user = _get_user_by_chat_id(chat_id)
    if not auth_user:
        await update.message.reply_text("Primero autenticate con /start.")
        return ConversationHandler.END
    context.user_data["user_id"] = auth_user.id

    text = update.message.text.strip()

    if "ayuda" in text.lower():
        await update.message.reply_text(_HELP_TEXT, parse_mode="HTML")
        return ConversationHandler.END

    # Circuit 1: Bank notification detection
    if _is_bank_notification(text):
        return await _handle_bank_notification(update, context, text)

    # Circuit 2: Normal flow (natural language)
    parsed = await asyncio.to_thread(_parse_expense, text)
    logger.debug(
        f"[PARSE] Parsed result: {parsed}, amount: {parsed.get('amount') if parsed else None}"
    )

    if not parsed or not parsed.get("amount"):
        # Show help text instead of generic error
        await update.message.reply_text(_HELP_TEXT, parse_mode="HTML")
        return ConversationHandler.END

    context.user_data["parsed"] = parsed
    context.user_data["tg_user"] = (
        update.effective_user.full_name or update.effective_user.username or ""
    )

    # Clean description: strip card/bank keywords Gemini might have included
    text_card_name, text_bank, text_card_type = _extract_card_from_text(text)
    if text_card_name and parsed.get("description"):
        desc = parsed["description"]
        # Remove card name and bank from description
        for word in [text_card_name, text_bank or ""]:
            if word:
                desc = re.sub(re.escape(word), "", desc, flags=re.IGNORECASE)
        # Also strip common card type words
        for word in ["credito", "crédito", "débito", "debito"]:
            desc = re.sub(rf"\b{word}\b", "", desc, flags=re.IGNORECASE)
        parsed["description"] = re.sub(r"\s+", " ", desc).strip()

    # Check if message contains card info (e.g. "visa santander verduleria 59999")
    if text_card_name:
        db = SessionLocal()
        try:
            user_id = context.user_data["user_id"]
            # Try to match a card from the user's cards
            cards = db.query(Card).filter(Card.user_id == user_id).all()
            matched_card = None
            for card in cards:
                card_lower = card.card_name.lower()
                text_lower = text_card_name.lower()
                name_match = (
                    card_lower == text_lower or text_lower in card_lower or card_lower in text_lower
                )
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
                # Card found — skip payment selection, go to confirmation
                payment_label = (
                    f"{matched_card.bank} {matched_card.card_name}".strip()
                    if matched_card.bank
                    else matched_card.card_name
                )
                context.user_data["card_id"] = matched_card.id
                context.user_data["card_selected"] = matched_card.card_name
                context.user_data["card_bank"] = matched_card.bank or ""
                context.user_data["payment_label"] = payment_label
                context.user_data["payment_method"] = "tarjeta"

                predicted_category_id, cats = _instant_categorize(parsed, user_id, db)
                context.user_data["predicted_category_id"] = predicted_category_id
                context.user_data["cat_debug"] = ""

                # Check installment requirement
                amount = parsed.get("amount", 0)
                if _should_ask_installments(
                    predicted_category_id, db, amount, matched_card.card_type
                ):
                    installment_keyboard = [
                        [
                            InlineKeyboardButton("✅ Sí", callback_data="installment:yes"),
                            InlineKeyboardButton("❌ No", callback_data="installment:no"),
                        ]
                    ]
                    await update.message.reply_text(
                        "¿Lo pagaste en cuotas?",
                        reply_markup=InlineKeyboardMarkup(installment_keyboard),
                    )
                    return WAITING_INSTALLMENT_QUESTION

                confirm_keyboard = [
                    [
                        InlineKeyboardButton("✅ Sí, guardar", callback_data="confirm:yes"),
                        InlineKeyboardButton("❌ Cancelar", callback_data="confirm:no"),
                    ]
                ]
                desc = _escape_html(parsed.get("description", ""))
                amount_str = _format_amount(parsed["amount"], parsed.get("currency", "ARS"))
                date_str = _format_date_es(
                    parsed.get("date", datetime.now(BUE).date().strftime("%Y-%m-%d"))
                )

                await update.message.reply_text(
                    f"🛒 <b>{desc}</b>\n"
                    f"💰 {amount_str}\n"
                    f"📅 {date_str}\n"
                    f"💳 {payment_label}\n"
                    f"\n¿Lo guardamos?",
                    parse_mode="HTML",
                    reply_markup=InlineKeyboardMarkup(confirm_keyboard),
                )
                return WAITING_CONFIRM
        finally:
            db.close()

    # Try account matching (e.g., "transferencia galicia", "efectivo", "mercado pago")
    db = SessionLocal()
    try:
        user_id = context.user_data["user_id"]
        matched_account = _match_account_from_text(text, user_id, db)
        if matched_account:
            context.user_data["account_id"] = matched_account.id
            context.user_data["payment_label"] = matched_account.name
            context.user_data["payment_method"] = "efectivo_transferencia"

            predicted_category_id, cats = _instant_categorize(parsed, user_id, db)
            context.user_data["predicted_category_id"] = predicted_category_id
            context.user_data["cat_debug"] = ""

            confirm_keyboard = [
                [
                    InlineKeyboardButton("✅ Sí, guardar", callback_data="confirm:yes"),
                    InlineKeyboardButton("❌ Cancelar", callback_data="confirm:no"),
                ]
            ]
            acct_desc = _escape_html(parsed.get("description", ""))
            acct_amount_str = _format_amount(parsed["amount"], parsed.get("currency", "ARS"))
            acct_date_str = _format_date_es(
                parsed.get("date", datetime.now(BUE).date().strftime("%Y-%m-%d"))
            )

            await update.message.reply_text(
                f"🛒 <b>{acct_desc}</b>\n"
                f"💰 {acct_amount_str}\n"
                f"📅 {acct_date_str}\n"
                f"🏦 {matched_account.name}\n"
                f"\n¿Lo guardamos?",
                parse_mode="HTML",
                reply_markup=InlineKeyboardMarkup(confirm_keyboard),
            )
            return WAITING_CONFIRM
    finally:
        db.close()

    desc = _escape_html(parsed.get("description", ""))
    amount_str = _format_amount(parsed["amount"], parsed.get("currency", "ARS"))
    date_str = parsed.get("date", datetime.now(BUE).date().strftime("%Y-%m-%d"))

    keyboard = [
        [
            InlineKeyboardButton(
                "💵 Efectivo/Transferencia", callback_data="pay:efectivo_transferencia"
            ),
            InlineKeyboardButton("💳 Tarjeta", callback_data="pay:tarjeta"),
        ],
        [InlineKeyboardButton("❌ Cancelar", callback_data="cancel")],
    ]
    await update.message.reply_text(
        f"<b>{desc}</b> — {amount_str} ({date_str})\n\n¿Cómo pagaste?",
        parse_mode="HTML",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )
    return WAITING_PAYMENT


async def handle_payment(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()

    if not await _validate_session(update, context):
        return ConversationHandler.END

    _, method = query.data.split(":", 1)
    context.user_data["payment_method"] = method

    if method == "efectivo_transferencia":
        # Show accounts list or prompt to create one
        user_id = context.user_data.get("user_id")
        accounts = _get_accounts(user_id) if user_id else []

        if not accounts:
            await query.edit_message_text(
                "🏦 *No tenés cuentas registradas*\n\n"
                "Para registrar gastos en efectivo o transferencia necesitás crear una cuenta primero.\n\n"
                "📝 *¿Qué nombre le ponemos a tu cuenta?*\n\n"
                "Ejemplos:\n"
                "• _Efectivo_ — para pagos en efectivo\n"
                "• _MercadoPago_ — billetera digital\n"
                "• _Cuenta Galicia_ — cuenta bancaria\n"
                "• _Cuenta USD_ — ahorros en dólares\n\n"
                "💡 Podés cambiar el nombre después desde la web.",
                parse_mode="HTML",
            )
            return WAITING_ACCOUNT_CREATE_NAME

        # Show accounts list
        keyboard = [
            [
                InlineKeyboardButton(
                    f"{acc['name']} ({acc['type']})", callback_data=f"account:{acc['id']}"
                )
            ]
            for acc in accounts
        ]
        keyboard.append(
            [InlineKeyboardButton("➕ Crear nueva cuenta", callback_data="account:new")]
        )
        keyboard.append([InlineKeyboardButton("❌ Cancelar", callback_data="cancel")])

        await query.edit_message_text(
            "💰 ¿Desde qué cuenta?",
            reply_markup=InlineKeyboardMarkup(keyboard),
        )
        return WAITING_ACCOUNT_SELECT

    # Tarjeta — show banks filtered by user
    user_id = context.user_data.get("user_id")
    card_options = _get_card_options(user_id) if user_id else {}
    context.user_data["card_options"] = card_options

    if not card_options:
        keyboard = [
            [InlineKeyboardButton("➕ Crear nueva tarjeta", callback_data="cardnew:new")],
            [InlineKeyboardButton("✏️ Ingresar nombre manualmente", callback_data="cardnew:manual")],
        ]
        await query.edit_message_text(
            "💳 *No tenés tarjetas registradas*\n\n¿Qué preferís?",
            parse_mode="HTML",
            reply_markup=InlineKeyboardMarkup(keyboard),
        )
        return WAITING_CARD_CREATE_CHOICE

    banks = sorted(card_options.keys())
    keyboard = [[InlineKeyboardButton(b, callback_data=f"bank:{b}")] for b in banks]
    keyboard.append([InlineKeyboardButton("❌ Cancelar", callback_data="cancel")])
    await query.edit_message_text("💳 ¿Qué banco?", reply_markup=InlineKeyboardMarkup(keyboard))
    return WAITING_CARD_BANK


async def handle_card_bank(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()

    if not await _validate_session(update, context):
        return ConversationHandler.END

    bank = query.data.split(":", 1)[1]
    context.user_data["card_bank"] = bank

    card_options = context.user_data.get("card_options", {})
    cards = card_options.get(bank, [])

    if not cards:
        await query.edit_message_text(
            f"No encontré tarjetas de {bank} registradas.\n"
            "¿Cómo se llama la tarjeta? Escribila, por ejemplo: _Visa_ o _Mastercard_.",
            parse_mode="HTML",
        )
        return WAITING_CARD_MANUAL

    keyboard = [[InlineKeyboardButton(card, callback_data=f"card:{card}")] for card in cards]
    keyboard.append([InlineKeyboardButton("❌ Cancelar", callback_data="cancel")])
    await query.edit_message_text("💳 ¿Qué tarjeta?", reply_markup=InlineKeyboardMarkup(keyboard))
    return WAITING_CARD_TYPE


async def handle_card_type(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()

    if not await _validate_session(update, context):
        return ConversationHandler.END

    parts = query.data.split(":", 1)
    card = parts[1]
    bank = context.user_data.get("card_bank", "")

    label = f"{bank} {card}"
    context.user_data["card_selected"] = card
    context.user_data["payment_label"] = label

    # Look up card_id from DB so the expense is linked to the card
    db_card = SessionLocal()
    try:
        all_cards = db_card.query(Card).filter(Card.user_id == context.user_data["user_id"]).all()
        card_obj = next(
            (
                c
                for c in all_cards
                if c.card_name
                and c.card_name.lower() == card.lower()
                and c.bank
                and c.bank.lower() == bank.lower()
            ),
            None,
        )
        if card_obj:
            context.user_data["card_id"] = card_obj.id
    finally:
        db_card.close()

    # Run early categorization to determine if we need to ask about installments
    parsed = context.user_data["parsed"]
    db = SessionLocal()
    try:
        predicted_category_id, cats = _instant_categorize(parsed, context.user_data["user_id"], db)
        context.user_data["predicted_category_id"] = predicted_category_id
        context.user_data["cat_debug"] = ""

        # Check if we should ask about installments
        card_type = card_obj.card_type if card_obj else ""
        amount = parsed.get("amount", 0) if parsed else 0
        if _should_ask_installments(predicted_category_id, db, amount, card_type):
            installment_keyboard = [
                [
                    InlineKeyboardButton("✅ Sí", callback_data="installment:yes"),
                    InlineKeyboardButton("❌ No", callback_data="installment:no"),
                ]
            ]
            await query.edit_message_text(
                "¿Lo pagaste en cuotas?",
                reply_markup=InlineKeyboardMarkup(installment_keyboard),
            )
            return WAITING_INSTALLMENT_QUESTION
        else:
            # No installments needed, go straight to confirmation
            cat_levels = _build_cat_levels(predicted_category_id, db)
            confirm_keyboard = [
                [
                    InlineKeyboardButton("✅ Sí, guardar", callback_data="confirm:yes"),
                    InlineKeyboardButton("❌ Cancelar", callback_data="confirm:no"),
                ]
            ]
            await query.edit_message_text(
                _confirm_text(parsed, label, cat_levels),
                parse_mode="HTML",
                reply_markup=InlineKeyboardMarkup(confirm_keyboard),
            )
            return WAITING_CONFIRM
    finally:
        db.close()


async def handle_installment_question(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle yes/no response to '¿Lo pagaste en cuotas?'"""
    query = update.callback_query
    await query.answer()

    if not await _validate_session(update, context):
        return ConversationHandler.END

    _, answer = query.data.split(":", 1)

    if answer == "no":
        # No installments, go to confirmation
        payment_label = context.user_data.get("payment_label", "")
        predicted_category_id = context.user_data.get("predicted_category_id")
        db = SessionLocal()
        try:
            cat_levels = _build_cat_levels(predicted_category_id, db)
        finally:
            db.close()
        confirm_keyboard = [
            [
                InlineKeyboardButton("✅ Sí, guardar", callback_data="confirm:yes"),
                InlineKeyboardButton("❌ Cancelar", callback_data="confirm:no"),
            ]
        ]
        await query.edit_message_text(
            _confirm_text(
                context.user_data["parsed"],
                payment_label,
                cat_levels,
                context.user_data.get("cat_debug", ""),
            ),
            parse_mode="HTML",
            reply_markup=InlineKeyboardMarkup(confirm_keyboard),
        )
        return WAITING_CONFIRM

    # answer == "yes" - ask for number of installments
    await query.edit_message_text("¿Cuántas cuotas? (Escribí un número entre 2 y 60)")
    return WAITING_INSTALLMENT_NUMBER


async def handle_installment_number(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle numeric input for installment count"""
    text = update.message.text.strip()

    # Validate input is a valid integer between 2-60
    try:
        installments = int(text)
        if installments < 2 or installments > 60:
            await update.message.reply_text("Por favor, ingresá un número entre 2 y 60.")
            return WAITING_INSTALLMENT_NUMBER
    except ValueError:
        await update.message.reply_text(
            "No entendí. Por favor, escribí un número (por ejemplo: 12)"
        )
        return WAITING_INSTALLMENT_NUMBER

    # Generate unique group ID for this installment series
    installment_group_id = str(uuid.uuid4())

    # Store installment data in context
    context.user_data["installment_total"] = installments
    context.user_data["installment_group_id"] = installment_group_id

    # Show confirmation
    payment_label = context.user_data.get("payment_label", "")
    predicted_category_id = context.user_data.get("predicted_category_id")
    db = SessionLocal()
    try:
        cat_levels = _build_cat_levels(predicted_category_id, db)
    finally:
        db.close()
    confirm_keyboard = [
        [
            InlineKeyboardButton("✅ Sí, guardar", callback_data="confirm:yes"),
            InlineKeyboardButton("❌ Cancelar", callback_data="confirm:no"),
        ]
    ]

    await update.message.reply_text(
        _confirm_text(
            context.user_data["parsed"],
            payment_label,
            cat_levels,
            context.user_data.get("cat_debug", ""),
            installments,
        ),
        parse_mode="HTML",
        reply_markup=InlineKeyboardMarkup(confirm_keyboard),
    )
    return WAITING_CONFIRM


async def handle_account_select(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle account selection or new account creation trigger"""
    query = update.callback_query
    await query.answer()

    if not await _validate_session(update, context):
        return ConversationHandler.END

    _, account_id = query.data.split(":", 1)

    if account_id == "new":
        await query.edit_message_text(
            "🏦 *Nueva Cuenta*\n\n"
            "📝 ¿Qué nombre le ponemos?\n\n"
            "Ejemplos:\n"
            "• _Efectivo_\n"
            "• _MercadoPago_\n"
            "• _Cuenta Galicia_\n"
            "• _Cuenta USD_\n\n"
            "💡 Podés editar el nombre después desde la web.",
            parse_mode="HTML",
        )
        return WAITING_ACCOUNT_CREATE_NAME

    # Load account info and categorize
    db = SessionLocal()
    try:
        account = (
            db.query(Account)
            .filter(
                Account.id == int(account_id),
                Account.user_id == context.user_data["user_id"],
            )
            .first()
        )
        if not account:
            await query.edit_message_text("Error: cuenta no encontrada.")
            return ConversationHandler.END

        context.user_data["account_id"] = account.id
        context.user_data["payment_label"] = f"{account.name} ({account.type})"

        # Instant keyword categorization
        parsed = context.user_data["parsed"]
        predicted_category_id, cats = _instant_categorize(parsed, context.user_data["user_id"], db)
        context.user_data["predicted_category_id"] = predicted_category_id
        context.user_data["cat_debug"] = ""
        cat_levels = _build_cat_levels(predicted_category_id, db)
    finally:
        db.close()

    # Show confirmation
    confirm_keyboard = [
        [
            InlineKeyboardButton("✅ Sí, guardar", callback_data="confirm:yes"),
            InlineKeyboardButton("❌ Cancelar", callback_data="confirm:no"),
        ]
    ]
    await query.edit_message_text(
        _confirm_text(context.user_data["parsed"], context.user_data["payment_label"], cat_levels),
        parse_mode="HTML",
        reply_markup=InlineKeyboardMarkup(confirm_keyboard),
    )
    return WAITING_CONFIRM


async def handle_account_create_name(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle new account name input"""
    account_name = update.message.text.strip()
    context.user_data["new_account_name"] = account_name

    # Ask for account type
    keyboard = [
        [InlineKeyboardButton("💵 Efectivo", callback_data="acctype:efectivo")],
        [InlineKeyboardButton("🏦 Cuenta Corriente", callback_data="acctype:cuenta_corriente")],
        [InlineKeyboardButton("💳 Caja de Ahorro", callback_data="acctype:caja_ahorro")],
        [InlineKeyboardButton("📱 MercadoPago / Billetera", callback_data="acctype:mercadopago")],
        [InlineKeyboardButton("💰 Otro", callback_data="acctype:otro")],
    ]
    await update.message.reply_text(
        f"✅ Perfecto, <b>{_escape_html(account_name)}</b>\n\nAhora elegí el tipo de cuenta:",
        parse_mode="HTML",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )
    return WAITING_ACCOUNT_CREATE_TYPE


async def handle_account_create_type(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle account type selection and create the account"""
    query = update.callback_query
    await query.answer()

    if not await _validate_session(update, context):
        return ConversationHandler.END

    _, account_type = query.data.split(":", 1)
    account_name = context.user_data.get("new_account_name", "Nueva cuenta")
    user_id = context.user_data.get("user_id")

    # Create account in DB
    db = SessionLocal()
    try:
        new_account = Account(
            name=account_name,
            name_hmac=compute_hmac(account_name.strip().lower()),
            type=account_type,
            user_id=user_id,
        )
        db.add(new_account)
        db.commit()
        db.refresh(new_account)

        context.user_data["account_id"] = new_account.id
        context.user_data["payment_label"] = f"{new_account.name} ({new_account.type})"

        # Instant keyword categorization
        parsed = context.user_data["parsed"]
        predicted_category_id, cats = _instant_categorize(parsed, context.user_data["user_id"], db)
        context.user_data["predicted_category_id"] = predicted_category_id
        context.user_data["cat_debug"] = ""
        cat_levels = _build_cat_levels(predicted_category_id, db)
    finally:
        db.close()

    # Show confirmation
    confirm_keyboard = [
        [
            InlineKeyboardButton("✅ Sí, guardar", callback_data="confirm:yes"),
            InlineKeyboardButton("❌ Cancelar", callback_data="confirm:no"),
        ]
    ]
    await query.edit_message_text(
        _confirm_text(context.user_data["parsed"], context.user_data["payment_label"], cat_levels),
        parse_mode="HTML",
        reply_markup=InlineKeyboardMarkup(confirm_keyboard),
    )
    return WAITING_CONFIRM


async def handle_card_create_choice(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Ask if user wants to create a new card when none exist"""
    query = update.callback_query
    await query.answer()

    _, choice = query.data.split(":", 1)

    if choice == "new":
        await query.edit_message_text(
            "💳 *Nueva Tarjeta*\n\nPrimero, elegí el tipo de tarjeta:",
            parse_mode="HTML",
            reply_markup=InlineKeyboardMarkup(
                [
                    [InlineKeyboardButton("💳 Crédito", callback_data="cardctype:credito")],
                    [InlineKeyboardButton("💰 Débito", callback_data="cardctype:debito")],
                ]
            ),
        )
        return WAITING_CARD_CREATE_TYPE

    return ConversationHandler.END


async def handle_card_create_type(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle card type selection and ask for card name"""
    query = update.callback_query
    await query.answer()

    _, card_type = query.data.split(":", 1)
    context.user_data["new_card_type"] = card_type

    await query.message.reply_text(
        "📝 *Datos de la tarjeta*\n\n"
        "Escribí los datos como los ves en tus gastos:\n\n"
        "Ejemplos:\n"
        "• _Visa Galicia_\n"
        "• _Mastercard HSBC_\n"
        "• _Naranja_\n"
        "• _Mercado Pago_\n\n"
        "💡 Puedo detectar automáticamente la franquicia y el banco.",
        parse_mode="HTML",
    )
    return WAITING_CARD_CREATE_NAME


async def handle_card_create_name(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle card name input, extract info with LLM, ask for confirmation"""
    raw_input = update.message.text.strip()
    card_type = context.user_data.get("new_card_type", "credito")

    db = SessionLocal()
    try:
        chat_id = str(update.effective_chat.id)
        from app.services.encryption import compute_hmac

        chat_hash = compute_hmac(chat_id)
        user = db.query(User).filter(User.telegram_chat_hash == chat_hash).first()
        user_full_name = user.full_name if user else ""
    finally:
        db.close()

    extracted = _extract_card_info(raw_input, card_type)
    card_name = extracted.get("card_name", raw_input)
    bank = extracted.get("bank", "")

    if user_full_name:
        if "," in user_full_name:
            parts = user_full_name.split(",")
            holder = parts[1].strip().split()[0] if len(parts) > 1 and parts[1].strip() else ""
        else:
            holder = user_full_name.split()[0] if user_full_name.split() else ""
    else:
        holder = ""

    context.user_data["new_card_name"] = card_name
    context.user_data["new_card_bank"] = bank
    context.user_data["new_card_holder"] = holder

    bank_display = bank if bank else "No detectado"

    await update.message.reply_text(
        "🔍 <b>Detectado</b>\n\n"
        f"💳 Tarjeta: <b>{_escape_html(card_name)}</b>\n"
        f"🏦 Banco: <b>{_escape_html(bank_display)}</b>\n"
        f"👤 Titular: <b>{_escape_html(holder)}</b>\n"
        f"💳 Tipo: <b>{_escape_html(card_type)}</b>\n\n"
        "¿Confirmás la creación de esta tarjeta?",
        parse_mode="HTML",
        reply_markup=InlineKeyboardMarkup(
            [
                [InlineKeyboardButton("✅ Sí, crear", callback_data="cardconfirm:yes")],
                [InlineKeyboardButton("❌ Cancelar", callback_data="cardconfirm:no")],
            ]
        ),
    )
    return WAITING_CARD_CREATE_CONFIRM


async def handle_card_create_confirm(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle card creation confirmation"""
    query = update.callback_query
    await query.answer()

    if not await _validate_session(update, context):
        return ConversationHandler.END

    _, action = query.data.split(":", 1)

    if action == "no":
        await query.message.reply_text("❌ Creación de tarjeta cancelada.")
        return ConversationHandler.END

    card_name = context.user_data.get("new_card_name", "")
    bank = context.user_data.get("new_card_bank", "")
    card_type = context.user_data.get("new_card_type", "credito")

    chat_id = str(update.effective_chat.id)
    db = SessionLocal()
    try:
        from app.services.encryption import compute_hmac

        chat_hash = compute_hmac(chat_id)
        user = db.query(User).filter(User.telegram_chat_hash == chat_hash).first()
        if not user:
            await query.message.reply_text("❌ Error: usuario no encontrado.")
            return ConversationHandler.END

        user_id = user.id
        user_full_name = user.full_name if user.full_name else ""

        if user_full_name:
            if "," in user_full_name:
                parts = user_full_name.split(",")
                holder = parts[1].strip().split()[0] if len(parts) > 1 and parts[1].strip() else ""
            else:
                holder = user_full_name.split()[0] if user_full_name.split() else ""
        else:
            holder = ""

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
            await query.message.reply_text(
                "❌ Ya existe una tarjeta con ese nombre y banco. Probá con otro nombre.",
                parse_mode="HTML",
            )
            return ConversationHandler.END

        new_card = Card(
            card_name=card_name,
            card_name_hmac=compute_hmac(card_name.lower()),
            bank=bank,
            bank_hmac=compute_hmac(bank.lower()),
            holder=holder,
            card_type=card_type,
            user_id=user_id,
        )
        db.add(new_card)
        db.commit()

        context.user_data["card_selected"] = card_name
        context.user_data["card_bank"] = bank
        context.user_data["payment_label"] = f"{bank} {card_name}".strip() if bank else card_name
        context.user_data["card_id"] = new_card.id

        parsed = context.user_data["parsed"]
        predicted_category_id, cats = _instant_categorize(parsed, context.user_data["user_id"], db)
        context.user_data["predicted_category_id"] = predicted_category_id
        context.user_data["cat_debug"] = ""

        if _should_ask_installments(
            predicted_category_id, db, parsed.get("amount", 0), new_card.card_type
        ):
            installment_keyboard = [
                [
                    InlineKeyboardButton("✅ Sí", callback_data="installment:yes"),
                    InlineKeyboardButton("❌ No", callback_data="installment:no"),
                ]
            ]
            await query.edit_message_text(
                f"✅ <b>Tarjeta {_escape_html(card_name)} creada!</b>\n\n¿Lo pagaste en cuotas?",
                parse_mode="HTML",
                reply_markup=InlineKeyboardMarkup(installment_keyboard),
            )
            return WAITING_INSTALLMENT_QUESTION
        else:
            cat_levels = _build_cat_levels(predicted_category_id, db)
            confirm_keyboard = [
                [
                    InlineKeyboardButton("✅ Sí, guardar", callback_data="confirm:yes"),
                    InlineKeyboardButton("❌ Cancelar", callback_data="confirm:no"),
                ]
            ]
            await query.edit_message_text(
                f"✅ <b>Tarjeta {_escape_html(card_name)} creada!</b>\n\n"
                + _confirm_text(parsed, context.user_data["payment_label"], cat_levels),
                parse_mode="HTML",
                reply_markup=InlineKeyboardMarkup(confirm_keyboard),
            )
            return WAITING_CONFIRM
    finally:
        db.close()


async def handle_confirm(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle expense confirmation - save or cancel"""
    query = update.callback_query
    await query.answer()

    if not await _validate_session(update, context):
        return ConversationHandler.END

    _, answer = query.data.split(":", 1)
    if answer == "no":
        await query.edit_message_text("Cancelado. Cuando quieras, mandame otro gasto.")
        return ConversationHandler.END

    parsed = context.user_data["parsed"]
    payment_label = context.user_data.get("payment_label", "")
    method = context.user_data.get("payment_method", "")
    user_id = context.user_data.get("user_id")
    person = context.user_data.get("tg_user", "")

    # Check for budget events BEFORE saving
    from app.models import BudgetEvent

    db = SessionLocal()
    expense_date = datetime.strptime(
        parsed.get("date", datetime.now(BUE).date().strftime("%Y-%m-%d")), "%Y-%m-%d"
    ).date()
    matching_events = (
        db.query(BudgetEvent)
        .filter(
            BudgetEvent.user_id == user_id,
            BudgetEvent.is_active == True,
            BudgetEvent.start_date <= expense_date,
            BudgetEvent.end_date >= expense_date,
        )
        .all()
    )

    linked_events = []
    if matching_events:
        predicted_category_id = context.user_data.get("predicted_category_id")
        for evt in matching_events:
            evt_cats = json.loads(evt.categories) if evt.categories else []
            cat_ids = [c.get("category_id") for c in evt_cats]
            if not cat_ids or (predicted_category_id and predicted_category_id in cat_ids):
                linked_events.append(evt)

    if linked_events:
        # Show event selection BEFORE saving
        context.user_data["pending_expense"] = {
            "parsed": parsed,
            "payment_label": payment_label,
            "method": method,
            "user_id": user_id,
            "person": person,
        }
        context.user_data["linked_events"] = [{"id": e.id, "name": e.name} for e in linked_events]

        keyboard = []
        for evt in linked_events:
            keyboard.append(
                [
                    InlineKeyboardButton(
                        f"📅 {evt.name} ({evt.start_date} — {evt.end_date})",
                        callback_data=f"event_link:{evt.id}",
                    )
                ]
            )
        keyboard.append([InlineKeyboardButton("❌ No vincular", callback_data="event_link:none")])

        await query.edit_message_text(
            _confirm_text(parsed, payment_label)
            + "\n\n📅 *¿Este gasto pertenece a un evento temporal?*",
            parse_mode="HTML",
            reply_markup=InlineKeyboardMarkup(keyboard),
        )
        return WAITING_EVENT_CONFIRM

    # No matching events — save directly
    try:
        expense = _save_expense_from_context(context, db)
        if expense:
            await query.edit_message_text(
                _saved_text(expense, payment_label),
                parse_mode="HTML",
            )
        else:
            await query.edit_message_text("Error al guardar el gasto.")

        context.user_data.pop("installment_total", None)
        context.user_data.pop("installment_group_id", None)
        context.user_data.pop("predicted_category_id", None)

        return ConversationHandler.END
    finally:
        db.close()


def _save_expense_from_context(context, db):
    """Save expense from context data."""
    parsed = context.user_data.get("pending_expense", {}).get("parsed") or context.user_data.get(
        "parsed"
    )
    payment_label = context.user_data.get("pending_expense", {}).get(
        "payment_label"
    ) or context.user_data.get("payment_label", "")
    method = context.user_data.get("pending_expense", {}).get("method") or context.user_data.get(
        "payment_method", ""
    )
    user_id = context.user_data.get("pending_expense", {}).get("user_id") or context.user_data.get(
        "user_id"
    )
    person = context.user_data.get("pending_expense", {}).get("person") or context.user_data.get(
        "tg_user", ""
    )
    installment_total = context.user_data.get("installment_total")
    installment_group_id = context.user_data.get("installment_group_id")
    predicted_category_id = context.user_data.get("predicted_category_id")

    if method == "tarjeta":
        card = context.user_data.get("card_selected", "")
        bank = context.user_data.get("card_bank", "")
        card_id = context.user_data.get("card_id")
        expense = _save_expense(
            parsed,
            payment=card,
            person=person,
            bank=bank,
            card=card,
            user_id=user_id,
            installment_total=installment_total,
            installment_group_id=installment_group_id,
            predicted_category_id=predicted_category_id,
            card_id=card_id,
        )
    elif method == "efectivo_transferencia":
        account_id = context.user_data.get("account_id")
        expense = _save_expense(
            parsed,
            payment=payment_label,
            person=person,
            user_id=user_id,
            predicted_category_id=predicted_category_id,
            account_id=account_id,
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

    return expense


async def handle_event_confirm(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle event linking confirmation, then save expense."""
    query = update.callback_query
    await query.answer()

    _, event_id_str = query.data.split(":", 1)
    pending_expense = context.user_data.get("pending_expense")
    payment_label = context.user_data.get("pending_expense", {}).get("payment_label", "")

    if not pending_expense:
        await query.edit_message_text("Error: no se encontró el gasto pendiente.")
        return ConversationHandler.END

    # Save the expense
    db = SessionLocal()
    try:
        expense = _save_expense_from_context(context, db)
        if not expense:
            await query.edit_message_text("Error al guardar el gasto.")
            return ConversationHandler.END

        # Link to event if selected
        if event_id_str != "none":
            from app.models import BudgetEvent

            event_id = int(event_id_str)
            event = db.query(BudgetEvent).filter(BudgetEvent.id == event_id).first()
            if event:
                expense.budget_event_id = event_id
                event.spent = (event.spent or 0) + abs(expense.amount)
                db.commit()
                await query.edit_message_text(
                    _saved_text(expense, payment_label) + f"\n\n📅 Vinculado a <b>{event.name}</b>",
                    parse_mode="HTML",
                )
            else:
                await query.edit_message_text(
                    _saved_text(expense, payment_label),
                    parse_mode="HTML",
                )
        else:
            await query.edit_message_text(
                _saved_text(expense, payment_label),
                parse_mode="HTML",
            )

        context.user_data.pop("pending_expense", None)
        context.user_data.pop("linked_events", None)
        context.user_data.pop("installment_total", None)
        context.user_data.pop("installment_group_id", None)
        context.user_data.pop("predicted_category_id", None)

        return ConversationHandler.END
    finally:
        db.close()


async def handle_card_manual(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    card_name = update.message.text.strip()
    bank = context.user_data.get("card_bank", "")
    label = f"{bank} {card_name}".strip() if bank else card_name
    context.user_data["card_selected"] = card_name
    context.user_data["payment_label"] = label

    # Look up card_id from DB if the card exists
    db_card = SessionLocal()
    try:
        all_cards = db_card.query(Card).filter(Card.user_id == context.user_data["user_id"]).all()
        card_obj = next(
            (
                c
                for c in all_cards
                if c.card_name
                and c.card_name.lower() == card_name.lower()
                and (not bank or (c.bank and c.bank.lower() == bank.lower()))
            ),
            None,
        )
        if card_obj:
            context.user_data["card_id"] = card_obj.id
    finally:
        db_card.close()

    # Run early categorization
    parsed = context.user_data["parsed"]
    db = SessionLocal()
    try:
        predicted_category_id, cats = _instant_categorize(parsed, context.user_data["user_id"], db)
        context.user_data["predicted_category_id"] = predicted_category_id
        context.user_data["cat_debug"] = ""

        card_type = card_obj.card_type if card_obj else ""
        amount = parsed.get("amount", 0) if parsed else 0
        if _should_ask_installments(predicted_category_id, db, amount, card_type):
            installment_keyboard = [
                [
                    InlineKeyboardButton("✅ Sí", callback_data="installment:yes"),
                    InlineKeyboardButton("❌ No", callback_data="installment:no"),
                ]
            ]
            await update.message.reply_text(
                "¿Lo pagaste en cuotas?",
                reply_markup=InlineKeyboardMarkup(installment_keyboard),
            )
            return WAITING_INSTALLMENT_QUESTION
        else:
            cat_levels = _build_cat_levels(predicted_category_id, db)
            confirm_keyboard = [
                [
                    InlineKeyboardButton("✅ Sí, guardar", callback_data="confirm:yes"),
                    InlineKeyboardButton("❌ Cancelar", callback_data="confirm:no"),
                ]
            ]
            confirm_msg = await update.message.reply_text(
                _confirm_text(parsed, label, cat_levels),
                parse_mode="HTML",
                reply_markup=InlineKeyboardMarkup(confirm_keyboard),
            )
            # Fire LLM in background (bank notification — no mount-time categorization)
            asyncio.create_task(
                _enhance_with_llm(
                    confirm_msg.chat_id,
                    confirm_msg.message_id,
                    parsed,
                    context.user_data["user_id"],
                    cats,
                    predicted_category_id,
                    label,
                    context,
                )
            )
            return WAITING_CONFIRM
    finally:
        db.close()


async def cancel(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    await update.message.reply_text("Cancelado.")
    return ConversationHandler.END


async def cancel_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle cancel button press via callback query."""
    query = update.callback_query
    await query.answer()
    await query.edit_message_text("Cancelado. Cuando quieras, mandame otro gasto.")
    return ConversationHandler.END


def start_bot(token: str) -> None:
    """Run the bot synchronously in its own event loop (called from a daemon thread)."""
    logging.getLogger("telegram").setLevel(logging.INFO)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    loop.run_until_complete(_run_bot(token))


async def _run_bot(token: str) -> None:
    global _bot_app
    app = Application.builder().token(token).build()
    _bot_app = app

    conv_handler = ConversationHandler(
        entry_points=[
            CommandHandler("start", start),
            MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message),
        ],
        states={
            WAITING_AUTH: [MessageHandler(filters.TEXT & ~filters.COMMAND, handle_auth)],
            WAITING_PAYMENT: [CallbackQueryHandler(handle_payment, pattern=r"^pay:")],
            WAITING_ACCOUNT_SELECT: [
                CallbackQueryHandler(handle_account_select, pattern=r"^account:")
            ],
            WAITING_ACCOUNT_CREATE_NAME: [
                MessageHandler(filters.TEXT & ~filters.COMMAND, handle_account_create_name)
            ],
            WAITING_ACCOUNT_CREATE_TYPE: [
                CallbackQueryHandler(handle_account_create_type, pattern=r"^acctype:")
            ],
            WAITING_CARD_BANK: [CallbackQueryHandler(handle_card_bank, pattern=r"^bank:")],
            WAITING_CARD_TYPE: [CallbackQueryHandler(handle_card_type, pattern=r"^card:")],
            WAITING_CONFIRM: [CallbackQueryHandler(handle_confirm, pattern=r"^confirm:")],
            WAITING_CARD_MANUAL: [
                MessageHandler(filters.TEXT & ~filters.COMMAND, handle_card_manual)
            ],
            WAITING_INSTALLMENT_QUESTION: [
                CallbackQueryHandler(handle_installment_question, pattern=r"^installment:")
            ],
            WAITING_INSTALLMENT_NUMBER: [
                MessageHandler(filters.TEXT & ~filters.COMMAND, handle_installment_number)
            ],
            WAITING_CARD_CREATE_CHOICE: [
                CallbackQueryHandler(handle_card_create_choice, pattern=r"^cardnew:")
            ],
            WAITING_CARD_CREATE_TYPE: [
                CallbackQueryHandler(handle_card_create_type, pattern=r"^cardctype:")
            ],
            WAITING_CARD_CREATE_NAME: [
                MessageHandler(filters.TEXT & ~filters.COMMAND, handle_card_create_name)
            ],
            WAITING_CARD_CREATE_CONFIRM: [
                CallbackQueryHandler(handle_card_create_confirm, pattern=r"^cardconfirm:")
            ],
            WAITING_EVENT_CONFIRM: [
                CallbackQueryHandler(handle_event_confirm, pattern=r"^event_link:")
            ],
        },
        fallbacks=[
            MessageHandler(filters.COMMAND, cancel),
            CallbackQueryHandler(cancel_callback, pattern=r"^cancel$"),
        ],
        per_message=False,
    )

    app.add_handler(conv_handler)

    logger.info("Telegram bot started (polling)")
    await app.initialize()
    await app.start()
    await app.updater.start_polling(drop_pending_updates=True)

    # Keep running until the process dies
    try:
        await asyncio.Event().wait()
    finally:
        await app.updater.stop()
        await app.stop()
        await app.shutdown()
