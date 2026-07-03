"""Weekly report generation for Telegram using Playwright + Chart.js."""

import os
import re
from datetime import date

from jinja2 import Environment, FileSystemLoader
from playwright.sync_api import sync_playwright

MONTHS_ES = {
    1: "Enero", 2: "Febrero", 3: "Marzo", 4: "Abril",
    5: "Mayo", 6: "Junio", 7: "Julio", 8: "Agosto",
    9: "Septiembre", 10: "Octubre", 11: "Noviembre", 12: "Diciembre",
}

_EMOTICON_RE = re.compile(
    "["
    "\U0001F600-\U0001F64F"
    "\U0001F300-\U0001F5FF"
    "\U0001F680-\U0001F6FF"
    "\U0001F1E0-\U0001F1FF"
    "\U00002702-\U000027B0"
    "\U000024C2-\U0001F251"
    "\U0001f926-\U0001f937"
    "\U00010000-\U0010ffff"
    "]+",
    flags=re.UNICODE,
)


def _strip_emojis(text: str) -> str:
    return _EMOTICON_RE.sub("", text).strip()


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
        categories_with_pct.append({
            "name": cat["name"][:16],
            "total": _fmt(cat_total),
            "pct": pct,
        })

    # Upcoming expenses
    upcoming = report_data.get("upcoming_expenses", [])
    upcoming_total = sum(exp.get("amount", 0) for exp in upcoming)
    upcoming_formatted = []
    for exp in upcoming[:5]:
        upcoming_formatted.append({
            "date": exp.get("date", ""),
            "description": exp.get("description", "")[:30],
            "amount": _fmt(exp.get("amount", 0)),
        })

    # Top 10 expenses
    top_expenses = report_data.get("top_expenses", [])
    top_formatted = []
    for exp in top_expenses[:10]:
        top_formatted.append({
            "date": exp.get("date", ""),
            "description": exp.get("description", "")[:25],
            "category": exp.get("category", "")[:12],
            "amount": _fmt(exp.get("amount", 0)),
        })

    # LLM Analysis
    llm_analysis = report_data.get("llm_analysis")
    if llm_analysis:
        llm_analysis = {k: _strip_emojis(v) if isinstance(v, str) else v for k, v in llm_analysis.items()}

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
    }

    # Render Jinja2 template
    template_dir = os.path.dirname(os.path.abspath(__file__))
    env = Environment(loader=FileSystemLoader(template_dir))
    template = env.get_template("report_template_weekly.html")
    html_content = template.render(**context)

    # Generate PNG image with Playwright
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--no-sandbox", "--disable-dev-shm-usage"])
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
        png_bytes = page.screenshot(full_page=True, type="png")
        browser.close()

    return png_bytes
