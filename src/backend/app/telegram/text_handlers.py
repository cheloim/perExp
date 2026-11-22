"""Natural-language expense capture (text messages)."""

import asyncio
import contextlib
import re
import time

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import ContextTypes, ConversationHandler

from app.models import Card, Category, Tag
from app.telegram.auth import _HELP_TEXT
from app.telegram.edit_handlers import cmd_deshacer, cmd_editar
from app.telegram.formatting import _format_amount
from app.telegram.parsing import (
    _extract_card_from_text,
    _is_bank_notification,
    _match_account_from_text,
    _match_card_from_text,
    _match_cuenta_tag_from_text,
)
from app.telegram.persistence import _installment_args
from app.telegram.runtime import bot_module, logger

_UNRECOGNIZED_MESSAGES = [
    "No encontré un monto en tu mensaje. ¿Podés contarme qué gastaste y cuánto?",
    "Necesito al menos el monto para registrar el gasto. ¿Cuánto fue?",
    'No pude identificar el importe. Probá con algo como <i>"supermercado 4500"</i> o <i>"taxi 1200 ayer"</i>.',
    "Hmm, no entendí bien. ¿Podés decirme qué compraste y por cuánto?",
]


async def _process_text_expense(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
    text: str,
    *,
    source: str,
) -> int:
    from app.metrics import TELEGRAM_MESSAGES

    TELEGRAM_MESSAGES.labels(direction="inbound").inc()
    if source == "text":
        chat_id = str(update.effective_chat.id)
        user = update.effective_user
        username = user.username or user.first_name or "unknown" if user else "unknown"
        text_raw = text or ""
        logger.info(
            "[MSG] chat_id=%s user=%s len=%d preview=%s",
            chat_id,
            username,
            len(text_raw),
            text_raw[:80] if text_raw else "(empty)",
        )
    else:
        logger.info("[VOICE] len=%d", len(text))

    auth_user = bot_module()._authenticated_user(update)
    if not auth_user:
        await update.message.reply_text("Primero autenticate con /start.")
        return ConversationHandler.END
    context.user_data["user_id"] = auth_user.id

    text = text.strip()

    if "ayuda" in text.lower():
        await update.message.reply_text(_HELP_TEXT, parse_mode="HTML")
        return ConversationHandler.END

    if "editar" in text.lower():
        return await cmd_editar(update, context)

    if text.lower().strip() in {"deshacer", "deshacer gasto", "undo"}:
        await cmd_deshacer(update, context)
        return ConversationHandler.END

    if _is_bank_notification(text):
        return await bot_module()._handle_bank_notification(
            update, context, text, log_content=source == "text"
        )

    parsed_list = await asyncio.to_thread(
        bot_module()._parse_expense, text, log_content=source == "text"
    )

    if not parsed_list:
        await update.message.reply_text(
            "No pude entender el gasto. Probá: 'gasto 500 en supermercado'",
            parse_mode="HTML",
        )
        return ConversationHandler.END

    text_card_name, text_bank, text_card_type = _extract_card_from_text(text)
    if source == "text":
        logger.info(
            "[CARD_DETECT] text=%r card_name=%r bank=%r card_type=%r",
            text,
            text_card_name,
            text_bank,
            text_card_type,
        )
    else:
        logger.info("[CARD_DETECT] source=voice len=%d", len(text))

    # Clean card/bank words from descriptions
    for parsed_item in parsed_list:
        if text_card_name and parsed_item.get("description"):
            desc = parsed_item["description"]
            for word in [text_card_name, text_bank or ""]:
                if word:
                    desc = re.sub(re.escape(word), "", desc, flags=re.IGNORECASE)
            for word in ["credito", "crédito", "débito", "debito"]:
                desc = re.sub(rf"\b{word}\b", "", desc, flags=re.IGNORECASE)
            parsed_item["description"] = re.sub(r"\s+", " ", desc).strip()

    user_id = context.user_data["user_id"]
    db = bot_module().SessionLocal()
    try:
        cards = db.query(Card).filter(Card.user_id == user_id).all()

        # Match card/account once from the message text (applies to all expenses)
        card_id = None
        account_id = None
        matched_tag_ids = []
        payment_tag_name = None

        matched_card = _match_card_from_text(cards, text_card_name, text_bank, text_card_type)
        if not matched_card and text_bank and not text_card_name:
            for card in cards:
                if card.bank and card.bank.lower() == text_bank.lower():
                    matched_card = card
                    break

        if matched_card:
            card_id = matched_card.id
            if source == "text":
                logger.info(
                    "[CARD_DETECT] matched card: id=%d name=%r", card_id, matched_card.card_name
                )
        else:
            # Fallback: match against 'cuenta' tags via HMAC (platform stores
            # payment methods as tags, not in the cards/accounts tables)
            matched_tag = _match_cuenta_tag_from_text(text_card_name, text_bank, user_id, db)
            if matched_tag:
                card_id = matched_tag.card_id
                account_id = matched_tag.account_id
                matched_tag_ids = [matched_tag.id]
                if source == "text":
                    logger.info(
                        "[CARD_DETECT] matched cuenta tag: id=%d card_id=%s account_id=%s",
                        matched_tag.id,
                        card_id,
                        account_id,
                    )
            else:
                matched_account = _match_account_from_text(text, user_id, db)
                if matched_account:
                    account_id = matched_account.id
                    if source == "text":
                        logger.info(
                            "[CARD_DETECT] matched account: id=%d name=%r",
                            account_id,
                            matched_account.name,
                        )
                else:
                    # Last fallback: create tag from extracted text
                    if text_card_name or text_bank:
                        payment_tag_name = f"{text_bank or ''} {text_card_name or ''}".strip()
                    if source == "text":
                        logger.info(
                            "[CARD_DETECT] no card/account matched, payment_tag_name=%r",
                            payment_tag_name,
                        )

        saved_expenses = []
        for parsed_item in parsed_list:
            predicted_category_id, cats = bot_module()._instant_categorize(parsed_item, user_id, db)

            expense = bot_module()._save_expense(
                parsed_item,
                payment="",
                person=update.effective_user.full_name or "",
                user_id=user_id,
                predicted_category_id=predicted_category_id,
                card_id=card_id,
                account_id=account_id,
                tag_ids=matched_tag_ids or None,
                payment_tag_name=payment_tag_name,
                log_content=source == "text",
                **_installment_args(parsed_item),
            )
            saved_expenses.append(expense)

        if not saved_expenses:
            await update.message.reply_text(
                "No pude guardar ningún gasto.",
                parse_mode="HTML",
            )
            return ConversationHandler.END

        # Build combined response
        context.user_data["last_expense_id"] = saved_expenses[-1].id
        context.user_data["last_expense_time"] = time.time()

        if len(saved_expenses) == 1:
            expense = saved_expenses[0]
            cat = (
                db.query(Category).filter(Category.id == expense.category_id).first()
                if expense.category_id
                else None
            )
            expense_tags = []
            if expense.id:
                from app.models import ExpenseTag

                expense_tags = (
                    db.query(Tag)
                    .join(ExpenseTag, ExpenseTag.tag_id == Tag.id)
                    .filter(ExpenseTag.expense_id == expense.id, Tag.group_name != "categoria")
                    .all()
                )

            keyboard = InlineKeyboardMarkup(
                [
                    [
                        InlineKeyboardButton(
                            "✏️ Editar",
                            callback_data=f"quickedit:{expense.id}",
                            style="primary",
                        )
                    ]
                ]
            )
            await update.message.reply_text(
                bot_module()._quick_saved_text(expense, cat.name if cat else None, expense_tags),
                reply_markup=keyboard,
            )
        else:
            lines = [f"✅ {len(saved_expenses)} gastos guardados:"]
            expense_ids = []
            for i, exp in enumerate(saved_expenses, 1):
                amount_str = _format_amount(exp.amount, exp.currency)
                lines.append(f"  {i}. {amount_str} — {exp.description}")
                expense_ids.append(str(exp.id))
            context.user_data["last_batch_ids"] = ",".join(expense_ids)

            keyboard = InlineKeyboardMarkup(
                [
                    [
                        InlineKeyboardButton(
                            "🗑 Deshacer todo",
                            callback_data="undobatch:last",
                        )
                    ]
                ]
            )
            await update.message.reply_text("\n".join(lines), reply_markup=keyboard)

        return ConversationHandler.END
    except Exception as e:
        if source == "text":
            logger.error("Error saving manual expense: %s", e, exc_info=True)
        else:
            logger.error("Error saving private voice expense (%s)", type(e).__name__)
        with contextlib.suppress(Exception):
            await update.message.reply_text(
                "⚠️ Hubo un error al guardar los gastos. Intentá de nuevo.",
                parse_mode="HTML",
            )
        return ConversationHandler.END
    finally:
        db.close()


async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    return await bot_module()._process_text_expense(
        update,
        context,
        update.message.text or "",
        source="text",
    )


async def handle_unsupported_message(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle non-text messages (photos, stickers, voice notes, etc.)."""
    msg = update.message
    msg_type = "unknown"
    if msg.photo:
        msg_type = "photo"
    elif msg.sticker:
        msg_type = "sticker"
    elif msg.voice or msg.audio:
        msg_type = "voice/audio"
    elif msg.video or msg.video_note:
        msg_type = "video"
    elif msg.document:
        msg_type = "document"
    elif msg.location:
        msg_type = "location"
    elif msg.contact:
        msg_type = "contact"

    chat_id = str(msg.chat_id) if msg.chat_id else "unknown"
    user = msg.from_user
    username = user.username or user.first_name or "unknown" if user else "unknown"
    logger.info(
        "[UNSUPPORTED] chat_id=%s user=%s type=%s",
        chat_id,
        username,
        msg_type,
    )

    await msg.reply_text(
        "📌 Este tipo de mensaje no está soportado por el bot. "
        "Mandame un texto con el gasto o usá /ayuda para ver los comandos disponibles."
    )
