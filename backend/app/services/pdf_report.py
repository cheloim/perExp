"""Report generation for monthly analysis using Playwright + Chart.js (PNG output)."""

import json
import os
import re
from datetime import date

from jinja2 import Environment, FileSystemLoader
from playwright.sync_api import sync_playwright

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

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

_EMOJI_RE = re.compile(  # lgtm[py/overly-large-range]
    "["
    "\U0001f600-\U0001f64f"
    "\U0001f300-\U0001f5ff"
    "\U0001f680-\U0001f6ff"
    "\U0001f1e0-\U0001f1ff"
    "\U0001f900-\U0001f9ff"
    "\U0001fa00-\U0001faff"
    "\U00002702-\U000027b0"
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
    """Build Chart.js doughnut data for category distribution with vivid colors."""
    labels, values, colors = [], [], []
    # Vivid color palette - unique for category doughnut
    vivid_palette = [
        "#8b5cf6",
        "#06b6d4",
        "#f43f5e",
        "#f97316",
        "#14b8a6",
        "#ec4899",
        "#eab308",
        "#6366f1",
    ]
    for i, cat in enumerate(categories[:8]):
        pct = cat["total"] / total if total > 0 else 0
        if pct < 0.02:
            continue
        labels.append(cat["name"][:20])
        values.append(round(cat["total"], 2))
        colors.append(vivid_palette[i % len(vivid_palette)])

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
    """Build Chart.js bar data for daily spending pattern with vivid colors."""
    labels = [p["day"] for p in pattern]
    values = [round(p["total"], 2) for p in pattern]
    mx = max(values) if values else 1
    # Cyan palette - unique for daily bar
    colors = ["#06b6d4" if v == mx else "#a5f3fc" for v in values]
    return {"labels": labels, "values": values, "colors": colors}


def _build_trends_bar_data(trends: list[dict]) -> dict:
    """Build Chart.js horizontal bar data for category trends with vivid colors."""
    top = [t for t in trends if abs(t.get("change_pct", 0)) > 0][:5]
    if not top:
        return {"labels": [], "values": [], "colors": []}
    labels = [t["name"][:16] for t in top]
    values = [round(t["change_pct"], 1) for t in top]
    # Emerald for positive, rose for negative - unique for trends
    colors = ["#10b981" if v > 0 else "#f43f5e" for v in values]
    return {"labels": labels, "values": values, "colors": colors}


def _build_velocity_data(velocity: dict) -> dict:
    """Build Chart.js bar data for spending velocity."""
    return {
        "current_daily": round(velocity.get("current_daily", 0), 2),
        "previous_daily": round(velocity.get("previous_daily", 0), 2),
    }


def _build_weekend_data(weekend_total: float, weekday_total: float) -> dict:
    """Build Chart.js doughnut data for weekend vs weekday spending."""
    total = weekend_total + weekday_total
    if total == 0:
        return {"labels": [], "values": [], "colors": []}
    return {
        "labels": ["Fin de Semana", "Dias de Semana"],
        "values": [round(weekend_total, 2), round(weekday_total, 2)],
        "colors": ["#f97316", "#06b6d4"],  # Orange for weekend, cyan for weekday
    }


def _build_account_doughnut_data(accounts: list[dict], cards: list[dict]) -> dict:
    """Build Chart.js doughnut data for account/card consumption with vivid colors."""
    labels, values, colors = [], [], []
    # Orange/amber palette - unique for account doughnut
    account_palette = [
        "#f97316",
        "#f59e0b",
        "#ef4444",
        "#ec4899",
        "#8b5cf6",
        "#06b6d4",
        "#14b8a6",
        "#6366f1",
    ]
    idx = 0

    # Use cards data (which has actual spending)
    for c in cards:
        total_val = c.get("total_raw", 0) or c.get("total", 0)
        if isinstance(total_val, str):
            total_val = float(total_val.replace("$", "").replace(",", "")) if total_val else 0
        if total_val > 0:
            labels.append(f"{c['name']} {c.get('bank', '')}".strip()[:20])
            values.append(round(total_val, 2))
            colors.append(account_palette[idx % len(account_palette)])
            idx += 1

    return {"labels": labels, "values": values, "colors": colors}


def _build_polar_area_data(accounts: list[dict], cards: list[dict]) -> dict:
    """Build Chart.js polar area data for account/card consumption."""
    labels, values = [], []

    # Add accounts
    for a in accounts:
        total_val = a.get("total_raw", 0) or a.get("total", 0)
        if isinstance(total_val, str):
            total_val = float(total_val.replace("$", "").replace(",", "")) if total_val else 0
        if total_val > 0:
            labels.append(a["name"][:20])
            values.append(round(total_val, 2))

    # Add cards
    for c in cards:
        total_val = c.get("total_raw", 0) or c.get("total", 0)
        if isinstance(total_val, str):
            total_val = float(total_val.replace("$", "").replace(",", "")) if total_val else 0
        if total_val > 0:
            labels.append(f"{c['name']} {c.get('bank', '')}".strip()[:20])
            values.append(round(total_val, 2))

    return {"labels": labels, "values": values}


def _build_account_comparison_data(accounts: list[dict], cards: list[dict]) -> dict:
    """Build Chart.js line data for account/card spending: current vs previous month."""
    labels, current, previous = [], [], []

    # Add accounts with spending
    for a in accounts:
        total_val = a.get("total", 0)
        prev_val = a.get("previous", 0)
        if total_val > 0 or prev_val > 0:
            labels.append(a["name"][:16])
            current.append(round(total_val, 2))
            previous.append(round(prev_val, 2))

    # Add cards with spending
    for c in cards:
        total_val = c.get("total", 0)
        prev_val = c.get("previous", 0)
        if total_val > 0 or prev_val > 0:
            name = f"{c['name']} {c.get('bank', '')}".strip()[:16]
            labels.append(name)
            current.append(round(total_val, 2))
            previous.append(round(prev_val, 2))

    return {"labels": labels, "current": current, "previous": previous}


# ---------------------------------------------------------------------------
# Main image generator
# ---------------------------------------------------------------------------


def generate_report_image(report_data: dict, user_name: str) -> bytes:
    """Generate PNG report image using Playwright + Chart.js + Jinja2."""

    # Build Chart.js data
    all_cats = report_data.get("all_categories", [])
    doughnut_data = (
        _build_doughnut_data(all_cats, report_data["total_expenses"]) if all_cats else None
    )

    cat_comp = report_data.get("category_comparison", [])
    category_bar_data = _build_category_bar_data(cat_comp) if cat_comp else None

    trend = report_data.get("trend_history", [])
    trend_data = _build_trend_data(trend) if trend else None

    daily = report_data.get("daily_pattern", [])
    daily_data = _build_daily_data(daily) if daily else None

    cat_trends = report_data.get("category_trends", [])
    trends_bar_data = _build_trends_bar_data(cat_trends) if cat_trends else None

    # Account/Card doughnut data
    accounts = report_data.get("accounts_summary", [])
    cards = report_data.get("cards_summary", [])
    account_doughnut_data = _build_account_doughnut_data(accounts, cards)

    # Polar area data for account/card consumption
    polar_area_data = _build_polar_area_data(accounts, cards)

    # Account comparison data (current vs previous month)
    account_comparison_data = _build_account_comparison_data(accounts, cards)

    # Investment doughnut data
    investment_doughnut_data = report_data.get("investment_doughnut_data")

    # Spending velocity data
    velocity_data = report_data.get("velocity_data")
    velocity_chart_data = _build_velocity_data(velocity_data) if velocity_data else None

    # Weekend vs weekday data
    weekend_data = report_data.get("weekend_data")
    weekend_chart_data = (
        _build_weekend_data(
            weekend_data.get("weekend", 0) if weekend_data else 0,
            weekend_data.get("weekday", 0) if weekend_data else 0,
        )
        if weekend_data
        else None
    )

    # Format amounts
    def _fmt_list(items, key="total"):
        return [{**item, f"{key}_raw": item[key], key: _fmt(item[key])} for item in items]

    month_str = report_data["month"]
    y, m = int(month_str[:4]), int(month_str[5:7])

    mom_change = report_data["mom_change"]
    mom_color_class = "kpi-green" if mom_change <= 0 else "kpi-red"
    mom_arrow = "\u2193" if mom_change < 0 else "\u2191" if mom_change > 0 else "\u2192"
    mom_label = (
        "Gastaste menos" if mom_change < 0 else "Gastaste mas" if mom_change > 0 else "Sin cambio"
    )

    last_year_total = report_data.get("last_year_total", 0)
    last_year_change = 0.0
    if last_year_total > 0:
        last_year_change = (
            (report_data["total_expenses"] - last_year_total) / last_year_total
        ) * 100
    last_year_arrow = (
        "\u2191" if last_year_change > 0 else "\u2193" if last_year_change < 0 else "\u2192"
    )
    last_year_label = (
        f"{last_year_arrow} {abs(last_year_change):.1f}%" if last_year_total > 0 else ""
    )

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
        "mom_change": mom_change,
        "mom_change_display": f"{mom_arrow} {abs(mom_change)}%",
        "mom_color_class": mom_color_class,
        "mom_label": mom_label,
        "last_year_total": _fmt(last_year_total) if last_year_total > 0 else None,
        "last_year_label": last_year_label,
        "last_year_change": last_year_change,
        "doughnut_data": json.dumps(doughnut_data) if doughnut_data else "null",
        "category_bar_data": json.dumps(category_bar_data) if category_bar_data else "null",
        "account_doughnut_data": json.dumps(account_doughnut_data)
        if account_doughnut_data
        else "null",
        "investment_doughnut_data": json.dumps(investment_doughnut_data)
        if investment_doughnut_data
        else "null",
        "polar_area_data": json.dumps(polar_area_data) if polar_area_data else "null",
        "account_comparison_data": json.dumps(account_comparison_data)
        if account_comparison_data
        else "null",
        "total_expenses_num": report_data["total_expenses"],
        "previous_total_num": report_data.get("previous_total", 0),
        "trend_data": json.dumps(trend_data) if trend_data else "null",
        "daily_data": json.dumps(daily_data) if daily_data else "null",
        "trends_bar_data": json.dumps(trends_bar_data) if trends_bar_data else "null",
        "velocity_data": json.dumps(velocity_chart_data) if velocity_chart_data else "null",
        "weekend_data": json.dumps(weekend_chart_data) if weekend_chart_data else "null",
        "top_expenses": _fmt_list(report_data.get("top_expenses", []), "amount"),
        "top_expenses_detail": report_data.get("top_expenses", [])[:5],
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

    # Generate PNG image with Playwright
    with sync_playwright() as p:
        browser = p.chromium.launch(
            args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"]
        )
        page = browser.new_page(
            viewport={"width": 1080, "height": 1600},
            device_scale_factor=2,  # Retina quality
        )
        page.set_content(html_content, wait_until="networkidle")
        page.emulate_media(media="screen")
        page.wait_for_timeout(2000)

        # Take screenshot of the full page
        png_bytes = page.screenshot(full_page=True, type="png", timeout=60000)
        browser.close()

    return png_bytes
