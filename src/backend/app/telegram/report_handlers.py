"""Inline text and image reports plus the report commands."""

import asyncio

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import ContextTypes

from app.services.money import format_totals
from app.telegram.auth import _HELP_TEXT
from app.telegram.formatting import _escape_html, _format_amount
from app.telegram.runtime import bot_module, logger


def _chunk_message(text: str, max_len: int = 4096) -> list[str]:
    """Split a long message into chunks that fit Telegram's 4096-char limit."""
    if len(text) <= max_len:
        return [text]
    chunks = []
    while text:
        if len(text) <= max_len:
            chunks.append(text)
            break
        # Try to split at the last newline before the limit
        split_at = text.rfind("\n", 0, max_len)
        if split_at == -1:
            split_at = max_len
        chunks.append(text[:split_at])
        text = text[split_at:].lstrip("\n")
    return chunks


def _format_budget_report(report) -> str:
    """Format a BudgetStatusReport as HTML for Telegram."""
    lines = [
        f"📊 <b>Presupuesto — {report.month}</b>",
    ]

    if report.total_budget > 0:
        status_emoji = _status_emoji_from_pct(report.total_pct)
        lines.append(
            f"\n💰 <b>General:</b> {_format_amount(report.total_spent, 'ARS')} / "
            f"{_format_amount(report.total_budget, 'ARS')} ({report.total_pct}%) {status_emoji}"
        )

    if report.groups:
        lines.append("\n📦 <b>Grupos:</b>")
        for g in report.groups:
            emoji = _status_emoji_from_pct(g.pct)
            lines.append(
                f"  {emoji} <b>{g.display_name}</b>: "
                f"{_format_amount(g.spent, 'ARS')} / {_format_amount(g.amount, 'ARS')} ({g.pct}%)"
            )

    if report.flagged:
        lines.append("\n⚠️ <b>Categorías con alerta:</b>")
        for f in report.flagged:
            emoji = "🔴" if f.status == "exceeded" else "🟡"
            lines.append(
                f"  {emoji} {f.name}: {_format_amount(f.spent, 'ARS')} / "
                f"{_format_amount(f.budget, 'ARS')} ({f.pct}%)"
            )

    if not report.groups and not report.flagged:
        lines.append("\nNo hay presupuestos activos para este mes.")

    return "\n".join(lines)


def _status_emoji_from_pct(pct: float) -> str:
    if pct >= 100:
        return "🔴"
    if pct >= 80:
        return "🟡"
    return "🟢"


def _format_period_report(report) -> str:
    """Format a PeriodSummaryReport as HTML for Telegram."""
    lines = [f"📊 <b>{report.label}</b>"]

    # Totals — ARS as primary + USD if present
    ars_total = report.total_by_currency.get("ARS", 0)
    usd_total = report.total_by_currency.get("USD", 0)
    gastos_line = f"💰 <b>Gastos:</b> {_format_amount(ars_total, 'ARS')}"
    if usd_total > 0:
        gastos_line += f" + {_format_amount(usd_total, 'USD')}"
    lines.append(f"\n{gastos_line}")

    if report.income > 0:
        ars_inc = report.income_by_currency.get("ARS", 0)
        usd_inc = report.income_by_currency.get("USD", 0)
        inc_line = f"💵 <b>Ingresos:</b> {_format_amount(ars_inc, 'ARS')}"
        if usd_inc > 0:
            inc_line += f" + {_format_amount(usd_inc, 'USD')}"
        lines.append(inc_line)
        lines.append(f"📈 <b>Neto:</b> {_format_amount(ars_total - ars_inc, 'ARS')}")
    lines.append(f"📋 <b>Transacciones:</b> {report.count}")

    if report.top_categories:
        lines.append("\n🏆 <b>Top categorías:</b>")
        for c in report.top_categories:
            lines.append(f"  {c.emoji} <b>{c.name}</b>: {_format_amount(c.total, 'ARS')}")

    if report.expenses:
        if report.expenses[0].date == report.expenses[-1].date:
            header = "📝 <b>Últimos gastos:</b>"
        else:
            header = "📝 <b>Gastos:</b>"
        lines.append(f"\n{header}")
        for exp in report.expenses:
            cat = _escape_html(exp.category)
            lines.append(
                f"  {exp.emoji} {_format_amount(exp.amount, exp.currency)} · "
                f"{exp.date} · <i>{_escape_html(exp.description)}</i>\n"
                f"    {cat}"
            )

    if not report.top_categories and not report.expenses:
        lines.append("\nNo hay gastos en este período.")

    return "\n".join(lines)


