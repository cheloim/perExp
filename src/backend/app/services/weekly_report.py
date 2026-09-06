"""Weekly report generation for Telegram using Playwright + Chart.js."""

from datetime import date

import emoji

from app.services.report_renderer import render_report_image

MONTHS_ES = {
    1: "Enero",
    2: "Febrero",
    3: "Marzo",
    4: "Abril",
    5: "Mayo",
    6: "Junio",
    7: "Julio",
    8: "Agosto",
    9: "Septiembre",
    10: "Octubre",
    11: "Noviembre",
    12: "Diciembre",
}


def _strip_emojis(text: str) -> str:
    return emoji.replace_emoji(text, "").strip()


def _fmt(amount: float, currency: str = "ARS") -> str:
    if currency == "USD":
        return f"USD {amount:,.2f}"
    return f"${amount:,.2f}"


def _fmt_total(by_currency: dict[str, float] | None, fallback: float) -> str:
    """Format totals per currency: '$123 + USD 45.67' or just '$123'."""
    if not by_currency:
        return _fmt(fallback)
    parts = []
    for cur in ["ARS", "USD"]:
        amt = by_currency.get(cur, 0)
        if amt > 0:
            parts.append(_fmt(amt, cur))
    return " + ".join(parts) if parts else _fmt(fallback)


def generate_weekly_report_image(report_data: dict) -> bytes:
    """Generate PNG report image for weekly Telegram report."""

    # Build context for template
    week_start = report_data.get("week_start", "")
    week_end = report_data.get("week_end", "")
    month_name = MONTHS_ES.get(date.today().month, "")
    year = date.today().year

    # Category data
    categories = report_data.get("categories", [])
    total_expenses = report_data.get("total_expenses", 0)

    # Calculate percentages
    categories_with_pct = []
    for cat in categories[:5]:
        cat_total = cat.get("total", 0)
        pct = round((cat_total / total_expenses * 100) if total_expenses > 0 else 0, 1)
        categories_with_pct.append(
            {
                "name": cat["name"][:16],
                "total": _fmt(cat_total),
                "pct": pct,
            }
        )

    # Upcoming expenses
    upcoming = report_data.get("upcoming_expenses", [])
    upcoming_total = sum(exp.get("amount", 0) for exp in upcoming)
    upcoming_formatted = []
    for exp in upcoming[:5]:
        upcoming_formatted.append(
            {
                "date": exp.get("date", ""),
                "description": exp.get("description", "")[:30],
                "amount": _fmt(exp.get("amount", 0), exp.get("currency", "ARS")),
            }
        )

    # Top 10 expenses
    top_expenses = report_data.get("top_expenses", [])
    top_formatted = []
    for exp in top_expenses[:10]:
        top_formatted.append(
            {
                "date": exp.get("date", ""),
                "description": exp.get("description", "")[:25],
                "category": exp.get("category", "")[:12],
                "amount": _fmt(exp.get("amount", 0), exp.get("currency", "ARS")),
            }
        )

    # LLM Analysis
    llm_analysis = report_data.get("llm_analysis")
    if llm_analysis:
        llm_analysis = {
            k: _strip_emojis(v) if isinstance(v, str) else v for k, v in llm_analysis.items()
        }

    # Budget data (warnings only)
    budgets = report_data.get("budgets", [])
    budget_items = []
    for b in budgets[:5]:
        budget_items.append(
            {
                "category_name": b.get("category_name", "")[:20],
                "budget_amount": _fmt(b.get("budget_amount", 0)),
                "spent": _fmt(b.get("spent", 0)),
                "percentage": b.get("percentage", 0),
                "status": b.get("status", "warning"),
            }
        )

    # Budget events
    budget_events = report_data.get("budget_events", [])
    event_items = []
    for ev in budget_events[:3]:
        event_items.append(
            {
                "name": ev.get("name", "")[:25],
                "total_amount": _fmt(ev.get("total_amount", 0)),
                "spent": _fmt(ev.get("spent", 0)),
                "remaining": _fmt(ev.get("remaining", 0)),
                "end_date": ev.get("end_date", ""),
            }
        )

    # Upcoming recurring expenses
    upcoming_recurring = report_data.get("upcoming_recurring", [])
    recurring_items = []
    for rec in upcoming_recurring[:5]:
        recurring_items.append(
            {
                "description": rec.get("description", "")[:30],
                "amount": _fmt(rec.get("amount", 0), rec.get("currency", "ARS")),
                "next_date": rec.get("next_date", ""),
                "days_until": rec.get("days_until", 0),
            }
        )

    context = {
        "week_start": week_start,
        "week_end": week_end,
        "month_name": month_name,
        "year": year,
        "total_expenses": _fmt_total(report_data.get("total_by_currency"), total_expenses),
        "monthly_accumulated": _fmt_total(
            report_data.get("monthly_by_currency"),
            report_data.get("monthly_accumulated", 0),
        ),
        "transaction_count": report_data.get("transaction_count", 0),
        "categories": categories_with_pct,
        "upcoming_expenses": upcoming_formatted,
        "upcoming_count": len(upcoming),
        "upcoming_total": _fmt(upcoming_total),
        "top_expenses": top_formatted,
        "llm_analysis": llm_analysis,
        "budgets": budget_items,
        "budget_events": event_items,
        "upcoming_recurring": recurring_items,
        # Combined KPI: installments + recurring
        "upcoming_combined_count": report_data.get("upcoming_combined_count", len(upcoming)),
        "upcoming_combined_total": _fmt(report_data.get("upcoming_combined_total", upcoming_total)),
    }

    # Render via shared renderer
    return render_report_image("report_template_weekly.html", context)
