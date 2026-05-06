import asyncio
import json
import logging
import os
from datetime import date, datetime

from google import genai
from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import (
    Application,
    CallbackQueryHandler,
    ContextTypes,
    ConversationHandler,
    MessageHandler,
    filters,
)

from app.database import SessionLocal
from app.models import Category, Expense
from app.prompts import EXPENSE_PARSE_PROMPT
from app.services.categorization import auto_categorize

logger = logging.getLogger(__name__)

WAITING_PAYMENT = 1
WAITING_CARD_PERSON = 2
WAITING_CARD_BANK = 3
WAITING_CARD_TYPE = 4


def _gemini_client() -> genai.Client:
    return genai.Client(api_key=os.getenv("GEMINI_API_KEY", ""))


def _parse_expense(text: str) -> dict | None:
    today = date.today().strftime("%Y-%m-%d")
    prompt = EXPENSE_PARSE_PROMPT.format(today=today) + f"\n\nMensaje: {text}"
    try:
        client = _gemini_client()
        response = client.models.generate_content(
            model="gemini-2.0-flash",
            contents=prompt,
        )
        raw = response.text.strip()
        # Strip markdown code fences if present
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        return json.loads(raw.strip())
    except Exception as e:
        logger.error("Gemini parse error: %s", e)
        return None


def _get_card_options() -> dict:
    """Returns {person: {bank: [card, ...]}} from DB."""
    db = SessionLocal()
    try:
        rows = (
            db.query(Expense.person, Expense.bank, Expense.card)
            .filter(Expense.person != "", Expense.bank != "", Expense.card != "")
            .filter(Expense.card.notin_(["Efectivo", "Transferencia"]))
            .distinct()
            .all()
        )
        result: dict = {}
        for person, bank, card in rows:
            result.setdefault(person, {}).setdefault(bank, set()).add(card)
        # Convert sets to sorted lists
        return {p: {b: sorted(cards) for b, cards in banks.items()} for p, banks in result.items()}
    finally:
        db.close()


def _save_expense(parsed: dict, payment: str, person: str, bank: str = "", card: str = "", card_last4: str = "") -> Expense:
    db = SessionLocal()
    try:
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
        )
        db.add(expense)
        db.commit()
        db.refresh(expense)

        # Resolve category name for confirmation message
        if expense.category_id:
            cat = db.query(Category).filter(Category.id == expense.category_id).first()
            expense._category_name = cat.name if cat else "Sin categoría"
        else:
            expense._category_name = "Sin categoría"

        return expense
    finally:
        db.close()


def _format_amount(amount: float, currency: str) -> str:
    if currency == "USD":
        return f"USD {amount:,.2f}"
    return f"${amount:,.0f}"