def _format_scheduled_report(report) -> str:
    """Format an UpcomingScheduledReport as HTML for Telegram."""
    if report.count == 0:
        return "📅 <b>Cuotas pendientes</b>\n\nNo hay cuotas pendientes en los próximos 30 días."

    lines = ["📅 <b>Cuotas pendientes</b> — próximos 30 días"]

    for week in report.weeks:
        lines.append(
            f"\n<b>{week.label}</b> ({format_totals((amount, cur) for cur, amount in week.total_by_currency.items())}):"
        )
        for item in week.items:
            badge = f" [{item.installment_label}]" if item.is_installment else ""
            card = f" · {item.card}" if item.card else ""
            lines.append(
                f"  • {item.day} — {_format_amount(item.amount, item.currency)}{badge}\n"
                f"    {_escape_html(item.description)}{card}"
            )

    lines.append(
        f"\n💰 <b>Total:</b> {format_totals((amount, cur) for cur, amount in report.total_by_currency.items())}"
    )
    lines.append(f"📋 <b>Cantidad:</b> {report.count}")

    return "\n".join(lines)


def _format_recurring_report(report) -> str:
    """Format an UpcomingRecurringReport as HTML for Telegram."""
    if report.count == 0:
        return (
            "🔄 <b>Suscripciones recurrentes</b>\n\nNo hay cobros próximos en los próximos 30 días."
        )

    lines = ["🔄 <b>Suscripciones recurrentes</b> — próximos 30 días"]

    for item in report.items:
        if item.days_until == 0:
            when = "hoy"
        elif item.days_until == 1:
            when = "mañana"
        else:
            when = f"en {item.days_until} días"

        freq = {"monthly": "Mensual", "weekly": "Semanal", "yearly": "Anual"}.get(
            item.frequency, item.frequency
        )
        lines.append(
            f"  📌 {_escape_html(item.description)}\n"
            f"     {_format_amount(item.amount, item.currency)} · {freq} · {when} ({item.next_date})"
        )

    lines.append(
        f"\n💰 <b>Total próximo:</b> {format_totals((amount, cur) for cur, amount in report.total_by_currency.items())}"
    )

    return "\n".join(lines)


