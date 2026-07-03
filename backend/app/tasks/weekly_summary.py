"""Weekly summary task - generates and sends weekly report images via Telegram."""

from datetime import date, timedelta
from calendar import monthrange
from collections import defaultdict
import json
import os
import re

from app.celery_app import celery_app
from app.database import SessionLocal
from app.models import Category, Expense, ScheduledExpense, Setting, User


MONTHS_ES = {
    1: "Enero", 2: "Febrero", 3: "Marzo", 4: "Abril",
    5: "Mayo", 6: "Junio", 7: "Julio", 8: "Agosto",
    9: "Septiembre", 10: "Octubre", 11: "Noviembre", 12: "Diciembre",
}


def _get_week_range():
    """Get the date range for the past week (Monday to Sunday)."""
    today = date.today()
    start = today - timedelta(days=today.weekday() + 7)
    end = start + timedelta(days=6)
    return start, end


def _get_next_week_range():
    """Get the date range for the upcoming week (Monday to Sunday)."""
    today = date.today()
    days_until_next_monday = (7 - today.weekday()) % 7
    if days_until_next_monday == 0:
        days_until_next_monday = 7
    start = today + timedelta(days=days_until_next_monday)
    end = start + timedelta(days=6)
    return start, end


def _generate_weekly_llm_analysis(report_data: dict) -> dict:
    """Generate LLM analysis for weekly report using Gemini."""
    try:
        import os
        from google import genai
        from google.genai import types as genai_types
        import asyncio

        api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
        if not api_key:
            print("[WEEKLY LLM] No API key found, skipping LLM analysis")
            return None

        total = report_data.get("total_expenses", 0)
        accumulated = report_data.get("monthly_accumulated", 0)
        categories = report_data.get("categories", [])
        cat_text = ", ".join([f"{c['name']}: ${c['total']:,.0f}" for c in categories[:5]])

        llm_context = f"""RESUMEN SEMANAL - NikoFin

GASTO SEMANAL: ${total:,.2f}
ACUMULADO MES: ${accumulated:,.2f}
TRANSACCIONES: {report_data.get('transaction_count', 0)}

TOP CATEGORÍAS:
{cat_text}

Fecha: {date.today().isoformat()}"""

        prompt = """Sos un analista financiero personal. Genera un análisis breve (3-4 líneas) del gasto semanal.
Incluye:
1. Observación principal sobre el gasto
2. Categoría con mayor impacto
3. Un consejo concreto de ahorro (1 línea)

Responde en español, amigable, sin emojis. Máximo 80 palabras.
Devolve SOLO el texto del análisis, sin formato JSON."""

        client = genai.Client(api_key=api_key)

        async def _call_llm():
            return await client.aio.models.generate_content(
                model="gemini-flash-latest",
                contents=llm_context,
                config=genai_types.GenerateContentConfig(
                    system_instruction=prompt,
                ),
            )

        response = asyncio.run(_call_llm())
        analysis_text = response.text.strip()

        # Extract tip (last line if it starts with 💡 or Consejo)
        tip = None
        lines = analysis_text.split("\n")
        if len(lines) > 1:
            last_line = lines[-1].strip()
            if last_line.startswith("💡") or last_line.lower().startswith("consejo"):
                tip = last_line
                analysis_text = "\n".join(lines[:-1]).strip()

        return {
            "summary": analysis_text,
            "tip": tip,
        }
    except Exception as e:
        print(f"[WEEKLY LLM] Error generating analysis: {e}")
        return None


