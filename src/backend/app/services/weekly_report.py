"""Weekly report generation for Telegram using Playwright + Chart.js."""

import os
from datetime import date

import emoji
from jinja2 import Environment, FileSystemLoader
from playwright.sync_api import sync_playwright

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


def _fmt(amount: float) -> str:
    return f"${amount:,.2f}"


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
                "amount": _fmt(exp.get("amount", 0)),
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
                "amount": _fmt(exp.get("amount", 0)),
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
                "amount": _fmt(rec.get("amount", 0)),
                "next_date": rec.get("next_date", ""),
                "days_until": rec.get("days_until", 0),
            }
        )

    context = {
        "week_start": week_start,
        "week_end": week_end,
        "month_name": month_name,
        "year": year,
        "total_expenses": _fmt(total_expenses),
        "monthly_accumulated": _fmt(report_data.get("monthly_accumulated", 0)),
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

    # Render Jinja2 template
    template_dir = os.path.dirname(os.path.abspath(__file__))
    env = Environment(loader=FileSystemLoader(template_dir))
    template = env.get_template("report_template_weekly.html")
    html_content = template.render(**context)

    # Generate PNG image with Playwright
    with sync_playwright() as p:
        browser = p.chromium.launch(
            args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"]
        )
        page = browser.new_page(
            viewport={"width": 800, "height": 600},
            device_scale_factor=2,  # Retina quality
        )
        page.set_content(html_content, wait_until="networkidle")
        page.emulate_media(media="screen")

        # Get actual content height and resize viewport
        content_height = page.evaluate("document.body.scrollHeight")
        page.set_viewport_size({"width": 800, "height": content_height})

        # Take screenshot of the full page
        png_bytes = page.screenshot(full_page=True, type="png", timeout=60000)
        browser.close()

    return png_bytes
