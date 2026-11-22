"""Message and amount formatting shared by the Telegram handlers."""

from datetime import datetime

import telegram

from app.models import Expense
from app.services.bot_reports import _cat_emoji
from app.services.money import format_money
from app.telegram.constants import BUE
from app.telegram.runtime import logger


def _format_amount(amount: float, currency: str) -> str:
    return format_money(amount, currency)


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
        number = parsed.get("installment_number") or 1
        if parsed.get("amount_kind") == "installment" or number > 1:
            amount_line = (
                f"💰 {_format_amount(total_amount, currency)} (Cuota {number} de {installments})"
            )
        else:
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


def _format_category_tree(levels: list[str]) -> str:
    """Render the category hierarchy: the root carries the emoji, the rest 📂."""
    if not levels:
        return ""

    lines = [f"{_cat_emoji(levels[0])} {_escape_html(levels[0])}"]
    for depth, name in enumerate(levels[1:], start=1):
        lines.append(f"{'    ' * (depth - 1)}└ 📂 {_escape_html(name)}")
    return "\n".join(lines)


def _saved_text(expense: "Expense", payment_label: str = "", tags: list | None = None) -> str:
    """Build the 'expense saved' message.

    The message is category-first: the description is not repeated, and the
    account/custom tags sit next to the category so the user can see how the
    expense was classified without opening the app.
    """
    amount_str = _format_amount(expense.amount, expense.currency)
    date_str = _format_date_es(expense.date.strftime("%Y-%m-%d"))
    levels = getattr(expense, "_cat_levels", [])
    tags = tags or getattr(expense, "_tags", [])

    if expense.installment_total and expense.installment_total >= 2:
        if (expense.installment_number or 1) > 1:
            amount_line = (
                f"💰 {amount_str} "
                f"(Cuota {expense.installment_number} de {expense.installment_total})"
            )
        else:
            total = round(expense.amount * expense.installment_total, 2)
            amount_line = (
                f"💰 {_format_amount(total, expense.currency)} "
                f"({expense.installment_total} cuotas de {amount_str})"
            )
    else:
        amount_line = f"💰 {amount_str}"

    account_tag = next(
        (t for t in tags if getattr(t, "group_name", None) == "cuenta"),
        None,
    )
    payment = account_tag.name if account_tag else payment_label

    lines = ["✅ ¡Listo! Guardé el gasto.", "", amount_line]
    if payment:
        lines.append(f"💳 {_escape_html(payment)}")
    lines.append(f"📅 {date_str}")

    cat_tree = _format_category_tree(levels)
    if cat_tree:
        lines.extend(["", cat_tree])

    other_tags = [
        t.name for t in tags if getattr(t, "group_name", None) not in ("categoria", "cuenta")
    ]
    if other_tags:
        if not cat_tree:
            lines.append("")
        lines.append("🏷️ " + ", ".join(_escape_html(name) for name in other_tags))

    return "\n".join(lines)


def _quick_saved_text(
    expense: "Expense", category_name: str | None = None, tags: list | None = None
) -> str:
    """Compatibility wrapper for the flows that only had the leaf category."""
    if category_name and not getattr(expense, "_cat_levels", None):
        expense._cat_levels = [category_name]
    return _saved_text(expense, tags=tags)
