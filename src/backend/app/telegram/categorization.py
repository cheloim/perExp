"""Keyword and LLM categorization helpers for the Telegram flows."""

import asyncio

from telegram import InlineKeyboardButton, InlineKeyboardMarkup

from app.models import Category
from app.services.bot_reports import build_cat_levels as _build_cat_levels
from app.services.categorization import auto_categorize, llm_categorize
from app.telegram.constants import DEBUG_CAT
from app.telegram.formatting import _confirm_text
from app.telegram.runtime import bot_module


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
        db = bot_module().SessionLocal()
        try:
            result = await asyncio.to_thread(
                llm_categorize,
                parsed.get("description", ""),
                parsed.get("amount"),
                cats,
                user_id,
                db,
            )
        finally:
            db.close()
        if not result or result["category_id"] == current_cat_id:
            return

        # Update stored data so _save_expense uses the better category
        context.user_data["predicted_category_id"] = result["category_id"]
        context.user_data["llm_result"] = result
        context.user_data["cat_debug"] = _cat_debug_str(result, parsed.get("description", ""), cats)

        db2 = bot_module().SessionLocal()
        try:
            cat_levels = _build_cat_levels(result["category_id"], db2)
        finally:
            db2.close()
        confirm_keyboard = [
            [
                InlineKeyboardButton("✅ Sí, guardar", callback_data="confirm:yes"),
                InlineKeyboardButton("❌ Cancelar", callback_data="confirm:no"),
            ]
        ]
        await bot_module()._bot_app.bot.edit_message_text(
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
