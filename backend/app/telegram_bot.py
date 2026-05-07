import asyncio
import json
import logging
import os
import random
import uuid
from datetime import date, datetime

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
from app.prompts import EXPENSE_PARSE_PROMPT
from app.services.categorization import auto_categorize

logger = logging.getLogger(__name__)

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


def _gemini_client() -> genai.Client:
    return genai.Client(api_key=os.getenv("GEMINI_API_KEY", ""))


def _parse_expense(text: str) -> dict | None:
    today = date.today().strftime("%Y-%m-%d")
    prompt = EXPENSE_PARSE_PROMPT.format(today=today) + f"\n\nMensaje: {text}"
    try:
        client = _gemini_client()
        response = client.models.generate_content(
            model="gemini-flash-latest",
            contents=prompt,
        )
        raw = response.text.strip()
        logger.info("Gemini raw response: %r", raw)
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
        return None


def _get_accounts(user_id: int) -> list[Account]:
    """Returns list of accounts for the authenticated user."""
    db = SessionLocal()
    try:
        return db.query(Account).filter(Account.user_id == user_id).all()
    finally:
        db.close()


def _get_card_options(user_id: int) -> dict:
    """Returns {bank: [(card, last4), ...]} for the authenticated user."""
    db = SessionLocal()
    try:
        rows = (
            db.query(Expense.bank, Expense.card, Expense.card_last4)
            .filter(Expense.user_id == user_id)
            .filter(Expense.bank != "", Expense.card != "")
            .filter(Expense.card.notin_(["Efectivo", "Transferencia"]))
            .distinct()
            .all()
        )
        result: dict = {}
        seen: set = set()
        for bank, card, last4 in rows:
            key = (bank, card, last4)
            if key in seen:
                continue
            seen.add(key)
            result.setdefault(bank, []).append((card, last4 or ""))
        return {b: sorted(cards, key=lambda x: x[0]) for b, cards in result.items()}
    finally:
        db.close()


