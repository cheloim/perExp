"""Undo and /editar expense editing flows."""

import re
from datetime import date, datetime, timedelta

import pandas as pd
from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import ContextTypes, ConversationHandler

from app.models import Expense, ExpenseTag
from app.telegram.constants import (
    WAITING_EDIT_CONFIRM,
    WAITING_EDIT_FIELD,
    WAITING_EDIT_SELECT,
    WAITING_EDIT_VALUE,
)
from app.telegram.formatting import _escape_html, _format_amount
from app.telegram.runtime import bot_module


async def handle_undo(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    await query.answer()

    expense_id = int(query.data.split(":")[1])
    db = bot_module().SessionLocal()
    try:
        chat_id = str(update.effective_chat.id)
        user = bot_module()._get_user_by_chat_id(chat_id)
        if not user:
            await query.edit_message_text("🔒 Sesión expirada.")
            return

        expense = (
            db.query(Expense).filter(Expense.id == expense_id, Expense.user_id == user.id).first()
        )
        if not expense:
            await query.edit_message_text("❌ Gasto no encontrado o ya deshecho.")
            return

        if expense.created_at and (datetime.utcnow() - expense.created_at).seconds > 120:
            await query.edit_message_text(
                "⏰ Ya pasaron 2 minutos, no se puede deshacer. Usá /editar."
            )
            return

        db.query(ExpenseTag).filter(ExpenseTag.expense_id == expense_id).delete()
        from app.models import ScheduledExpense

        db.query(ScheduledExpense).filter(ScheduledExpense.expense_id == expense_id).delete()
        db.delete(expense)
        db.commit()
        await query.edit_message_text("🗑 Gasto deshecho.")
    finally:
        db.close()


async def cmd_deshacer(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Undo the last saved expense when the 2-minute window is still open."""
    expense_id = context.user_data.get("last_expense_id")
    if not expense_id:
        await update.message.reply_text("No hay un gasto reciente para deshacer.")
        return

    db = bot_module().SessionLocal()
    try:
        user = bot_module()._get_user_by_chat_id(str(update.effective_chat.id))
        if not user:
            await update.message.reply_text("🔒 Sesión expirada.")
            return

        expense = (
            db.query(Expense).filter(Expense.id == expense_id, Expense.user_id == user.id).first()
        )
        if not expense:
            context.user_data.pop("last_expense_id", None)
            await update.message.reply_text("❌ Gasto no encontrado o ya deshecho.")
            return

        if expense.created_at and (datetime.utcnow() - expense.created_at).total_seconds() > 120:
            await update.message.reply_text(
                "⏰ Ya pasaron 2 minutos, no se puede deshacer. Usá /editar."
            )
            return

        db.query(ExpenseTag).filter(ExpenseTag.expense_id == expense_id).delete()
        from app.models import ScheduledExpense

        db.query(ScheduledExpense).filter(ScheduledExpense.expense_id == expense_id).delete()
        db.delete(expense)
        db.commit()
        context.user_data.pop("last_expense_id", None)
        await update.message.reply_text("🗑 Gasto deshecho.")
    finally:
        db.close()


async def handle_undo_batch(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    await query.answer()

    ids_str = query.data.split(":", 1)[1]
    if ids_str == "last":
        ids_str = context.user_data.get("last_batch_ids", "")
    expense_ids = [int(x) for x in ids_str.split(",") if x.isdigit()]
    if not expense_ids:
        await query.edit_message_text("❌ No hay gastos para deshacer.")
        return

    db = bot_module().SessionLocal()
    try:
        chat_id = str(update.effective_chat.id)
        user = bot_module()._get_user_by_chat_id(chat_id)
        if not user:
            await query.edit_message_text("🔒 Sesión expirada.")
            return

        deleted = 0
        for eid in expense_ids:
            expense = (
                db.query(Expense).filter(Expense.id == eid, Expense.user_id == user.id).first()
            )
            if not expense:
                continue
            if expense.created_at and (datetime.utcnow() - expense.created_at).seconds > 120:
                continue
            db.query(ExpenseTag).filter(ExpenseTag.expense_id == eid).delete()
            from app.models import ScheduledExpense

            db.query(ScheduledExpense).filter(ScheduledExpense.expense_id == eid).delete()
            db.delete(expense)
            deleted += 1

        db.commit()
        if deleted:
            await query.edit_message_text(f"🗑 {deleted} gasto(s) deshecho(s).")
        else:
            await query.edit_message_text("❌ No se pudo deshacer. Usá /editar.")
    finally:
        db.close()


async def handle_edit_quick(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()

    expense_id = int(query.data.split(":")[1])
    context.user_data["editing_expense_id"] = expense_id

    db = bot_module().SessionLocal()
    try:
        chat_id = str(update.effective_chat.id)
        user = bot_module()._get_user_by_chat_id(chat_id)
        if not user:
            await query.edit_message_text("🔒 Sesión expirada.")
            return ConversationHandler.END

        expense = (
            db.query(Expense).filter(Expense.id == expense_id, Expense.user_id == user.id).first()
        )
        if not expense:
            await query.edit_message_text("Gasto no encontrado.")
            return ConversationHandler.END

        context.user_data["edit_expense_id"] = expense_id
        context.user_data["user_id"] = user.id

        context.user_data["editable_expenses"] = {expense.id: expense}

        keyboard = InlineKeyboardMarkup(
            [
                [InlineKeyboardButton("📅 Fecha", callback_data="efield:date")],
                [InlineKeyboardButton("💰 Monto", callback_data="efield:amount")],
                [InlineKeyboardButton("📝 Descripción", callback_data="efield:description")],
                [InlineKeyboardButton("📂 Categoría", callback_data="efield:category_id")],
                [InlineKeyboardButton("❌ Cancelar", callback_data="efield:cancel")],
            ]
        )

        cat = expense.category
        cat_name = cat.name if cat else "Sin cat."
        text = (
            f"✏️ <b>Editando gasto:</b>\n"
            f"💰 {_format_amount(expense.amount, expense.currency)}\n"
            f"📅 {expense.date.strftime('%d/%m/%Y')}\n"
            f"📝 {_escape_html(str(expense.description))}\n"
            f"📂 {cat_name}\n\n"
            f"<i>Elegí el campo a modificar:</i>"
        )
        await query.edit_message_text(text, parse_mode="HTML", reply_markup=keyboard)
        return WAITING_EDIT_FIELD
    finally:
        db.close()


async def cmd_editar(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle /editar — start expense edit flow."""
    chat_id = str(update.effective_chat.id)
    user = bot_module()._get_user_by_chat_id(chat_id)
    if not user:
        await update.message.reply_text("Primero autenticate con /start.")
        return ConversationHandler.END

    context.user_data["user_id"] = user.id

    from app.services.bot_reports import get_group_user_ids
    from app.services.expense_update import EDITABLE_WINDOW_HOURS

    db = bot_module().SessionLocal()
    try:
        uid_list = get_group_user_ids(user.id, db)
        cutoff = datetime.utcnow() - timedelta(hours=EDITABLE_WINDOW_HOURS)

        editable = (
            db.query(Expense)
            .filter(
                Expense.user_id.in_(uid_list),
                Expense.created_at.isnot(None),
                Expense.created_at >= cutoff,
                Expense.budget_event_id.is_(None),
                Expense.recurring_expense_id.is_(None),
            )
            .order_by(Expense.created_at.desc())
            .limit(10)
            .all()
        )

        # Exclude installment series (installment_total > 1)
        editable = [e for e in editable if not (e.installment_total or 0) > 1]

        if not editable:
            await update.message.reply_text(
                "✏️ No hay gastos editables en las últimas 48h.\n"
                "Solo se pueden editar gastos creados recientemente."
            )
            return ConversationHandler.END

        context.user_data["editable_expenses"] = {e.id: e for e in editable}

        keyboard = []
        for e in editable:
            cat = e.category
            cat_name = cat.name if cat else "Sin cat."
            label = (
                f"{_format_amount(e.amount, e.currency)} · {e.date.strftime('%d/%m')} · {cat_name}"
            )
            # Truncate for inline button
            if len(label) > 50:
                label = label[:47] + "..."
            keyboard.append([InlineKeyboardButton(label, callback_data=f"edit:{e.id}")])

        keyboard.append([InlineKeyboardButton("❌ Cancelar", callback_data="edit:cancel")])

        await update.message.reply_text(
            "✏️ <b>¿Qué gasto querés editar?</b>\n<i>Solo muestra los últimos 48h.</i>",
            parse_mode="HTML",
            reply_markup=InlineKeyboardMarkup(keyboard),
        )
        return WAITING_EDIT_SELECT

    except Exception as e:
        if "created_at" in str(e):
            await update.message.reply_text(
                "⚠️ Falta una migración de base de datos.\n"
                "Avisá al administrador para aplicarla:\n"
                "<code>alembic upgrade head</code>",
                parse_mode="HTML",
            )
            return ConversationHandler.END
        raise
    finally:
        db.close()


async def handle_edit_select(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle expense selection in edit flow."""
    query = update.callback_query
    await query.answer()

    data = query.data
    if not data.startswith("edit:"):
        return WAITING_EDIT_SELECT

    value = data.split(":", 1)[1]
    if value == "cancel":
        await query.edit_message_text("Editado cancelado.")
        return ConversationHandler.END

    expense_id = int(value)
    editable = context.user_data.get("editable_expenses", {})
    expense = editable.get(expense_id)
    if not expense:
        await query.edit_message_text("Gasto no encontrado o ya no es editable.")
        return ConversationHandler.END

    context.user_data["edit_expense_id"] = expense_id

    # Show field selection keyboard
    keyboard = InlineKeyboardMarkup(
        [
            [InlineKeyboardButton("📅 Fecha", callback_data="efield:date")],
            [InlineKeyboardButton("💰 Monto", callback_data="efield:amount")],
            [InlineKeyboardButton("📝 Descripción", callback_data="efield:description")],
            [InlineKeyboardButton("📂 Categoría", callback_data="efield:category_id")],
            [InlineKeyboardButton("❌ Cancelar", callback_data="efield:cancel")],
        ]
    )

    cat = expense.category
    cat_name = cat.name if cat else "Sin cat."
    text = (
        f"✏️ <b>Editando gasto:</b>\n"
        f"💰 {_format_amount(expense.amount, expense.currency)}\n"
        f"📅 {expense.date.strftime('%d/%m/%Y')}\n"
        f"📝 {_escape_html(str(expense.description))}\n"
        f"📂 {cat_name}\n\n"
        f"<i>Elegí el campo a modificar:</i>"
    )
    await query.edit_message_text(text, parse_mode="HTML", reply_markup=keyboard)
    return WAITING_EDIT_FIELD


async def handle_edit_field(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle field selection in edit flow."""
    query = update.callback_query
    await query.answer()

    data = query.data
    if not data.startswith("efield:"):
        return WAITING_EDIT_FIELD

    field = data.split(":", 1)[1]
    if field == "cancel":
        await query.edit_message_text("Editado cancelado.")
        return ConversationHandler.END

    context.user_data["edit_field"] = field

    prompts = {
        "date": "📅 Ingresá la nueva fecha (DD/MM o YYYY-MM-DD):",
        "amount": "💰 Ingresá el nuevo monto (ej: 15000 o 15000.50):",
        "description": "📝 Ingresá la nueva descripción:",
        "category_id": "📂 Ingresá el nombre de la categoría:",
    }
    prompt = prompts.get(field, "Ingresá el nuevo valor:")

    await query.edit_message_text(prompt)
    return WAITING_EDIT_VALUE


async def handle_edit_value(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle value input in edit flow."""
    text = update.message.text.strip()
    field = context.user_data.get("edit_field")
    expense_id = context.user_data.get("edit_expense_id")
    editable = context.user_data.get("editable_expenses", {})
    expense = editable.get(expense_id)

    if not expense:
        await update.message.reply_text("Gasto no encontrado.")
        return ConversationHandler.END

    db = bot_module().SessionLocal()
    try:
        # Reload expense fresh
        db_exp = db.query(Expense).filter(Expense.id == expense_id).first()
        if not db_exp:
            await update.message.reply_text("Gasto no encontrado.")
            return ConversationHandler.END

        # Parse value
        changes = {}
        if field == "date":
            try:
                raw = text.strip()
                if re.match(r"^\d{4}-\d{2}-\d{2}$", raw):
                    parsed_date = date.fromisoformat(raw)
                else:
                    parsed_date = pd.to_datetime(raw, dayfirst=True).date()
                changes["date"] = parsed_date
            except Exception:
                await update.message.reply_text("Fecha inválida. Formato: DD/MM o YYYY-MM-DD")
                return WAITING_EDIT_VALUE

        elif field == "amount":
            try:
                amount_str = text.replace("$", "").replace(",", "").strip()
                changes["amount"] = float(amount_str)
            except ValueError:
                await update.message.reply_text("Monto inválido. Ej: 15000 o 15000.50")
                return WAITING_EDIT_VALUE

        elif field == "description":
            changes["description"] = text

        elif field == "category_id":
            from app.models import Category

            cat = (
                db.query(Category)
                .filter(
                    Category.user_id == context.user_data["user_id"],
                    Category.name.ilike(f"%{text}%"),
                )
                .first()
            )
            if not cat:
                await update.message.reply_text(
                    f"Categoría '{text}' no encontrada. Intentá de nuevo."
                )
                return WAITING_EDIT_VALUE
            changes["category_id"] = cat.id

        # Store changes for confirmation
        context.user_data["edit_changes"] = changes
        context.user_data["edit_db_expense_id"] = db_exp.id

        # Show confirmation with old→new diff
        old_val = getattr(db_exp, field)
        if field == "description" and hasattr(old_val, "decrypt"):
            old_val = str(old_val)
        if field == "category_id":
            old_cat = db.query(Category).filter(Category.id == old_val).first() if old_val else None
            old_val = old_cat.name if old_cat else "Sin categoría"
            new_cat = db.query(Category).filter(Category.id == changes["category_id"]).first()
            new_val = new_cat.name if new_cat else text
        elif field == "date":
            old_val = db_exp.date.strftime("%d/%m/%Y")
            new_val = changes["date"].strftime("%d/%m/%Y")
        elif field == "amount":
            old_val = _format_amount(db_exp.amount, db_exp.currency)
            new_val = _format_amount(changes["amount"], db_exp.currency)
        else:
            new_val = str(changes[field])

        confirm_keyboard = InlineKeyboardMarkup(
            [
                [
                    InlineKeyboardButton("✅ Confirmar", callback_data="econf:yes"),
                    InlineKeyboardButton("❌ Cancelar", callback_data="econf:no"),
                ]
            ]
        )

        await update.message.reply_text(
            f"✏️ <b>Confirmar cambio:</b>\n\n"
            f"<b>{field}:</b>\n"
            f"  ❌ {_escape_html(str(old_val))}\n"
            f"  ✅ {_escape_html(str(new_val))}",
            parse_mode="HTML",
            reply_markup=confirm_keyboard,
        )
        return WAITING_EDIT_CONFIRM

    finally:
        db.close()


async def handle_edit_confirm(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle edit confirmation."""
    query = update.callback_query
    await query.answer()

    data = query.data
    if not data.startswith("econf:"):
        return WAITING_EDIT_CONFIRM

    if data == "econf:no":
        await query.edit_message_text("Editado cancelado.")
        return ConversationHandler.END

    # Apply changes
    from app.services.expense_update import ExpenseEditError, update_expense_checked

    expense_id = context.user_data.get("edit_db_expense_id")
    changes = context.user_data.get("edit_changes", {})
    user_id = context.user_data.get("user_id")

    if not expense_id or not changes:
        await query.edit_message_text("Error: datos de edición perdidos.")
        return ConversationHandler.END

    db = bot_module().SessionLocal()
    try:
        db_exp = db.query(Expense).filter(Expense.id == expense_id).first()
        if not db_exp:
            await query.edit_message_text("Gasto no encontrado.")
            return ConversationHandler.END

        try:
            updated = update_expense_checked(db, user_id, db_exp, changes)
            if "category_id" in changes:
                from app.services.tag_sync import sync_category_tag

                sync_category_tag(db, updated, updated.category_id)
            await query.edit_message_text(
                f"✅ <b>Gasto actualizado.</b>\n\n"
                f"💰 {_format_amount(updated.amount, updated.currency)}\n"
                f"📅 {updated.date.strftime('%d/%m/%Y')}\n"
                f"📝 {_escape_html(str(updated.description))}",
                parse_mode="HTML",
            )
        except ExpenseEditError as e:
            await query.edit_message_text(
                f"❌ {e}\n\nProbá de nuevo con /editar.",
            )

    finally:
        db.close()

    # Clean up
    context.user_data.pop("editable_expenses", None)
    context.user_data.pop("edit_expense_id", None)
    context.user_data.pop("edit_field", None)
    context.user_data.pop("edit_changes", None)
    context.user_data.pop("edit_db_expense_id", None)

    return ConversationHandler.END
