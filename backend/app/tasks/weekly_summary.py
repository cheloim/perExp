from datetime import date, timedelta
from calendar import monthrange
from collections import defaultdict

from app.celery_app import celery_app
from app.database import SessionLocal
from app.models import Category, Expense, Setting, User


def _get_week_range():
    """Get the date range for the past week (Monday to Sunday)."""
    today = date.today()
    # Go back to last Monday
    start = today - timedelta(days=today.weekday() + 7)
    end = start + timedelta(days=6)
    return start, end


def _format_currency(amount: float) -> str:
    """Format amount as Argentine peso."""
    return f"${amount:,.2f}".replace(",", ".")


def _build_weekly_summary_text(user_id: int, start: date, end: date, db) -> str:
    """Build the weekly summary message text."""
    expenses = (
        db.query(Expense)
        .filter(Expense.user_id == user_id, Expense.date >= start, Expense.date <= end)
        .all()
    )

    if not expenses:
        return (
            f"📊 *Resumen Semanal*\n"
            f"📅 {start.strftime('%d/%m')} - {end.strftime('%d/%m/%Y')}\n\n"
            f"¡No hubo gastos esta semana! 🎉"
        )

    total_expenses = sum(abs(e.amount) for e in expenses if not e.is_income)
    total_income = sum(abs(e.amount) for e in expenses if e.is_income)
    count = sum(1 for e in expenses if not e.is_income)

    # Top categories
    by_cat = defaultdict(float)
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
        by_cat[cat_name] += abs(e.amount)

    top_categories = sorted(by_cat.items(), key=lambda x: x[1], reverse=True)[:5]

    lines = [
        f"📊 *Resumen Semanal*",
        f"📅 {start.strftime('%d/%m')} - {end.strftime('%d/%m/%Y')}",
        "",
        f"💰 *Gastos:* {_format_currency(total_expenses)} ({count} transacciones)",
    ]

    if total_income > 0:
        savings = total_income - total_expenses
        lines.append(f"💵 *Ingresos:* {_format_currency(total_income)}")
        lines.append(f"🏦 *Ahorro:* {_format_currency(savings)}")

    lines.append("")
    lines.append("📂 *Top categorías:*")

    for cat_name, cat_total in top_categories:
        pct = (cat_total / total_expenses * 100) if total_expenses > 0 else 0
        lines.append(f"  • {cat_name}: {_format_currency(cat_total)} ({pct:.0f}%)")

    return "\n".join(lines)


@celery_app.task(name="app.tasks.weekly_summary.send_weekly_summaries")
def send_weekly_summaries():
    """
    Send weekly summary to all users with Telegram connected and summary enabled.
    Runs every Sunday at 20:00 (configurable via settings).
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

            text = _build_weekly_summary_text(user.id, start, end, db)

            # Send via Telegram
            from app.telegram_bot import send_message_to_chat

            send_message_to_chat(user.telegram_chat_id, text)
            sent_count += 1

        db.commit()
        print(f"[WEEKLY SUMMARY] Sent {sent_count} weekly summaries")
    except Exception as e:
        print(f"[WEEKLY SUMMARY] Error: {e}")
        db.rollback()
    finally:
        db.close()