async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    text = update.message.text.strip()
    parsed = _parse_expense(text)

    if not parsed or not parsed.get("amount"):
        await update.message.reply_text(
            "No pude entender el gasto. Intentá con algo como: \"gasté 1500 en farmacity\" o \"uber 3000 ayer\""
        )
        return ConversationHandler.END

    context.user_data["parsed"] = parsed
    context.user_data["tg_user"] = update.effective_user.full_name or update.effective_user.username or ""

    desc = parsed.get("description", "")
    amount_str = _format_amount(parsed["amount"], parsed.get("currency", "ARS"))
    date_str = parsed.get("date", date.today().strftime("%Y-%m-%d"))

    keyboard = [
        [
            InlineKeyboardButton("💵 Efectivo", callback_data="pay:efectivo"),
            InlineKeyboardButton("🔁 Transferencia", callback_data="pay:transferencia"),
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

    if method in ("efectivo", "transferencia"):
        label = "Efectivo" if method == "efectivo" else "Transferencia"
        person = context.user_data.get("tg_user", "")
        expense = _save_expense(
            context.user_data["parsed"],
            payment=label,
            person=person,
        )
        cat = getattr(expense, "_category_name", "Sin categoría")
        amount_str = _format_amount(expense.amount, expense.currency)
        await query.edit_message_text(
            f"✅ *Guardado*\n{expense.description} | {amount_str} | {label} | _{cat}_",
            parse_mode="Markdown",
        )
        return ConversationHandler.END

    # Tarjeta — ask for person
    card_options = _get_card_options()
    context.user_data["card_options"] = card_options

    if not card_options:
        # No known cards — save without card details
        expense = _save_expense(
            context.user_data["parsed"],
            payment="Tarjeta",
            person=context.user_data.get("tg_user", ""),
        )
        cat = getattr(expense, "_category_name", "Sin categoría")
        amount_str = _format_amount(expense.amount, expense.currency)
        await query.edit_message_text(
            f"✅ *Guardado*\n{expense.description} | {amount_str} | Tarjeta | _{cat}_",
            parse_mode="Markdown",
        )
        return ConversationHandler.END

    persons = sorted(card_options.keys())
    keyboard = [[InlineKeyboardButton(p, callback_data=f"person:{p}")] for p in persons]
    keyboard.append([InlineKeyboardButton("🚫 Sin titular", callback_data="person:")])
    await query.edit_message_text(
        "¿A nombre de quién?",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )
    return WAITING_CARD_PERSON


async def handle_card_person(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()

    person = query.data.split(":", 1)[1]
    context.user_data["card_person"] = person

    card_options = context.user_data.get("card_options", {})
    banks = sorted(card_options.get(person, {}).keys()) if person else []

    if not banks:
        # Save with just person, no bank/card detail
        expense = _save_expense(
            context.user_data["parsed"],
            payment="Tarjeta",
            person=person or context.user_data.get("tg_user", ""),
        )
        cat = getattr(expense, "_category_name", "Sin categoría")
        amount_str = _format_amount(expense.amount, expense.currency)
        await query.edit_message_text(
            f"✅ *Guardado*\n{expense.description} | {amount_str} | Tarjeta | _{cat}_",
            parse_mode="Markdown",
        )
        return ConversationHandler.END

    keyboard = [[InlineKeyboardButton(b, callback_data=f"bank:{b}")] for b in banks]
    await query.edit_message_text("¿Qué banco?", reply_markup=InlineKeyboardMarkup(keyboard))
    return WAITING_CARD_BANK


async def handle_card_bank(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()

    bank = query.data.split(":", 1)[1]
    context.user_data["card_bank"] = bank

    card_options = context.user_data.get("card_options", {})
    person = context.user_data.get("card_person", "")
    cards = sorted(card_options.get(person, {}).get(bank, []))

    if not cards:
        expense = _save_expense(
            context.user_data["parsed"],
            payment="Tarjeta",
            person=person,
            bank=bank,
        )
        cat = getattr(expense, "_category_name", "Sin categoría")
        amount_str = _format_amount(expense.amount, expense.currency)
        await query.edit_message_text(
            f"✅ *Guardado*\n{expense.description} | {amount_str} | {bank} | _{cat}_",
            parse_mode="Markdown",
        )
        return ConversationHandler.END

    keyboard = [[InlineKeyboardButton(c, callback_data=f"card:{c}")] for c in cards]
    await query.edit_message_text("¿Qué tarjeta?", reply_markup=InlineKeyboardMarkup(keyboard))
    return WAITING_CARD_TYPE


async def handle_card_type(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()

    card = query.data.split(":", 1)[1]
    bank = context.user_data.get("card_bank", "")
    person = context.user_data.get("card_person", "") or context.user_data.get("tg_user", "")

    expense = _save_expense(
        context.user_data["parsed"],
        payment=card,
        person=person,
        bank=bank,
        card=card,
    )
    cat = getattr(expense, "_category_name", "Sin categoría")
    amount_str = _format_amount(expense.amount, expense.currency)
    await query.edit_message_text(
        f"✅ *Guardado*\n{expense.description} | {amount_str} | {bank} {card} | _{cat}_",
        parse_mode="Markdown",
    )
    return ConversationHandler.END


async def cancel(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    await update.message.reply_text("Cancelado.")
    return ConversationHandler.END


def start_bot(token: str) -> None:
    """Run the bot synchronously in its own event loop (called from a daemon thread)."""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    loop.run_until_complete(_run_bot(token))


async def _run_bot(token: str) -> None:
    app = Application.builder().token(token).build()

    conv_handler = ConversationHandler(
        entry_points=[MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message)],
        states={
            WAITING_PAYMENT: [CallbackQueryHandler(handle_payment, pattern=r"^pay:")],
            WAITING_CARD_PERSON: [CallbackQueryHandler(handle_card_person, pattern=r"^person:")],
            WAITING_CARD_BANK: [CallbackQueryHandler(handle_card_bank, pattern=r"^bank:")],
            WAITING_CARD_TYPE: [CallbackQueryHandler(handle_card_type, pattern=r"^card:")],
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