def _build_weekly_report_data(user_id: int, start: date, end: date, db) -> dict:
    """Build complete weekly report data for a user."""

    # 1. Weekly expenses
    expenses = (
        db.query(Expense)
        .filter(Expense.user_id == user_id, Expense.date >= start, Expense.date <= end)
        .all()
    )

    total_expenses = sum(abs(e.amount) for e in expenses if not e.is_income)
    transaction_count = sum(1 for e in expenses if not e.is_income)

    # 2. Monthly accumulated
    today = date.today()
    month_start = date(today.year, today.month, 1)
    monthly_expenses = (
        db.query(Expense)
        .filter(Expense.user_id == user_id, Expense.date >= month_start, Expense.date <= today)
        .all()
    )
    monthly_accumulated = sum(abs(e.amount) for e in monthly_expenses if not e.is_income)

    # 3. Category breakdown
    by_cat = defaultdict(lambda: {"total": 0.0, "name": ""})
    for e in expenses:
        if e.is_income:
            continue
        cat_name = "Sin categoría"
        if e.category_id:
            cat = db.query(Category).filter(Category.id == e.category_id).first()
            if cat:
                cat_name = cat.name
                if cat.parent_id:
                    parent = db.query(Category).filter(Category.id == cat.parent_id).first()
                    if parent:
                        cat_name = f"{parent.name} > {cat.name}"
        by_cat[e.category_id or 0]["total"] += abs(e.amount)
        by_cat[e.category_id or 0]["name"] = cat_name

    categories = sorted(by_cat.values(), key=lambda x: x["total"], reverse=True)[:5]

    # 4. Upcoming expenses (next week only)
    next_start, next_end = _get_next_week_range()
    upcoming = (
        db.query(ScheduledExpense)
        .filter(
            ScheduledExpense.user_id == user_id,
            ScheduledExpense.status == "PENDING",
            ScheduledExpense.scheduled_date >= next_start,
            ScheduledExpense.scheduled_date <= next_end,
        )
        .order_by(ScheduledExpense.scheduled_date)
        .all()
    )

    upcoming_expenses = []
    for exp in upcoming:
        cat_name = ""
        if exp.category_id:
            cat = db.query(Category).filter(Category.id == exp.category_id).first()
            if cat:
                cat_name = cat.name
        upcoming_expenses.append({
            "date": exp.scheduled_date.strftime("%d/%m"),
            "description": (exp.description or "")[:30],
            "amount": abs(exp.amount),
            "category": cat_name,
        })

    # 5. Top 10 expenses
    top_expenses = sorted(
        [e for e in expenses if not e.is_income],
        key=lambda e: abs(e.amount),
        reverse=True,
    )[:10]

    top_expenses_data = []
    for e in top_expenses:
        cat_name = "Sin categoría"
        if e.category_id:
            cat = db.query(Category).filter(Category.id == e.category_id).first()
            if cat:
                cat_name = cat.name
        top_expenses_data.append({
            "date": e.date.strftime("%d/%m"),
            "description": (e.description or "")[:25],
            "amount": abs(e.amount),
            "category": cat_name[:12],
        })

    report_data = {
        "week_start": start.strftime("%d/%m"),
        "week_end": end.strftime("%d/%m/%Y"),
        "total_expenses": total_expenses,
        "monthly_accumulated": monthly_accumulated,
        "transaction_count": transaction_count,
        "categories": categories,
        "upcoming_expenses": upcoming_expenses,
        "top_expenses": top_expenses_data,
    }

    # 6. Generate LLM analysis
    llm_analysis = _generate_weekly_llm_analysis(report_data)
    if llm_analysis:
        report_data["llm_analysis"] = llm_analysis

    return report_data


@celery_app.task(name="app.tasks.weekly_summary.send_weekly_reports")
def send_weekly_reports():
    """
    Send weekly report images via Telegram.
    Runs every Sunday at 20:00 UTC-3 (23:00 UTC).
    """
    db = SessionLocal()
    try:
        start, end = _get_week_range()

        # Get all users with Telegram connected
        users = db.query(User).filter(User.telegram_chat_id.isnot(None)).all()

        sent_count = 0
        for user in users:
            # Check if weekly summary is enabled (default: True)
            setting = (
                db.query(Setting)
                .filter(Setting.key == f"{user.id}:weekly_summary_enabled")
                .first()
            )
            if setting and setting.value.lower() in ("false", "0", "no"):
                continue

            try:
                # Build report data
                report_data = _build_weekly_report_data(user.id, start, end, db)

                # Generate PNG image
                from app.services.weekly_report import generate_weekly_report_image
                png_bytes = generate_weekly_report_image(report_data)

                # Build caption
                total = report_data.get("total_expenses", 0)
                accumulated = report_data.get("monthly_accumulated", 0)
                count = report_data.get("transaction_count", 0)
                month_name = MONTHS_ES.get(date.today().month, "")
                llm = report_data.get("llm_analysis", {})

                caption = (
                    f"📊 *Resumen Semanal — NikoFin*\n"
                    f"📅 Semana del {start.strftime('%d/%m')} al {end.strftime('%d/%m/%Y')}\n\n"
                    f"💰 Gasto semanal: *${total:,.0f}*\n"
                    f"📈 Acumulado mes: *${accumulated:,.0f}*\n"
                    f"📋 Transacciones: *{count}*"
                )

                if llm and llm.get("summary"):
                    caption += f"\n\n🤖 {llm['summary'][:150]}"

                if llm and llm.get("tip"):
                    caption += f"\n\n💡 {llm['tip']}"

                # Send via Telegram
                from app.telegram_bot import send_photo_to_chat
                send_photo_to_chat(user.telegram_chat_id, png_bytes, caption)
                sent_count += 1
                print(f"[WEEKLY REPORT] Sent report to user {user.id}")

            except Exception as e:
                print(f"[WEEKLY REPORT] Error sending to user {user.id}: {e}")
                continue

        print(f"[WEEKLY REPORT] Sent {sent_count} weekly reports")
    except Exception as e:
        print(f"[WEEKLY REPORT] Error: {e}")
        db.rollback()
    finally:
        db.close()


# Keep old function name for backward compatibility
@celery_app.task(name="app.tasks.weekly_summary.send_weekly_summaries")
def send_weekly_summaries():
    """Legacy function - redirects to send_weekly_reports."""
    send_weekly_reports()
