"""PDF report generation for monthly analysis using Playwright + Chart.js."""

import io
import json
import os
import re
from calendar import monthrange
from datetime import date

from jinja2 import Environment, FileSystemLoader
from playwright.sync_api import sync_playwright

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

MONTHS_ES = {
    1: "Enero", 2: "Febrero", 3: "Marzo", 4: "Abril",
    5: "Mayo", 6: "Junio", 7: "Julio", 8: "Agosto",
    9: "Septiembre", 10: "Octubre", 11: "Noviembre", 12: "Diciembre",
}

_EMOJI_RE = re.compile(
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
    return _EMOJI_RE.sub("", text).strip()


def _fmt(amount: float) -> str:
    return f"${amount:,.2f}"


# ---------------------------------------------------------------------------
# Chart data builders (for Chart.js)
# ---------------------------------------------------------------------------

def _build_doughnut_data(categories: list[dict], total: float) -> dict:
    """Build Chart.js doughnut data for category distribution."""
    labels, values, colors = [], [], []
    for cat in categories[:8]:
        pct = cat["total"] / total if total > 0 else 0
        if pct < 0.02:
            continue
        labels.append(cat["name"][:20])
        values.append(round(cat["total"], 2))
        colors.append(cat.get("color", "#6b7280"))

    shown = sum(values)
    if shown < total * 0.98:
        labels.append("Otros")
        values.append(round(total - shown, 2))
        colors.append("#94a3b8")

    return {"labels": labels, "values": values, "colors": colors}


def _build_category_bar_data(comparison: list[dict]) -> dict:
    """Build Chart.js bar data for category comparison with reference line."""
    labels = [c["name"][:16] for c in comparison]
    current = [round(c["total"], 2) for c in comparison]
    previous = [round(c["previous"], 2) for c in comparison]
    return {"labels": labels, "current": current, "previous": previous}


def _build_trend_data(trend: list[dict]) -> dict:
    """Build Chart.js line data for 6-month trend."""
    labels, expenses = [], []
    for t in trend:
        y_t, m_t = t["month"].split("-")
        m_name = MONTHS_ES.get(int(m_t), m_t)[:3]
        labels.append(f"{m_name} {y_t}")
        expenses.append(round(t["expenses"], 2))
    return {"labels": labels, "expenses": expenses}


def _build_daily_data(pattern: list[dict]) -> dict:
    """Build Chart.js bar data for daily spending pattern."""
    labels = [p["day"] for p in pattern]
    values = [round(p["total"], 2) for p in pattern]
    mx = max(values) if values else 1
    colors = ["#6366f1" if v == mx else "#c7d2fe" for v in values]
    return {"labels": labels, "values": values, "colors": colors}


def _build_trends_bar_data(trends: list[dict]) -> dict:
    """Build Chart.js horizontal bar data for category trends."""
    top = [t for t in trends if abs(t.get("change_pct", 0)) > 0][:5]
    if not top:
        return {"labels": [], "values": [], "colors": []}
    labels = [t["name"][:16] for t in top]
    values = [round(t["change_pct"], 1) for t in top]
    colors = ["#22c55e" if v > 0 else "#ef4444" for v in values]
    return {"labels": labels, "values": values, "colors": colors}


# ---------------------------------------------------------------------------
# Main PDF generator
# ---------------------------------------------------------------------------

def generate_pdf(report_data: dict, user_name: str) -> bytes:
    """Generate PDF report using Playwright + Chart.js + Jinja2."""

    # Build Chart.js data
    all_cats = report_data.get("all_categories", [])
    doughnut_data = _build_doughnut_data(all_cats, report_data["total_expenses"]) if all_cats else None

    cat_comp = report_data.get("category_comparison", [])
    category_bar_data = _build_category_bar_data(cat_comp) if cat_comp else None

    trend = report_data.get("trend_history", [])
    trend_data = _build_trend_data(trend) if trend else None

    daily = report_data.get("daily_pattern", [])
    daily_data = _build_daily_data(daily) if daily else None

    cat_trends = report_data.get("category_trends", [])
    trends_bar_data = _build_trends_bar_data(cat_trends) if cat_trends else None

    # Format amounts
    def _fmt_list(items, key="total"):
        return [{**item, f"{key}_raw": item[key], key: _fmt(item[key])} for item in items]

    month_str = report_data["month"]
    y, m = int(month_str[:4]), int(month_str[5:7])

    mom_change = report_data["mom_change"]
    mom_color_class = "kpi-green" if mom_change <= 0 else "kpi-red"
    mom_arrow = "\u2193" if mom_change < 0 else "\u2191" if mom_change > 0 else "\u2192"
    mom_label = "Gastaste menos" if mom_change < 0 else "Gastaste mas" if mom_change > 0 else "Sin cambio"

    last_year_total = report_data.get("last_year_total", 0)
    last_year_change = 0.0
    if last_year_total > 0:
        last_year_change = ((report_data["total_expenses"] - last_year_total) / last_year_total) * 100
    last_year_arrow = "\u2191" if last_year_change > 0 else "\u2193" if last_year_change < 0 else "\u2192"
    last_year_label = f"{last_year_arrow} {abs(last_year_change):.1f}%" if last_year_total > 0 else ""

    analysis = report_data.get("analysis")
    if analysis:
        analysis = {k: _strip_emojis(v) if isinstance(v, str) else v for k, v in analysis.items()}

    context = {
        "month_name": MONTHS_ES.get(m, str(m)),
        "year": y,
        "user_name": user_name,
        "generated_date": date.today().strftime("%d/%m/%Y"),
        "total_expenses": _fmt(report_data["total_expenses"]),
        "total_income": _fmt(report_data["total_income"]),
        "savings_rate": report_data["savings_rate"],
        "expense_count": report_data["expense_count"],
        "mom_change_display": f"{mom_arrow} {abs(mom_change)}%",
        "mom_color_class": mom_color_class,
        "mom_label": mom_label,
        "last_year_total": _fmt(last_year_total) if last_year_total > 0 else None,
        "last_year_label": last_year_label,
        "doughnut_data": json.dumps(doughnut_data) if doughnut_data else "null",
        "category_bar_data": json.dumps(category_bar_data) if category_bar_data else "null",
        "trend_data": json.dumps(trend_data) if trend_data else "null",
        "daily_data": json.dumps(daily_data) if daily_data else "null",
        "trends_bar_data": json.dumps(trends_bar_data) if trends_bar_data else "null",
        "top_expenses": _fmt_list(report_data.get("top_expenses", []), "amount"),
        "accounts_summary": _fmt_list(report_data.get("accounts_summary", [])),
        "cards_summary": _fmt_list(report_data.get("cards_summary", [])),
        "payment_methods": _fmt_list(report_data.get("payment_methods", [])),
        "future_installments": _fmt_list(report_data.get("future_installments", []), "amount"),
        "future_installments_count": report_data.get("future_installments_count", 0),
        "future_installments_total": _fmt(report_data.get("future_installments_total", 0)),
        "analysis": analysis,
    }

    # Render Jinja2 template
    template_dir = os.path.dirname(os.path.abspath(__file__))
    env = Environment(loader=FileSystemLoader(template_dir))
    template = env.get_template("report_template.html")
    html_content = template.render(**context)

    # Generate PDF with Playwright
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--no-sandbox", "--disable-dev-shm-usage"])
        page = browser.new_page(viewport={"width": 794, "height": 1123})
        page.set_content(html_content, wait_until="networkidle")
        page.emulate_media(media="screen")
        pdf_bytes = page.pdf(
            format="A4",
            margin={"top": "0", "bottom": "0", "left": "0", "right": "0"},
            print_background=True,
        )
        browser.close()

    return pdf_bytes
