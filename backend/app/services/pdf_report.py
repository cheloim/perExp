"""PDF report generation for monthly analysis using WeasyPrint + matplotlib."""

import base64
import io
import os
import re
from calendar import monthrange
from datetime import date

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
from jinja2 import Environment, FileSystemLoader
from weasyprint import HTML

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

MONTHS_ES = {
    1: "Enero", 2: "Febrero", 3: "Marzo", 4: "Abril",
    5: "Mayo", 6: "Junio", 7: "Julio", 8: "Agosto",
    9: "Septiembre", 10: "Octubre", 11: "Noviembre", 12: "Diciembre",
}

CHART_COLORS = [
    "#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6",
    "#06b6d4", "#ec4899", "#14b8a6", "#f97316", "#64748b",
]

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


def _hex_to_rgb(hex_color: str) -> tuple:
    h = hex_color.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def _fmt(amount: float) -> str:
    return f"${amount:,.2f}"


def _img_to_base64(png_bytes: bytes) -> str:
    return base64.b64encode(png_bytes).decode("utf-8")


# ---------------------------------------------------------------------------
# Matplotlib chart generators
# ---------------------------------------------------------------------------

def _create_pie_chart(categories: list[dict], total: float) -> bytes:
    if not categories or total == 0:
        return b""

    labels, sizes, colors = [], [], []
    for cat in categories[:8]:
        pct = cat["total"] / total
        if pct < 0.02:
            continue
        labels.append(cat["name"][:18])
        sizes.append(cat["total"])
        r, g, b = _hex_to_rgb(cat.get("color", "#6b7280"))
        colors.append((r / 255, g / 255, b / 255))

    shown = sum(sizes)
    if shown < total * 0.98:
        labels.append("Otros")
        sizes.append(total - shown)
        colors.append((0.75, 0.75, 0.75))

    if not sizes:
        return b""

    fig, (ax_pie, ax_leg) = plt.subplots(1, 2, figsize=(6.5, 2.8),
                                          gridspec_kw={"width_ratios": [1, 1]})
    fig.patch.set_facecolor("white")

    wedges, _, autotexts = ax_pie.pie(
        sizes, labels=None,
        autopct=lambda p: f"{p:.0f}%" if p > 4 else "",
        colors=colors, startangle=90, pctdistance=0.72,
        wedgeprops={"linewidth": 1.5, "edgecolor": "white"},
    )
    for t in autotexts:
        t.set_fontsize(7)
        t.set_color("white")
        t.set_fontweight("bold")

    centre = plt.Circle((0, 0), 0.50, fc="white", ec="none")
    ax_pie.add_artist(centre)
    ax_pie.text(0, 0, _fmt(total), ha="center", va="center",
                fontsize=10, fontweight="bold", color="#374151")
    ax_pie.set_aspect("equal")

    ax_leg.axis("off")
    for i, (label, size, color) in enumerate(zip(labels, sizes, colors)):
        y = 1.0 - i * (1.0 / max(len(labels), 1))
        pct = (size / total * 100) if total > 0 else 0
        ax_leg.add_patch(plt.Rectangle((0.02, y - 0.04), 0.06, 0.06,
                                       facecolor=color, edgecolor="none",
                                       transform=ax_leg.transAxes))
        ax_leg.text(0.12, y, label, fontsize=7.5, va="center", color="#374151",
                    transform=ax_leg.transAxes)
        ax_leg.text(0.70, y, _fmt(size), fontsize=6.5, va="center", ha="right",
                    color="#6b7280", transform=ax_leg.transAxes)
        ax_leg.text(0.88, y, f"{pct:.0f}%", fontsize=6.5, va="center", ha="right",
                    color="#9ca3af", transform=ax_leg.transAxes)

    plt.tight_layout(pad=0.3)
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=160, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    return buf.getvalue()


def _create_bar_comparison(data: list[dict]) -> bytes:
    if not data:
        return b""

    labels = [d["name"][:14] for d in data]
    current = [d["total"] for d in data]
    previous = [d["previous"] for d in data]

    fig, ax = plt.subplots(figsize=(6.5, 3))
    fig.patch.set_facecolor("white")
    ax.set_facecolor("white")

    x = range(len(labels))
    width = 0.35
    mx = max(max(current), max(previous)) or 1

    ax.bar([i - width / 2 for i in x], current, width, label="Este mes",
           color="#6366f1", alpha=0.9, edgecolor="white", linewidth=0.5, zorder=3)
    ax.bar([i + width / 2 for i in x], previous, width, label="Mes anterior",
           color="#d1d5db", edgecolor="white", linewidth=0.5, zorder=3)

    for bar in ax.patches[:len(current)]:
        h = bar.get_height()
        if h > 0:
            ax.text(bar.get_x() + bar.get_width() / 2, h + mx * 0.02,
                    f"${h:,.0f}", ha="center", va="bottom", fontsize=5.5, color="#6b7280")

    ax.set_xticks(list(x))
    ax.set_xticklabels(labels, fontsize=6.5, rotation=20, ha="right")
    ax.yaxis.set_major_formatter(mticker.FuncFormatter(lambda v, _: f"${v:,.0f}"))
    ax.tick_params(axis="y", labelsize=6.5)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.legend(fontsize=7, loc="upper right")
    ax.grid(axis="y", alpha=0.3, zorder=0)

    plt.tight_layout(pad=0.3)
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=160, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    return buf.getvalue()