def _save_expense(
    parsed: dict,
    payment: str,
    person: str,
    bank: str = "",
    card: str = "",
    card_last4: str = "",
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
            description=parsed.get("description", ""),
            amount=float(parsed.get("amount") or 0),
            currency=parsed.get("currency", "ARS"),
            category_id=category_id,
            card=card if card else payment,
            bank=bank,
            person=person,
            card_last4=card_last4 or None,
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


_MONTHS_ES = ["enero","febrero","marzo","abril","mayo","junio",
               "julio","agosto","septiembre","octubre","noviembre","diciembre"]

def _format_date_es(date_str: str) -> str:
    try:
        d = datetime.strptime(date_str, "%Y-%m-%d").date()
        return f"{d.day} de {_MONTHS_ES[d.month - 1]} de {d.year}"
    except ValueError:
        return date_str


def _confirm_text(parsed: dict, payment_label: str) -> str:
    desc = parsed.get("description", "")
    amount_str = _format_amount(parsed["amount"], parsed.get("currency", "ARS"))
    date_str = _format_date_es(parsed.get("date", date.today().strftime("%Y-%m-%d")))
    return (
        f"Esto es lo que voy a guardar:\n\n"
        f"🛒 *{desc}*\n"
        f"💰 {amount_str}\n"
        f"📅 {date_str}\n"
        f"💳 {payment_label}\n\n"
        f"¿Lo guardamos?"
    )


_CAT_EMOJI: dict[str, str] = {
    # Categorías raíz
    "salud": "🏥", "alimentación": "🍽️", "alimentos": "🍽️", "supermercado": "🛒",
    "transporte": "🚗", "servicios": "⚡", "entretenimiento": "🎬", "educación": "📚",
    "ropa": "👕", "indumentaria": "👕", "viajes": "✈️", "hogar": "🏠", "tecnología": "💻",
    "mascotas": "🐾", "deporte": "🏋️", "inversiones": "📈", "impuestos": "🧾",
    "seguros": "🛡️", "banco": "🏦", "suscripciones": "📲",
    # Subcategorías
    "farmacia": "💊", "médico": "🩺", "médicos": "🩺", "taxi": "🚕", "uber": "🚕",
    "combustible": "⛽", "nafta": "⛽", "restaurante": "🍴", "café": "☕", "cafetería": "☕",
    "bar": "🍺", "fast food": "🍔", "netflix": "📺", "spotify": "🎵", "streaming": "📺",
    "gimnasio": "🏋️", "librería": "📖", "colegio": "🏫", "universidad": "🎓",
    "luz": "💡", "gas": "🔥", "agua": "💧", "internet": "🌐", "celular": "📱",
    "supermercados": "🛒", "almacén": "🛒", "verdulería": "🥦",
}

def _cat_emoji(name: str) -> str:
    return _CAT_EMOJI.get(name.lower(), "📂")


def _saved_text(expense: "Expense", payment_label: str) -> str:
    amount_str = _format_amount(expense.amount, expense.currency)
    date_str = _format_date_es(expense.date.strftime("%Y-%m-%d"))
    levels = getattr(expense, "_cat_levels", [])

    # Build category tree with emojis; description is always the leaf with 📝
    indents = ["", "  └ ", "      └ "]
    tree_lines = []
    for i, name in enumerate(levels):
        indent = indents[i] if i < len(indents) else indents[-1]
        tree_lines.append(f"{indent}{_cat_emoji(name)} {name}")
    # Description as final leaf
    leaf_indent = indents[min(len(levels), len(indents) - 1)]
    tree_lines.append(f"{leaf_indent}📝 {expense.description}")
    cat_tree = "\n".join(tree_lines)

    return (
        f"✅ ¡Listo! Guardé el gasto.\n\n"
        f"💰 {amount_str}\n"
        f"💳 {payment_label}\n"
        f"📅 {date_str}\n\n"
        f"{cat_tree}"
    )


def _get_user_by_chat_id(chat_id: str) -> User | None:
    db = SessionLocal()
    try:
        return db.query(User).filter(User.telegram_chat_id == chat_id).first()
    finally:
        db.close()


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    chat_id = str(update.effective_chat.id)
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.telegram_chat_id == chat_id).first()
        if user:
            await update.message.reply_text(
                f"Ya estás autenticado como *{user.full_name}*. Enviame un gasto.",
                parse_mode="Markdown",
            )
            return ConversationHandler.END
    finally:
        db.close()

    await update.message.reply_text(
        "Hola! Para usar el bot, ingresá tu clave de 12 caracteres.\n"
        "La encontrás en la app → Configuración → Telegram Bot."
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
        db.commit()
        db.refresh(user)
        await update.message.reply_text(
            f"✅ Autenticado como *{user.full_name}*\\.\n\n"
            "Para registrar un gasto, mandame un mensaje describiendo lo que gastaste\\. "
            "Podés ser tan informal como quieras:\n\n"
            "• _\"gasté 1500 en farmacity\"_\n"
            "• _\"uber 3200 ayer\"_\n"
            "• _\"almuerzo con Pedro 8500 pesos\"_\n"
            "• _\"Netflix USD 5\"_\n\n"
            "Te voy a mostrar el gasto parseado y te voy a pedir que confirmes el medio de pago\\. "
            "Por ejemplo, si mandás *\"uber 3200\"* te respondo así:\n\n"
            "▸ *Uber* — $3\\.200 \\(hoy\\)\n"
            "  ¿Cómo pagaste?  💵 Efectivo · 🔁 Transferencia · 💳 Tarjeta",
            parse_mode="MarkdownV2",
        )
        return ConversationHandler.END
    finally:
        db.close()


_HELP_TEXT = (
    "Registrá tus gastos escribiéndome de forma natural, como le contarías a alguien:\n\n"
    "• _\"farmacity 3200\"_\n"
    "• _\"almuerzo con el equipo 8500 pesos\"_\n"
    "• _\"uber ayer 1800\"_\n"
    "• _\"Netflix USD 5\"_\n"
    "• _\"cargué nafta 15000 el viernes\"_\n\n"
    "No hace falta ser preciso con el formato. "
    "Te voy a pedir el medio de pago y antes de guardar te muestro un resumen para que confirmes."
)

_UNRECOGNIZED_MESSAGES = [
    "No encontré un monto en tu mensaje. ¿Podés contarme qué gastaste y cuánto?",
    "Necesito al menos el monto para registrar el gasto. ¿Cuánto fue?",
    "No pude identificar el importe. Probá con algo como _\"supermercado 4500\"_ o _\"taxi 1200 ayer\"_.",
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

    if not parsed or not parsed.get("amount"):
        await update.message.reply_text(
            random.choice(_UNRECOGNIZED_MESSAGES),
            parse_mode="Markdown",
        )
        return ConversationHandler.END

    context.user_data["parsed"] = parsed
    context.user_data["tg_user"] = update.effective_user.full_name or update.effective_user.username or ""

    desc = parsed.get("description", "")
    amount_str = _format_amount(parsed["amount"], parsed.get("currency", "ARS"))
    date_str = parsed.get("date", date.today().strftime("%Y-%m-%d"))

    keyboard = [
        [
            InlineKeyboardButton("💵 Efectivo/Transferencia", callback_data="pay:efectivo_transferencia"),
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
            [InlineKeyboardButton(f"{acc.name} ({acc.type})", callback_data=f"account:{acc.id}")]
            for acc in accounts
        ]
        keyboard.append([InlineKeyboardButton("➕ Crear nueva cuenta", callback_data="account:new")])

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
        await query.edit_message_text(
            "No tengo tarjetas registradas para tu usuario.\n"
            "¿Con qué tarjeta pagaste? Escribí el nombre, por ejemplo: _Visa Galicia_ o _Master HSBC_.",
            parse_mode="Markdown",
        )
        return WAITING_CARD_MANUAL

    banks = sorted(card_options.keys())
    keyboard = [[InlineKeyboardButton(b, callback_data=f"bank:{b}")] for b in banks]
    await query.edit_message_text("💳 ¿Qué banco?", reply_markup=InlineKeyboardMarkup(keyboard))
    return WAITING_CARD_BANK


async def handle_card_bank(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()

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

    keyboard = [
        [InlineKeyboardButton(
            f"{card} ****{last4}" if last4 else card,
            callback_data=f"card:{card}:{last4}",
        )]
        for card, last4 in cards
    ]
    await query.edit_message_text("💳 ¿Qué tarjeta?", reply_markup=InlineKeyboardMarkup(keyboard))
    return WAITING_CARD_TYPE


async def handle_card_type(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()

    parts = query.data.split(":", 2)
    card = parts[1]
    last4 = parts[2] if len(parts) > 2 else ""
    bank = context.user_data.get("card_bank", "")

    label = f"{bank} {card}" + (f" ****{last4}" if last4 else "")
    context.user_data["card_selected"] = card
    context.user_data["card_last4"] = last4
    context.user_data["payment_label"] = label

    # Run early categorization to determine if we need to ask about installments
    parsed = context.user_data["parsed"]
    db = SessionLocal()
    try:
        cats = db.query(Category).all()
        predicted_category_id = auto_categorize(parsed.get("description", ""), cats)
        context.user_data["predicted_category_id"] = predicted_category_id

        # Check if we should ask about installments
        if _should_ask_installments(predicted_category_id, db):
            installment_keyboard = [[
                InlineKeyboardButton("✅ Sí", callback_data="installment:yes"),
                InlineKeyboardButton("❌ No", callback_data="installment:no"),
            ]]
            await query.edit_message_text(
                "¿Lo pagaste en cuotas?",
                reply_markup=InlineKeyboardMarkup(installment_keyboard),
            )
            return WAITING_INSTALLMENT_QUESTION
        else:
            # No installments needed, go straight to confirmation
            confirm_keyboard = [[
                InlineKeyboardButton("✅ Sí, guardar", callback_data="confirm:yes"),
                InlineKeyboardButton("❌ Cancelar", callback_data="confirm:no"),
            ]]
            await query.edit_message_text(
                _confirm_text(parsed, label),
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

    _, answer = query.data.split(":", 1)

    if answer == "no":
        # No installments, go to confirmation
        payment_label = context.user_data.get("payment_label", "")
        confirm_keyboard = [[
            InlineKeyboardButton("✅ Sí, guardar", callback_data="confirm:yes"),
            InlineKeyboardButton("❌ Cancelar", callback_data="confirm:no"),
        ]]
        await query.edit_message_text(
            _confirm_text(context.user_data["parsed"], payment_label),
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup(confirm_keyboard),
        )
        return WAITING_CONFIRM

    # answer == "yes" - ask for number of installments
    await query.edit_message_text(
        "¿Cuántas cuotas? (Escribí un número entre 2 y 60)"
    )
    return WAITING_INSTALLMENT_NUMBER


async def handle_installment_number(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle numeric input for installment count"""
    text = update.message.text.strip()

    # Validate input is a valid integer between 2-60
    try:
        installments = int(text)
        if installments < 2 or installments > 60:
            await update.message.reply_text(
                "Por favor, ingresá un número entre 2 y 60."
            )
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
    confirm_keyboard = [[
        InlineKeyboardButton("✅ Sí, guardar", callback_data="confirm:yes"),
        InlineKeyboardButton("❌ Cancelar", callback_data="confirm:no"),
    ]]

    await update.message.reply_text(
        _confirm_text(context.user_data["parsed"], payment_label),
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(confirm_keyboard),
    )
    return WAITING_CONFIRM


async def handle_account_select(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle account selection or new account creation trigger"""
    query = update.callback_query
    await query.answer()

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

    # Load account info
    db = SessionLocal()
    try:
        account = db.query(Account).filter(Account.id == int(account_id)).first()
        if not account:
            await query.edit_message_text("Error: cuenta no encontrada.")
            return ConversationHandler.END

        context.user_data["account_id"] = account.id
        context.user_data["payment_label"] = f"{account.name} ({account.type})"
    finally:
        db.close()

    # Show confirmation
    confirm_keyboard = [[
        InlineKeyboardButton("✅ Sí, guardar", callback_data="confirm:yes"),
        InlineKeyboardButton("❌ Cancelar", callback_data="confirm:no"),
    ]]
    await query.edit_message_text(
        _confirm_text(context.user_data["parsed"], context.user_data["payment_label"]),
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
        f"✅ Perfecto, *{account_name}*\n\n"
        f"Ahora elegí el tipo de cuenta:",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )
    return WAITING_ACCOUNT_CREATE_TYPE


async def handle_account_create_type(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle account type selection and create the account"""
    query = update.callback_query
    await query.answer()

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
    finally:
        db.close()

    # Show confirmation
    confirm_keyboard = [[
        InlineKeyboardButton("✅ Sí, guardar", callback_data="confirm:yes"),
        InlineKeyboardButton("❌ Cancelar", callback_data="confirm:no"),
    ]]
    await query.edit_message_text(
        _confirm_text(context.user_data["parsed"], context.user_data["payment_label"]),
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(confirm_keyboard),
    )
    return WAITING_CONFIRM


async def handle_confirm(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()

    _, answer = query.data.split(":", 1)
    if answer == "no":
        await query.edit_message_text("Cancelado. Cuando quieras, mandame otro gasto.")
        return ConversationHandler.END

    parsed = context.user_data["parsed"]
    payment_label = context.user_data.get("payment_label", "")
    method = context.user_data.get("payment_method", "")
    user_id = context.user_data.get("user_id")
    person = context.user_data.get("tg_user", "")

    # Extract installment data from context
    installment_total = context.user_data.get("installment_total")
    installment_group_id = context.user_data.get("installment_group_id")
    predicted_category_id = context.user_data.get("predicted_category_id")

    if method == "tarjeta":
        card = context.user_data.get("card_selected", "")
        bank = context.user_data.get("card_bank", "")
        last4 = context.user_data.get("card_last4", "")
        card_id = context.user_data.get("card_id")
        expense = _save_expense(
            parsed,
            payment=card,
            person=person,
            bank=bank,
            card=card,
            card_last4=last4,
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

    await query.edit_message_text(
        _saved_text(expense, payment_label),
        parse_mode="Markdown",
    )

    # Clean up installment data from context to prevent leakage
    context.user_data.pop("installment_total", None)
    context.user_data.pop("installment_group_id", None)
    context.user_data.pop("predicted_category_id", None)

    return ConversationHandler.END


async def handle_card_manual(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    card_name = update.message.text.strip()
    bank = context.user_data.get("card_bank", "")
    label = f"{bank} {card_name}".strip() if bank else card_name
    context.user_data["card_selected"] = card_name
    context.user_data["card_last4"] = ""
    context.user_data["payment_label"] = label

    # Run early categorization
    parsed = context.user_data["parsed"]
    db = SessionLocal()
    try:
        cats = db.query(Category).all()
        predicted_category_id = auto_categorize(parsed.get("description", ""), cats)
        context.user_data["predicted_category_id"] = predicted_category_id

        if _should_ask_installments(predicted_category_id, db):
            installment_keyboard = [[
                InlineKeyboardButton("✅ Sí", callback_data="installment:yes"),
                InlineKeyboardButton("❌ No", callback_data="installment:no"),
            ]]
            await update.message.reply_text(
                "¿Lo pagaste en cuotas?",
                reply_markup=InlineKeyboardMarkup(installment_keyboard),
            )
            return WAITING_INSTALLMENT_QUESTION
        else:
            confirm_keyboard = [[
                InlineKeyboardButton("✅ Sí, guardar", callback_data="confirm:yes"),
                InlineKeyboardButton("❌ Cancelar", callback_data="confirm:no"),
            ]]
            await update.message.reply_text(
                _confirm_text(parsed, label),
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
    app = Application.builder().token(token).build()

    conv_handler = ConversationHandler(
        entry_points=[
            CommandHandler("start", start),
            MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message),
        ],
        states={
            WAITING_AUTH: [MessageHandler(filters.TEXT & ~filters.COMMAND, handle_auth)],
            WAITING_PAYMENT: [CallbackQueryHandler(handle_payment, pattern=r"^pay:")],
            WAITING_ACCOUNT_SELECT: [CallbackQueryHandler(handle_account_select, pattern=r"^account:")],
            WAITING_ACCOUNT_CREATE_NAME: [MessageHandler(filters.TEXT & ~filters.COMMAND, handle_account_create_name)],
            WAITING_ACCOUNT_CREATE_TYPE: [CallbackQueryHandler(handle_account_create_type, pattern=r"^acctype:")],
            WAITING_CARD_BANK: [CallbackQueryHandler(handle_card_bank, pattern=r"^bank:")],
            WAITING_CARD_TYPE: [CallbackQueryHandler(handle_card_type, pattern=r"^card:")],
            WAITING_CONFIRM: [CallbackQueryHandler(handle_confirm, pattern=r"^confirm:")],
            WAITING_CARD_MANUAL: [MessageHandler(filters.TEXT & ~filters.COMMAND, handle_card_manual)],
            WAITING_INSTALLMENT_QUESTION: [CallbackQueryHandler(handle_installment_question, pattern=r"^installment:")],
            WAITING_INSTALLMENT_NUMBER: [MessageHandler(filters.TEXT & ~filters.COMMAND, handle_installment_number)],
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