async def cmd_presupuesto(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /presupuesto — show budget status."""
    chat_id = str(update.effective_chat.id)
    user = bot_module()._get_user_by_chat_id(chat_id)
    if not user:
        await update.message.reply_text("Primero autenticate con /start.")
        return

    context.user_data["user_id"] = user.id

    from app.services.bot_reports import build_budget_status

    db = bot_module().SessionLocal()
    try:
        report = build_budget_status(user.id, db)
        text = _format_budget_report(report)
        keyboard = InlineKeyboardMarkup(
            [[InlineKeyboardButton("📸 Imagen", callback_data="reportimg:budget")]]
        )
        for i, chunk in enumerate(_chunk_message(text)):
            if i == 0:
                await update.message.reply_text(chunk, parse_mode="HTML", reply_markup=keyboard)
            else:
                await update.message.reply_text(chunk, parse_mode="HTML")
    except Exception as e:
        logger.error(f"[BUDGET REPORT] Error: {e}")
        await update.message.reply_text("Error al generar el reporte de presupuesto.")
    finally:
        db.close()


async def cmd_gastos(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /gastos — show period selector for expense summary."""
    chat_id = str(update.effective_chat.id)
    user = bot_module()._get_user_by_chat_id(chat_id)
    if not user:
        await update.message.reply_text("Primero autenticate con /start.")
        return

    context.user_data["user_id"] = user.id
    keyboard = InlineKeyboardMarkup(
        [
            [
                InlineKeyboardButton("📅 Semana", callback_data="report:week"),
                InlineKeyboardButton("🗓️ Mes", callback_data="report:month"),
            ],
            [
                InlineKeyboardButton("📸 Semana (imagen)", callback_data="reportimg:summary:week"),
                InlineKeyboardButton("📸 Mes (imagen)", callback_data="reportimg:summary:month"),
            ],
        ]
    )
    await update.message.reply_text(
        "📊 <b>¿Qué resumen querés ver?</b>", parse_mode="HTML", reply_markup=keyboard
    )


async def handle_report_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle report period selection callbacks (report:week / report:month)."""
    query = update.callback_query
    await query.answer()

    chat_id = str(update.effective_chat.id)
    user = bot_module()._get_user_by_chat_id(chat_id)
    if not user or user.id != context.user_data.get("user_id"):
        await query.edit_message_text("🔒 Sesión expirada. Usá /start para reconectarte.")
        return

    data = query.data
    if not data.startswith("report:"):
        return

    period = data.split(":", 1)[1]
    if period not in ("week", "month"):
        return

    from app.services.bot_reports import build_period_summary, get_group_user_ids

    db = bot_module().SessionLocal()
    try:
        uid_list = get_group_user_ids(user.id, db)
        report = build_period_summary(user.id, uid_list, period, db)
        text = _format_period_report(report)
        for chunk in _chunk_message(text):
            await query.message.reply_text(chunk, parse_mode="HTML")
        # Delete the original keyboard message
        import contextlib

        with contextlib.suppress(Exception):
            await query.edit_message_text(
                f"📊 Resumen: {'semanal' if period == 'week' else 'mensual'}"
            )
    except Exception as e:
        logger.error(f"[PERIOD REPORT] Error: {e}")
        await query.message.reply_text("Error al generar el resumen.")
    finally:
        db.close()


async def cmd_cuotas(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /cuotas — show upcoming scheduled/installment expenses."""
    chat_id = str(update.effective_chat.id)
    user = bot_module()._get_user_by_chat_id(chat_id)
    if not user:
        await update.message.reply_text("Primero autenticate con /start.")
        return

    from app.services.bot_reports import build_upcoming_scheduled, get_group_user_ids

    db = bot_module().SessionLocal()
    try:
        uid_list = get_group_user_ids(user.id, db)
        report = build_upcoming_scheduled(uid_list, 30, db)
        text = _format_scheduled_report(report)
        keyboard = InlineKeyboardMarkup(
            [[InlineKeyboardButton("📸 Imagen", callback_data="reportimg:cuotas")]]
        )
        for i, chunk in enumerate(_chunk_message(text)):
            if i == 0:
                await update.message.reply_text(chunk, parse_mode="HTML", reply_markup=keyboard)
            else:
                await update.message.reply_text(chunk, parse_mode="HTML")
    except Exception as e:
        logger.error(f"[CUOTAS REPORT] Error: {e}")
        await update.message.reply_text("Error al generar el reporte de cuotas.")
    finally:
        db.close()


async def cmd_suscripciones(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /suscripciones — show upcoming recurring expenses."""
    chat_id = str(update.effective_chat.id)
    user = bot_module()._get_user_by_chat_id(chat_id)
    if not user:
        await update.message.reply_text("Primero autenticate con /start.")
        return

    from app.services.bot_reports import build_upcoming_recurring, get_group_user_ids

    db = bot_module().SessionLocal()
    try:
        uid_list = get_group_user_ids(user.id, db)
        report = build_upcoming_recurring(uid_list, 30, db)
        text = _format_recurring_report(report)
        keyboard = InlineKeyboardMarkup(
            [[InlineKeyboardButton("📸 Imagen", callback_data="reportimg:suscripciones")]]
        )
        for i, chunk in enumerate(_chunk_message(text)):
            if i == 0:
                await update.message.reply_text(chunk, parse_mode="HTML", reply_markup=keyboard)
            else:
                await update.message.reply_text(chunk, parse_mode="HTML")
    except Exception as e:
        logger.error(f"[SUSCRIPCIONES REPORT] Error: {e}")
        await update.message.reply_text("Error al generar el reporte de suscripciones.")
    finally:
        db.close()


async def cmd_ayuda(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /ayuda — show help text."""
    chat_id = str(update.effective_chat.id)
    user = bot_module()._get_user_by_chat_id(chat_id)
    if not user:
        await update.message.reply_text("Primero autenticate con /start.")
        return

    await update.message.reply_text(_HELP_TEXT, parse_mode="HTML")


async def handle_reportimg_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle report image generation callbacks (reportimg:budget|summary:week|...)."""
    query = update.callback_query
    await query.answer("Generando imagen...")

    chat_id = str(update.effective_chat.id)
    user = bot_module()._get_user_by_chat_id(chat_id)
    if not user or user.id != context.user_data.get("user_id"):
        await query.edit_message_text("🔒 Sesión expirada. Usá /start para reconectarte.")
        return

    data = query.data
    if not data.startswith("reportimg:"):
        return

    report_type = data.split(":", 1)[1]

    from app.services.bot_reports import (
        build_budget_status,
        build_period_summary,
        build_upcoming_recurring,
        build_upcoming_scheduled,
        get_group_user_ids,
    )
    from app.services.report_renderer import render_report_image

    db = bot_module().SessionLocal()
    try:
        uid_list = get_group_user_ids(user.id, db)

        if report_type == "budget":
            report = build_budget_status(user.id, db)
            groups_data = [
                {
                    "display_name": g.display_name,
                    "spent": _format_amount(g.spent, "ARS"),
                    "amount": _format_amount(g.amount, "ARS"),
                    "pct": g.pct,
                    "status": g.status,
                    "name": g.display_name.lower().replace(" ", "_"),
                }
                for g in report.groups
            ]
            flagged_data = [
                {
                    "name": f.name,
                    "spent": _format_amount(f.spent, "ARS"),
                    "budget": _format_amount(f.budget, "ARS"),
                    "pct": f.pct,
                    "status": f.status,
                }
                for f in report.flagged
            ]
            context_data = {
                "month": report.month,
                "total_budget": _format_amount(report.total_budget, "ARS"),
                "total_spent": _format_amount(report.total_spent, "ARS"),
                "total_pct": report.total_pct,
                "groups": groups_data,
                "flagged": flagged_data,
            }
            png = await asyncio.to_thread(
                render_report_image, "report_template_budget.html", context_data
            )

        elif report_type.startswith("summary:"):
            period = report_type.split(":", 1)[1]
            report = build_period_summary(user.id, uid_list, period, db)

            categories_data = []
            if report.top_categories:
                cat_max = report.top_categories[0].total if report.top_categories else 1
                for c in report.top_categories:
                    pct = round((c.total / cat_max * 100) if cat_max > 0 else 0, 1)
                    categories_data.append(
                        {
                            "emoji": c.emoji,
                            "name": c.name,
                            "total": _format_amount(c.total, "ARS"),
                            "pct": pct,
                        }
                    )

            expenses_data = [
                {
                    "date": e.date,
                    "description": e.description,
                    "category": e.category,
                    "emoji": e.emoji,
                    "amount": _format_amount(e.amount, e.currency),
                }
                for e in report.expenses
            ]

            # KPI totals: ARS primary + USD if present
            ars_total = report.total_by_currency.get("ARS", 0)
            usd_total = report.total_by_currency.get("USD", 0)
            total_label = _format_amount(ars_total, "ARS")
            if usd_total > 0:
                total_label += f" + {_format_amount(usd_total, 'USD')}"

            ars_inc = report.income_by_currency.get("ARS", 0)
            usd_inc = report.income_by_currency.get("USD", 0)
            inc_label = _format_amount(ars_inc, "ARS") if ars_inc > 0 else _format_amount(0, "ARS")
            if usd_inc > 0:
                inc_label += f" + {_format_amount(usd_inc, 'USD')}"

            context_data = {
                "label": report.label,
                "total": total_label,
                "income": inc_label,
                "net": _format_amount(ars_total - ars_inc, "ARS"),
                "count": report.count,
                "top_categories": categories_data,
                "expenses": expenses_data,
                "expenses_title": "Últimos Gastos" if period == "week" else "Top Gastos por Monto",
            }
            png = await asyncio.to_thread(
                render_report_image, "report_template_summary.html", context_data
            )

        elif report_type == "cuotas":
            report = build_upcoming_scheduled(uid_list, 30, db)
            weeks_data = []
            for w in report.weeks:
                items_data = [
                    {
                        "day": item.day,
                        "description": item.description,
                        "amount": _format_amount(item.amount, "ARS"),
                        "is_installment": item.is_installment,
                        "installment_label": item.installment_label,
                        "card": item.card,
                    }
                    for item in w.items
                ]
                weeks_data.append(
                    {
                        "label": w.label,
                        "total": _format_amount(w.total, "ARS"),
                        "items": items_data,
                    }
                )
            context_data = {
                "title": "Cuotas Pendientes",
                "subtitle": "Próximos 30 días",
                "total": _format_amount(report.total, "ARS"),
                "count": report.count,
                "weeks": weeks_data,
            }
            png = await asyncio.to_thread(
                render_report_image, "report_template_upcoming.html", context_data
            )

        elif report_type == "suscripciones":
            report = build_upcoming_recurring(uid_list, 30, db)
            # Convert recurring items to scheduled-like format for the template
            items_data = [
                {
                    "day": item.next_date,
                    "description": item.description,
                    "amount": _format_amount(item.amount, "ARS"),
                    "is_installment": False,
                    "installment_label": "",
                    "card": item.frequency,
                }
                for item in report.items
            ]
            weeks_data = [
                {
                    "label": "Suscripciones Próximas",
                    "total": _format_amount(report.total, "ARS"),
                    "items": items_data,
                }
            ]
            context_data = {
                "title": "Suscripciones Recurrentes",
                "subtitle": "Próximos 30 días",
                "total": _format_amount(report.total, "ARS"),
                "count": report.count,
                "weeks": weeks_data,
            }
            png = await asyncio.to_thread(
                render_report_image, "report_template_upcoming.html", context_data
            )

        else:
            await query.edit_message_text("Tipo de reporte no reconocido.")
            return

        # Send the image
        await query.message.reply_photo(
            png,
            caption=f"📊 {report_type.replace(':', ' ').replace('_', ' ').title()}",
        )
        # Update the original message
        await query.edit_message_text(
            f"📸 Imagen generada: {report_type.replace(':', ' ').replace('_', ' ').title()}"
        )

    except Exception as e:
        logger.error(f"[REPORT IMAGE] Error: {e}")
        await query.message.reply_text("Error al generar la imagen del reporte.")
    finally:
        db.close()