def _create_trend_chart(trend: list[dict]) -> bytes:
    if not trend:
        return b""

    months, expenses, incomes = [], [], []
    for t in trend:
        y_t, m_t = t["month"].split("-")
        m_name = MONTHS_ES.get(int(m_t), m_t)[:3]
        months.append(f"{m_name}\n{y_t}")
        expenses.append(t["expenses"])
        incomes.append(t["income"])

    fig, ax = plt.subplots(figsize=(6.5, 2.5))
    fig.patch.set_facecolor("white")
    ax.set_facecolor("white")

    x = range(len(months))
    ax.plot(x, expenses, marker="o", color="#ef4444", linewidth=2, markersize=5, label="Gastos", zorder=3)
    ax.plot(x, incomes, marker="o", color="#22c55e", linewidth=2, markersize=5, label="Ingresos", zorder=3)
    ax.fill_between(x, expenses, alpha=0.06, color="#ef4444")
    ax.fill_between(x, incomes, alpha=0.06, color="#22c55e")

    for i, (e, inc) in enumerate(zip(expenses, incomes)):
        mx = max(expenses) or 1
        ax.text(i, e + mx * 0.04, f"${e:,.0f}", ha="center", fontsize=5.5, color="#ef4444")
        ax.text(i, inc + mx * 0.04, f"${inc:,.0f}", ha="center", fontsize=5.5, color="#22c55e")

    ax.set_xticks(list(x))
    ax.set_xticklabels(months, fontsize=6.5)
    ax.yaxis.set_major_formatter(mticker.FuncFormatter(lambda v, _: f"${v:,.0f}"))
    ax.tick_params(axis="y", labelsize=6.5)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.legend(fontsize=7, loc="upper left")
    ax.grid(axis="y", alpha=0.3, zorder=0)

    plt.tight_layout(pad=0.3)
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=160, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Main PDF generator
# ---------------------------------------------------------------------------

def generate_pdf(report_data: dict, user_name: str) -> bytes:
    """Generate PDF report using WeasyPrint + Jinja2 template."""
    # Generate charts
    pie_b64 = ""
    all_cats = report_data.get("all_categories", [])
    if all_cats and report_data["total_expenses"] > 0:
        pie_png = _create_pie_chart(all_cats, report_data["total_expenses"])
        if pie_png:
            pie_b64 = _img_to_base64(pie_png)

    bar_b64 = ""
    cat_comp = report_data.get("category_comparison", [])
    if cat_comp:
        bar_png = _create_bar_comparison(cat_comp)
        if bar_png:
            bar_b64 = _img_to_base64(bar_png)

    trend_b64 = ""
    trend = report_data.get("trend_history", [])
    if trend:
        trend_png = _create_trend_chart(trend)
        if trend_png:
            trend_b64 = _img_to_base64(trend_png)

    # Format amounts but keep raw values for filtering
    def _fmt_list(items, key="total"):
        return [{**item, f"{key}_raw": item[key], key: _fmt(item[key])} for item in items]

    # Build template context
    month_str = report_data["month"]
    y, m = int(month_str[:4]), int(month_str[5:7])

    mom_change = report_data["mom_change"]
    mom_color_class = "kpi-green" if mom_change <= 0 else "kpi-red"
    mom_arrow = "↓" if mom_change < 0 else "↑" if mom_change > 0 else "→"
    mom_label = "Gastaste menos" if mom_change < 0 else "Gastaste más" if mom_change > 0 else "Sin cambio"

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
        "pie_chart_b64": pie_b64,
        "bar_chart_b64": bar_b64,
        "trend_chart_b64": trend_b64,
        "top_expenses": _fmt_list(report_data.get("top_expenses", []), "amount"),
        "accounts_summary": _fmt_list(report_data.get("accounts_summary", [])),
        "cards_summary": _fmt_list(report_data.get("cards_summary", [])),
        "future_installments": _fmt_list(report_data.get("future_installments", []), "amount"),
        "future_installments_count": report_data.get("future_installments_count", 0),
        "future_installments_total": _fmt(report_data.get("future_installments_total", 0)),
        "analysis": analysis,
    }

    # Render template
    template_dir = os.path.dirname(os.path.abspath(__file__))
    env = Environment(loader=FileSystemLoader(template_dir))
    template = env.get_template("report_template.html")
    html_content = template.render(**context)

    # Generate PDF
    pdf_bytes = HTML(string=html_content).write_pdf()
    return pdf_bytes
