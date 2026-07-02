import asyncio
import json
import logging
import os
import uuid
from datetime import date, datetime

from google import genai
from sqlalchemy import func
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
from app.services.categorization import auto_categorize
from app.services.import_utils import _normalize_text

logger = logging.getLogger(__name__)

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


def _gemini_client() -> genai.Client:
    return genai.Client(api_key=os.getenv("MESSAGES_BOT_LLM_API_KEY", ""))


def _parse_expense(text: str) -> dict | None:
    today = date.today().strftime("%Y-%m-%d")
    prompt = EXPENSE_PARSE_PROMPT.format(today=today) + f"\n\nMensaje: {text}"
    logger.debug(f"[PARSE] Prompt:\n{prompt}")
    try:
        client = _gemini_client()
        response = client.models.generate_content(
            model="gemini-flash-latest",
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
            model="gemini-flash-latest",
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

        raw_date = parsed.get("date") or date.today().strftime("%Y-%m-%d")
        try:
            expense_date = datetime.strptime(raw_date, "%Y-%m-%d").date()
        except ValueError:
            expense_date = date.today()

        expense = Expense(
            date=expense_date,
            description=_normalize_text(parsed.get("description", "")),
            amount=float(parsed.get("amount") or 0),
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


def _should_ask_installments(category_id: int | None, db) -> bool:
    """
    Returns True if category matches installment rules:
    - Parent: Viajes, Educación, or Indumentaria
    - Subcategory whose parent is: Mantenimiento or Mobiliario
    """
    if not category_id:
        return False

    category = db.query(Category).filter(Category.id == category_id).first()
    if not category:
        return False

    # Check parent categories
    if category.parent_id is None:
        return category.name in ("Viajes", "Educación", "Indumentaria")

    # Check subcategories of target parents
    parent = db.query(Category).filter(Category.id == category.parent_id).first()
    if parent:
        return parent.name in ("Mantenimiento", "Mobiliario", "Viajes", "Educación", "Indumentaria")

    return False


def _format_amount(amount: float, currency: str) -> str:
    if currency == "USD":
        return f"USD {amount:,.2f}"
    return f"${amount:,.0f}"


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


def _confirm_text(parsed: dict, payment_label: str, cat_levels: list[str] = None) -> str:
    desc = _escape_md(parsed.get("description", ""))
    amount_str = _format_amount(parsed["amount"], parsed.get("currency", "ARS"))
    date_str = _format_date_es(parsed.get("date", date.today().strftime("%Y-%m-%d")))
    safe_label = _escape_md(payment_label)
    cat_tree = ""
    if cat_levels:
        indents = ["", "  └ ", "      └ "]
        for i, name in enumerate(cat_levels):
            indent = indents[i] if i < len(indents) else indents[-1]
            cat_tree += f"{indent}{_cat_emoji(name)} {name}\n"
    return (
        f"Esto es lo que voy a guardar:\n\n"
        f"🛒 *{desc}*\n"
        f"💰 {amount_str}\n"
        f"📅 {date_str}\n"
        f"💳 {safe_label}\n"
        f"{cat_tree}"
        f"\n¿Lo guardamos?"
    )


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


def _escape_md(text: str) -> str:
    """Escape Telegram Markdown special characters to prevent parse errors."""
    for ch in ("\\", "*", "_", "[", "`"):
        text = text.replace(ch, f"\\{ch}")
    return text


def _cat_emoji(name: str) -> str:
    return _CAT_EMOJI.get(name.lower(), "📂")


def _saved_text(expense: "Expense", payment_label: str) -> str:
    amount_str = _format_amount(expense.amount, expense.currency)
    date_str = _format_date_es(expense.date.strftime("%Y-%m-%d"))
    safe_label = _escape_md(payment_label)
    levels = getattr(expense, "_cat_levels", [])

    # Build category tree with emojis; description is always the leaf with 📝
    indents = ["", "  └ ", "      └ "]
    tree_lines = []
    for i, name in enumerate(levels):
        indent = indents[i] if i < len(indents) else indents[-1]
        tree_lines.append(f"{indent}{_cat_emoji(name)} {name}")
    # Description as final leaf
    leaf_indent = indents[min(len(levels), len(indents) - 1)]
    tree_lines.append(f"{leaf_indent}📝 {_escape_md(expense.description)}")
    cat_tree = "\n".join(tree_lines)

    return (
        f"✅ ¡Listo! Guardé el gasto.\n\n"
        f"💰 {amount_str}\n"
        f"💳 {safe_label}\n"
        f"📅 {date_str}\n\n"
        f"{cat_tree}"
    )


def _get_user_by_chat_id(chat_id: str) -> User | None:
    db = SessionLocal()
    try:
        return db.query(User).filter(User.telegram_chat_id == chat_id).first()
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
            await _bot_app.bot.send_message(chat_id=chat_id, text=text, parse_mode="Markdown")
        except Exception as e:
            logger.warning(f"[TELEGRAM] Could not send message to {chat_id}: {e}")

    loop = _bot_app.bot._local._loop if hasattr(_bot_app.bot, "_local") else None
    if loop and loop.is_running():
        asyncio.run_coroutine_threadsafe(_send(), loop)
    else:
        logger.warning("[TELEGRAM] Bot event loop not available")


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    chat_id = str(update.effective_chat.id)
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.telegram_chat_id == chat_id).first()
        if user:
            await update.message.reply_text(
                f"¡Hola de nuevo, *{user.full_name}*! 🎉 ¿Qué gastaste hoy?",
                parse_mode="Markdown",
            )
            return ConversationHandler.END
    finally:
        db.close()

    await update.message.reply_text(
        "👋 ¡Hola! Soy *NikoFin*, tu asistente de finanzas personales.\n\n"
        "Para conectarte con tu cuenta, ingresá tu clave de 12 caracteres.\n"
        "La encontrás en la app → Configuración → Telegram Bot.",
        parse_mode="Markdown",
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
        user.telegram_key = None  # Invalidate key after use
        db.commit()
        db.refresh(user)
        await update.message.reply_text(
            f"🎉 ¡Listo, *{user.full_name}*! Ya podés mandarme tus gastos.\n\n"
            "Escribime como le contarías a un amigo:\n\n"
            '• _"gasté 1500 en farmacity"_\n'
            '• _"uber 3200 ayer"_\n'
            '• _"almuerzo con Pedro 8500 pesos"_\n'
            '• _"Netflix USD 5"_\n\n'
            "Yo me encargo del resto 📊\n"
            "Te voy a mostrar el gasto parseado y te voy a pedir que confirmes el medio de pago.",
            parse_mode="Markdown",
        )
        return ConversationHandler.END
    finally:
        db.close()


_HELP_TEXT = (
    "📝 *Así registrás tus gastos con NikoFin:*\n\n"
    "Escribime de forma natural, como le contarías a un amigo:\n\n"
    '• _"farmacity 3200"_\n'
    '• _"almuerzo con el equipo 8500 pesos"_\n'
    '• _"uber ayer 1800"_\n'
    '• _"Netflix USD 5"_\n'
    '• _"cargué nafta 15000 el viernes"_\n\n'
    "No hace falta ser preciso con el formato.\n"
    "Yo te voy a pedir el medio de pago y antes de guardar te muestro un resumen para que confirmes."
)

_UNRECOGNIZED_MESSAGES = [
    "No encontré un monto en tu mensaje. ¿Podés contarme qué gastaste y cuánto?",
    "Necesito al menos el monto para registrar el gasto. ¿Cuánto fue?",
    'No pude identificar el importe. Probá con algo como _"supermercado 4500"_ o _"taxi 1200 ayer"_.',
    "Hmm, no entendí bien. ¿Podés decirme qué compraste y por cuánto?",
]


async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    chat_id = str(update.effective_chat.id)
    auth_user = _get_user_by_chat_id(chat_id)
    if not auth_user:
        await update.message.reply_text("Primero autenticate con /start.")
        return ConversationHandler.END
    context.user_data["user_id"] = auth_user.id

    text = update.message.text.strip()

    if "ayuda" in text.lower():
        await update.message.reply_text(_HELP_TEXT, parse_mode="Markdown")
        return ConversationHandler.END

    parsed = await asyncio.to_thread(_parse_expense, text)
    logger.debug(
        f"[PARSE] Parsed result: {parsed}, amount: {parsed.get('amount') if parsed else None}"
    )

    if not parsed or not parsed.get("amount"):
        # Show help text instead of generic error
        await update.message.reply_text(_HELP_TEXT, parse_mode="Markdown")
        return ConversationHandler.END

    context.user_data["parsed"] = parsed
    context.user_data["tg_user"] = (
        update.effective_user.full_name or update.effective_user.username or ""
    )

    desc = _escape_md(parsed.get("description", ""))
    amount_str = _format_amount(parsed["amount"], parsed.get("currency", "ARS"))
    date_str = parsed.get("date", date.today().strftime("%Y-%m-%d"))

    keyboard = [
        [
            InlineKeyboardButton(
                "💵 Efectivo/Transferencia", callback_data="pay:efectivo_transferencia"
            ),
            InlineKeyboardButton("💳 Tarjeta", callback_data="pay:tarjeta"),
        ]
    ]
    await update.message.reply_text(
        f"*{desc}* — {amount_str} ({date_str})\n\n¿Cómo pagaste?",
        parse_mode="Markdown",
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
                parse_mode="Markdown",
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
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup(keyboard),
        )
        return WAITING_CARD_CREATE_CHOICE

    banks = sorted(card_options.keys())
    keyboard = [[InlineKeyboardButton(b, callback_data=f"bank:{b}")] for b in banks]
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
            parse_mode="Markdown",
        )
        return WAITING_CARD_MANUAL

    keyboard = [[InlineKeyboardButton(card, callback_data=f"card:{card}")] for card in cards]
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
        card_obj = (
            db_card.query(Card)
            .filter(
                Card.user_id == context.user_data["user_id"],
                func.lower(Card.card_name) == card.lower(),
                func.lower(Card.bank) == bank.lower(),
            )
            .first()
        )
        if card_obj:
            context.user_data["card_id"] = card_obj.id
    finally:
        db_card.close()

    # Run early categorization to determine if we need to ask about installments
    parsed = context.user_data["parsed"]
    db = SessionLocal()
    try:
        cats = db.query(Category).all()
        predicted_category_id = auto_categorize(parsed.get("description", ""), cats)
        context.user_data["predicted_category_id"] = predicted_category_id

        # Check if we should ask about installments
        if _should_ask_installments(predicted_category_id, db):
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
                parse_mode="Markdown",
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
            _confirm_text(context.user_data["parsed"], payment_label, cat_levels),
            parse_mode="Markdown",
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
        _confirm_text(context.user_data["parsed"], payment_label, cat_levels),
        parse_mode="Markdown",
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
            parse_mode="Markdown",
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

        # Auto-categorize for cash/transfer expenses
        parsed = context.user_data["parsed"]
        cats = db.query(Category).all()
        predicted_category_id = auto_categorize(parsed.get("description", ""), cats)
        context.user_data["predicted_category_id"] = predicted_category_id
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
        parse_mode="Markdown",
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
        f"✅ Perfecto, *{_escape_md(account_name)}*\n\nAhora elegí el tipo de cuenta:",
        parse_mode="Markdown",
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
            type=account_type,
            user_id=user_id,
        )
        db.add(new_account)
        db.commit()
        db.refresh(new_account)

        context.user_data["account_id"] = new_account.id
        context.user_data["payment_label"] = f"{new_account.name} ({new_account.type})"

        # Auto-categorize for cash/transfer expenses
        parsed = context.user_data["parsed"]
        cats = db.query(Category).all()
        predicted_category_id = auto_categorize(parsed.get("description", ""), cats)
        context.user_data["predicted_category_id"] = predicted_category_id
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
        parse_mode="Markdown",
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
            parse_mode="Markdown",
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
        parse_mode="Markdown",
    )
    return WAITING_CARD_CREATE_NAME


