"""Confirmation, event linking and cancellation handlers."""

import asyncio
import json
from datetime import datetime

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import ContextTypes, ConversationHandler

from app.models import Card
from app.services.bot_reports import build_cat_levels as _build_cat_levels
from app.telegram.auth import _validate_session
from app.telegram.categorization import _enhance_with_llm
from app.telegram.constants import (
    BUE,
    WAITING_CONFIRM,
    WAITING_EVENT_CONFIRM,
    WAITING_INSTALLMENT_QUESTION,
)
from app.telegram.formatting import _confirm_text, _saved_text
from app.telegram.persistence import _should_ask_installments
from app.telegram.runtime import bot_module


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

    db = bot_module().SessionLocal()
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
    installment_number = context.user_data.get("installment_number")
    amount_is_total = context.user_data.get("amount_is_total", True)
    predicted_category_id = context.user_data.get("predicted_category_id")

    if method == "tarjeta":
        card = context.user_data.get("card_selected", "")
        bank = context.user_data.get("card_bank", "")
        card_id = context.user_data.get("card_id")
        expense = bot_module()._save_expense(
            parsed,
            payment=card,
            person=person,
            bank=bank,
            card=card,
            user_id=user_id,
            installment_total=installment_total,
            installment_group_id=installment_group_id,
            installment_number=installment_number,
            amount_is_total=amount_is_total,
            predicted_category_id=predicted_category_id,
            card_id=card_id,
        )
    elif method == "efectivo_transferencia":
        account_id = context.user_data.get("account_id")
        expense = bot_module()._save_expense(
            parsed,
            payment=payment_label,
            person=person,
            user_id=user_id,
            predicted_category_id=predicted_category_id,
            account_id=account_id,
        )
    else:
        expense = bot_module()._save_expense(
            parsed,
            payment=payment_label,
            person=person,
            user_id=user_id,
            predicted_category_id=predicted_category_id,
        )

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
    db = bot_module().SessionLocal()
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
    db_card = bot_module().SessionLocal()
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
    db = bot_module().SessionLocal()
    try:
        predicted_category_id, cats = bot_module()._instant_categorize(
            parsed, context.user_data["user_id"], db
        )
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