async def handle_card_create_name(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle card name input, extract info with LLM, ask for confirmation"""
    raw_input = update.message.text.strip()
    card_type = context.user_data.get("new_card_type", "credito")

    db = SessionLocal()
    try:
        chat_id = str(update.effective_chat.id)
        user = db.query(User).filter(User.telegram_chat_id == chat_id).first()
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
        "🔍 *Detectado*\n\n"
        f"💳 Tarjeta: *{_escape_md(card_name)}*\n"
        f"🏦 Banco: *{_escape_md(bank_display)}*\n"
        f"👤 Titular: *{_escape_md(holder)}*\n"
        f"💳 Tipo: *{_escape_md(card_type)}*\n\n"
        "¿Confirmás la creación de esta tarjeta?",
        parse_mode="Markdown",
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
        user = db.query(User).filter(User.telegram_chat_id == chat_id).first()
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
                func.lower(func.trim(Card.card_name)) == card_name.lower(),
                func.lower(func.trim(Card.bank)) == bank.lower(),
            )
            .first()
        )
        if existing:
            await query.message.reply_text(
                "❌ Ya existe una tarjeta con ese nombre y banco. Probá con otro nombre.",
                parse_mode="Markdown",
            )
            return ConversationHandler.END

        new_card = Card(
            card_name=card_name,
            bank=bank,
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
        cats = db.query(Category).all()
        predicted_category_id = auto_categorize(parsed.get("description", ""), cats)
        context.user_data["predicted_category_id"] = predicted_category_id

        if _should_ask_installments(predicted_category_id, db):
            installment_keyboard = [
                [
                    InlineKeyboardButton("✅ Sí", callback_data="installment:yes"),
                    InlineKeyboardButton("❌ No", callback_data="installment:no"),
                ]
            ]
            await query.edit_message_text(
                f"✅ *Tarjeta {_escape_md(card_name)} creada!*\n\n¿Lo pagaste en cuotas?",
                parse_mode="Markdown",
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
                f"✅ *Tarjeta {_escape_md(card_name)} creada!*\n\n"
                + _confirm_text(parsed, context.user_data["payment_label"], cat_levels),
                parse_mode="Markdown",
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

    installment_total = context.user_data.get("installment_total")
    installment_group_id = context.user_data.get("installment_group_id")
    predicted_category_id = context.user_data.get("predicted_category_id")

    db = SessionLocal()
    try:
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

        # Create ScheduledExpenses for future installments (2..N)
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
                    card_id=expense.card_id,
                    account_id=expense.account_id,
                    category_id=expense.category_id,
                    status="PENDING",
                    user_id=user_id,
                )
                db.add(scheduled)
            db.commit()

        await query.edit_message_text(
            _saved_text(expense, payment_label),
            parse_mode="Markdown",
        )

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
        card_obj = (
            db_card.query(Card)
            .filter(
                Card.user_id == context.user_data["user_id"],
                func.lower(Card.card_name) == card_name.lower(),
                func.lower(Card.bank) == bank.lower() if bank else True,
            )
            .first()
        )
        if card_obj:
            context.user_data["card_id"] = card_obj.id
    finally:
        db_card.close()

    # Run early categorization
    parsed = context.user_data["parsed"]
    db = SessionLocal()
    try:
        cats = db.query(Category).all()
        predicted_category_id = auto_categorize(parsed.get("description", ""), cats)
        context.user_data["predicted_category_id"] = predicted_category_id

        if _should_ask_installments(predicted_category_id, db):
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
            await update.message.reply_text(
                _confirm_text(parsed, label, cat_levels),
                parse_mode="Markdown",
                reply_markup=InlineKeyboardMarkup(confirm_keyboard),
            )
            return WAITING_CONFIRM
    finally:
        db.close()


async def cancel(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    await update.message.reply_text("Cancelado.")
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
        },
        fallbacks=[MessageHandler(filters.COMMAND, cancel)],
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
