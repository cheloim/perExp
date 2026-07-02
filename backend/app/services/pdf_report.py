"""PDF report generation for monthly analysis using FPDF2 + matplotlib."""

import io
import json
import re
from calendar import monthrange
from collections import defaultdict
from datetime import date

import matplotlib
matplotlib.use("Agg")  # Non-interactive backend
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
from fpdf import FPDF

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

MONTHS_ES = {
    1: "Enero", 2: "Febrero", 3: "Marzo", 4: "Abril",
    5: "Mayo", 6: "Junio", 7: "Julio", 8: "Agosto",
    9: "Septiembre", 10: "Octubre", 11: "Noviembre", 12: "Diciembre",
}

# Color palette (Tailwind-inspired)
C_PRIMARY = "#6366f1"
C_PRIMARY_RGB = (99/255, 102/255, 241/255)  # Matplotlib uses 0-1 range
C_SUCCESS = "#22c55e"
C_DANGER = "#ef4444"
C_WARNING = "#f59e0b"
C_GRAY_50 = "#f9fafb"
C_GRAY_100 = "#f3f4f6"
C_GRAY_200 = "#e5e7eb"
C_GRAY_400 = "#9ca3af"
C_GRAY_500 = "#6b7280"
C_GRAY_700 = "#374151"
C_GRAY_900 = "#111827"

# Chart color palette
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


def _fmt_currency(amount: float) -> str:
    """Format as $XX.XXX"""
    return f"${amount:,.2f}"


# ---------------------------------------------------------------------------
# Matplotlib chart generators
# ---------------------------------------------------------------------------

def _create_pie_chart(categories: list[dict], total: float) -> bytes:
    """Generate a professional pie chart as PNG bytes."""
    if not categories or total == 0:
        return b""

    # Filter and prepare data
    labels = []
    sizes = []
    colors = []
    for cat in categories[:8]:
        pct = cat["total"] / total
        if pct < 0.02:
            continue
        labels.append(cat["name"][:18])
        sizes.append(cat["total"])
        r, g, b = _hex_to_rgb(cat.get("color", "#6b7280"))
        colors.append((r / 255, g / 255, b / 255))

    # Add "Otros" if needed
    shown_total = sum(sizes)
    if shown_total < total * 0.98:
        labels.append("Otros")
        sizes.append(total - shown_total)
        colors.append((0.75, 0.75, 0.75))

    if not sizes:
        return b""

    fig, (ax_pie, ax_legend) = plt.subplots(1, 2, figsize=(7.5, 3.2),
                                             gridspec_kw={"width_ratios": [1.2, 1]})
    fig.patch.set_facecolor("white")

    # Pie chart
    wedges, texts, autotexts = ax_pie.pie(
        sizes, labels=None, autopct=lambda p: f"{p:.0f}%" if p > 4 else "",
        colors=colors, startangle=90, pctdistance=0.75,
        wedgeprops={"linewidth": 1.5, "edgecolor": "white"},
    )
    for t in autotexts:
        t.set_fontsize(7)
        t.set_color("white")
        t.set_fontweight("bold")

    # Center hole for donut effect
    centre = plt.Circle((0, 0), 0.55, fc="white", ec="none")
    ax_pie.add_artist(centre)
    ax_pie.text(0, 0, _fmt_currency(total), ha="center", va="center",
                fontsize=11, fontweight="bold", color=C_GRAY_700)
    ax_pie.set_aspect("equal")

    # Legend
    ax_legend.axis("off")
    for i, (label, size, color) in enumerate(zip(labels, sizes, colors)):
        y = 1.0 - i * (1.0 / max(len(labels), 1))
        pct = (size / total * 100) if total > 0 else 0
        ax_legend.add_patch(plt.Rectangle((0.02, y - 0.04), 0.06, 0.06,
                                          facecolor=color, edgecolor="none",
                                          transform=ax_legend.transAxes))
        ax_legend.text(0.12, y, f"{label}", fontsize=8, va="center",
                       color=C_GRAY_700, transform=ax_legend.transAxes)
        ax_legend.text(0.72, y, _fmt_currency(size), fontsize=7, va="center",
                       ha="right", color=C_GRAY_500, transform=ax_legend.transAxes)
        ax_legend.text(0.88, y, f"{pct:.0f}%", fontsize=7, va="center",
                       ha="right", color=C_GRAY_400, transform=ax_legend.transAxes)

    plt.tight_layout(pad=0.5)
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=150, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    return buf.getvalue()


def _create_bar_comparison(data: list[dict]) -> bytes:
    """Generate a grouped bar chart comparing current vs last month."""
    if not data:
        return b""

    labels = [d["name"][:14] for d in data]
    current = [d["total"] for d in data]
    previous = [d["previous"] for d in data]

    fig, ax = plt.subplots(figsize=(7, 3.5))
    fig.patch.set_facecolor("white")
    ax.set_facecolor("white")

    x = range(len(labels))
    width = 0.35

    bars1 = ax.bar([i - width / 2 for i in x], current, width, label="Este mes",
                   color=C_PRIMARY, alpha=0.9, edgecolor="white", linewidth=0.5)
    bars2 = ax.bar([i + width / 2 for i in x], previous, width, label="Mes anterior",
                   color="#d1d5db", edgecolor="white", linewidth=0.5)

    # Value labels on bars
    for bar in bars1:
        h = bar.get_height()
        if h > 0:
            ax.text(bar.get_x() + bar.get_width() / 2, h + max(current) * 0.02,
                    f"${h:,.0f}", ha="center", va="bottom", fontsize=6, color=C_GRAY_500)
    for bar in bars2:
        h = bar.get_height()
        if h > 0:
            ax.text(bar.get_x() + bar.get_width() / 2, h + max(current) * 0.02,
                    f"${h:,.0f}", ha="center", va="bottom", fontsize=6, color=C_GRAY_400)

    ax.set_xticks(list(x))
    ax.set_xticklabels(labels, fontsize=7, rotation=25, ha="right")
    ax.yaxis.set_major_formatter(mticker.FuncFormatter(lambda v, _: f"${v:,.0f}"))
    ax.tick_params(axis="y", labelsize=7)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.legend(fontsize=8, loc="upper right")
    ax.set_ylabel("Monto ($)", fontsize=8, color=C_GRAY_500)

    plt.tight_layout(pad=0.5)
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=150, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    return buf.getvalue()


def _create_trend_chart(trend: list[dict]) -> bytes:
    """Generate a 6-month trend line chart."""
    if not trend:
        return b""

    months = []
    expenses = []
    incomes = []
    for t in trend:
        y_t, m_t = t["month"].split("-")
        m_name = MONTHS_ES.get(int(m_t), m_t)[:3]
        months.append(f"{m_name}\n{y_t}")
        expenses.append(t["expenses"])
        incomes.append(t["income"])

    fig, ax = plt.subplots(figsize=(7, 3))
    fig.patch.set_facecolor("white")
    ax.set_facecolor("white")

    x = range(len(months))
    ax.plot(x, expenses, marker="o", color=C_DANGER, linewidth=2, markersize=5, label="Gastos")
    ax.plot(x, incomes, marker="o", color=C_SUCCESS, linewidth=2, markersize=5, label="Ingresos")

    # Fill between
    ax.fill_between(x, expenses, alpha=0.08, color=C_DANGER)
    ax.fill_between(x, incomes, alpha=0.08, color=C_SUCCESS)

    # Value labels
    for i, (e, inc) in enumerate(zip(expenses, incomes)):
        ax.text(i, e + max(expenses) * 0.03, f"${e:,.0f}", ha="center", fontsize=6, color=C_DANGER)
        ax.text(i, inc + max(expenses) * 0.03, f"${inc:,.0f}", ha="center", fontsize=6, color=C_SUCCESS)

    ax.set_xticks(list(x))
    ax.set_xticklabels(months, fontsize=7)
    ax.yaxis.set_major_formatter(mticker.FuncFormatter(lambda v, _: f"${v:,.0f}"))
    ax.tick_params(axis="y", labelsize=7)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.legend(fontsize=8, loc="upper left")
    ax.set_ylabel("Monto ($)", fontsize=8, color=C_GRAY_500)

    plt.tight_layout(pad=0.5)
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=150, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# PDF Class
# ---------------------------------------------------------------------------

class MonthlyReportPDF(FPDF):
    """Custom PDF class for monthly financial reports."""

    def __init__(self):
        super().__init__()
        self.set_auto_page_break(auto=True, margin=20)

    def header(self):
        if self.page_no() > 1:
            self.set_font("Helvetica", "B", 9)
            self.set_text_color(*_hex_to_rgb(C_GRAY_400))
            self.cell(0, 8, "NikoFin  -  Reporte Mensual", align="R")
            self.ln(10)

    def footer(self):
        self.set_y(-15)
        self.set_font("Helvetica", "I", 7)
        self.set_text_color(*_hex_to_rgb(C_GRAY_400))
        self.cell(0, 10, f"Pagina {self.page_no()}/{{nb}}", align="C")

    # -- Layout helpers ---------------------------------------------------

    def section_title(self, title: str):
        if self.get_y() > 250:
            self.add_page()
        self.ln(4)
        self.set_font("Helvetica", "B", 11)
        self.set_text_color(*_hex_to_rgb(C_PRIMARY))
        self.cell(0, 8, title)
        self.ln(7)
        self.set_draw_color(*_hex_to_rgb(C_PRIMARY))
        self.set_line_width(0.4)
        self.line(10, self.get_y(), 200, self.get_y())
        self.ln(4)

    def _check_page(self, needed: int = 30):
        if self.get_y() + needed > 270:
            self.add_page()

    # -- KPI row ----------------------------------------------------------

    def kpi_row(self, items: list[tuple[str, str, str]]):
        col_w = 190 / len(items)
        for label, value, color in items:
            x, y = self.get_x(), self.get_y()
            self.set_fill_color(248, 249, 250)
            self.rect(x, y, col_w - 4, 22, "F")
            self.set_font("Helvetica", "", 6)
            self.set_text_color(*_hex_to_rgb(C_GRAY_500))
            self.set_xy(x + 3, y + 2)
            self.cell(col_w - 6, 5, label.upper())
            self.set_font("Helvetica", "B", 11)
            if color == "green":
                self.set_text_color(*_hex_to_rgb(C_SUCCESS))
            elif color == "red":
                self.set_text_color(*_hex_to_rgb(C_DANGER))
            else:
                self.set_text_color(*_hex_to_rgb(C_GRAY_900))
            self.set_xy(x + 3, y + 9)
            self.cell(col_w - 6, 8, value)
            self.set_xy(x + col_w - 2, y)
        self.ln(26)

    # -- Tables -----------------------------------------------------------

    def _table_header(self, cols: list[tuple[str, int, str]]):
        """cols = [(label, width, align), ...]"""
        self.set_font("Helvetica", "B", 7)
        self.set_fill_color(*_hex_to_rgb(C_GRAY_100))
        self.set_text_color(*_hex_to_rgb(C_GRAY_500))
        for label, w, align in cols:
            self.cell(w, 7, label, border=1, fill=True, align=align)
        self.ln()
        self.set_font("Helvetica", "", 7)
        self.set_text_color(*_hex_to_rgb(C_GRAY_700))

    def _table_row(self, values: list[tuple[str, int, str, str | None]]):
        """values = [(text, width, align, color), ...]"""
        for text, w, align, color in values:
            if color:
                self.set_text_color(*_hex_to_rgb(color))
            self.cell(w, 6, text, align=align)
            if color:
                self.set_text_color(*_hex_to_rgb(C_GRAY_700))
        self.ln()

    def category_table(self, categories: list[dict]):
        if not categories:
            return
        total = sum(c["total"] for c in categories) or 1
        self._check_page(len(categories) * 6 + 20)
        self._table_header([
            ("Categoria", 75, ""), ("Monto", 30, "R"),
            ("Trans.", 20, "R"), ("%", 20, "R"),
        ])
        for cat in categories:
            pct = cat["total"] / total * 100
            self._table_row([
                (cat["name"][:35], 75, "", None),
                (_fmt_currency(cat["total"]), 30, "R", None),
                (str(cat["count"]), 20, "R", None),
                (f"{pct:.1f}%", 20, "R", C_GRAY_500),
            ])
        self.ln(4)

    def trend_table(self, trend: list[dict]):
        if not trend:
            return
        self._check_page(len(trend) * 7 + 20)
        self._table_header([
            ("Mes", 40, ""), ("Gastos", 35, "R"),
            ("Ingresos", 35, "R"), ("Balance", 35, "R"),
        ])
        for t in trend:
            y_t, m_t = t["month"].split("-")
            m_name = MONTHS_ES.get(int(m_t), m_t)[:3]
            bal = t["income"] - t["expenses"]
            bal_color = C_SUCCESS if bal >= 0 else C_DANGER
            self._table_row([
                (f"{m_name} {y_t}", 40, "", None),
                (_fmt_currency(t["expenses"]), 35, "R", None),
                (_fmt_currency(t["income"]), 35, "R", None),
                (_fmt_currency(bal), 35, "R", bal_color),
            ])
        self.ln(4)

    def top_expenses_table(self, expenses: list[dict]):
        if not expenses:
            return
        self._check_page(len(expenses) * 6 + 20)
        self._table_header([
            ("Fecha", 20, ""), ("Descripcion", 75, ""),
            ("Categoria", 40, ""), ("Monto", 30, "R"),
        ])
        for e in expenses:
            self._table_row([
                (e["date"], 20, "", None),
                (e["description"][:35], 75, "", None),
                (e["category"][:20], 40, "", None),
                (_fmt_currency(e["amount"]), 30, "R", C_DANGER),
            ])
        self.ln(4)

    def accounts_table(self, accounts: list[dict]):
        accounts = [a for a in accounts if a["total"] > 0]
        if not accounts:
            return
        self._check_page(len(accounts) * 6 + 20)
        self._table_header([
            ("Cuenta", 55, ""), ("Tipo", 30, ""),
            ("Trans.", 20, "R"), ("Monto", 35, "R"),
        ])
        for a in accounts:
            self._table_row([
                (a["name"][:28], 55, "", None),
                (a["type"], 30, "", None),
                (str(a["count"]), 20, "R", None),
                (_fmt_currency(a["total"]), 35, "R", None),
            ])
        self.ln(4)

    def cards_table(self, cards: list[dict]):
        cards = [c for c in cards if c["total"] > 0]
        if not cards:
            return
        self._check_page(len(cards) * 6 + 20)
        self._table_header([
            ("Tarjeta", 40, ""), ("Banco", 40, ""),
            ("Trans.", 20, "R"), ("Monto", 35, "R"),
        ])
        for c in cards:
            self._table_row([
                (c["name"][:20], 40, "", None),
                (c["bank"][:20], 40, "", None),
                (str(c["count"]), 20, "R", None),
                (_fmt_currency(c["total"]), 35, "R", None),
            ])
        self.ln(4)

    def future_installments_section(self, data: dict):
        installments = data.get("future_installments", [])
        total = data.get("future_installments_total", 0)
        count = data.get("future_installments_count", 0)

        if not installments:
            self.set_font("Helvetica", "", 8)
            self.set_text_color(*_hex_to_rgb(C_GRAY_500))
            self.cell(0, 6, "No hay cuotas futuras programadas.")
            self.ln(8)
            return

        self._check_page(min(len(installments), 10) * 6 + 25)
        self.set_font("Helvetica", "B", 8)
        self.set_text_color(*_hex_to_rgb(C_GRAY_700))
        self.cell(0, 6, f"{count} cuotas por un total de {_fmt_currency(total)}")
        self.ln(8)

        self._table_header([
            ("Fecha", 30, ""), ("Descripcion", 85, ""), ("Monto", 35, "R"),
        ])
        for inst in installments[:10]:
            self._table_row([
                (inst["date"], 30, "", None),
                (inst["description"][:40], 85, "", None),
                (_fmt_currency(inst["amount"]), 35, "R", None),
            ])
        self.ln(4)

    # -- Analysis box -----------------------------------------------------

    def analysis_box(self, analysis: dict):
        self._check_page(60)

        # Summary
        if analysis.get("summary"):
            self.set_font("Helvetica", "", 9)
            self.set_text_color(*_hex_to_rgb(C_GRAY_700))
            self.multi_cell(0, 5, _strip_emojis(analysis["summary"]))
            self.ln(3)

        # Highlights
        for h in analysis.get("highlights", []):
            self.set_font("Helvetica", "", 8)
            self.set_text_color(*_hex_to_rgb(C_SUCCESS))
            self.cell(5, 5, "+")
            self.set_text_color(*_hex_to_rgb(C_GRAY_700))
            self.cell(0, 5, f" {_strip_emojis(h)}")
            self.ln(5)

        # Notes sections
        for key, label in [
            ("category_notes", "Categorias"),
            ("comparison_notes", "Comparativa"),
            ("future_notes", "Cuotas futuras"),
            ("accounts_notes", "Cuentas y tarjetas"),
        ]:
            if analysis.get(key):
                self.set_font("Helvetica", "I", 8)
                self.set_text_color(*_hex_to_rgb(C_GRAY_500))
                self.multi_cell(0, 4, f"{label}: {_strip_emojis(analysis[key])}")
                self.ln(2)

        # Concern
        if analysis.get("concern"):
            self._draw_callout_box(analysis["concern"], C_WARNING, (255, 251, 235), "!")

        # Tip
        if analysis.get("tip"):
            self._draw_callout_box(analysis["tip"], C_PRIMARY, (238, 242, 255), "*")

        # Next month suggestion
        if analysis.get("next_month_suggestion"):
            self._draw_callout_box(analysis["next_month_suggestion"], C_SUCCESS, (240, 253, 244), ">")

    def _draw_callout_box(self, text: str, border_color: str, bg_color: tuple, icon: str):
        self._check_page(16)
        r, g, b = _hex_to_rgb(border_color)
        self.set_fill_color(*bg_color)
        self.set_draw_color(r, g, b)
        y = self.get_y()
        self.rect(10, y, 190, 12, "DF")
        self.set_xy(12, y + 2)
        self.set_font("Helvetica", "B", 8)
        self.set_text_color(r, g, b)
        self.cell(5, 5, icon)
        self.set_font("Helvetica", "", 8)
        self.set_text_color(*_hex_to_rgb(C_GRAY_700))
        self.cell(0, 5, f" {_strip_emojis(text)}")
        self.ln(14)


# ---------------------------------------------------------------------------
# Main PDF generator
# ---------------------------------------------------------------------------

def generate_pdf(report_data: dict, user_name: str) -> bytes:
    """Generate PDF report from report data. Returns PDF bytes."""
    pdf = MonthlyReportPDF()
    pdf.alias_nb_pages()
    pdf.add_page()

    month_str = report_data["month"]
    y, m = int(month_str[:4]), int(month_str[5:7])
    month_name = MONTHS_ES.get(m, str(m))

    # ── Title ──────────────────────────────────────────────────────────
    pdf.set_font("Helvetica", "B", 20)
    pdf.set_text_color(*_hex_to_rgb(C_GRAY_900))
    pdf.cell(0, 14, "Reporte Mensual", align="C")
    pdf.ln(12)

    pdf.set_font("Helvetica", "", 12)
    pdf.set_text_color(*_hex_to_rgb(C_PRIMARY))
    pdf.cell(0, 8, f"{month_name} {y}", align="C")
    pdf.ln(6)

    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(*_hex_to_rgb(C_GRAY_400))
    pdf.cell(0, 5, f"Generado para {user_name}  |  {date.today().strftime('%d/%m/%Y')}", align="C")
    pdf.ln(14)

    # ── KPIs ───────────────────────────────────────────────────────────
    savings_color = "green" if report_data["savings_rate"] >= 0 else "red"
    mom_color = "green" if report_data["mom_change"] <= 0 else "red"
    mom_arrow = "Baj" if report_data["mom_change"] < 0 else "Sub" if report_data["mom_change"] > 0 else "-"

    pdf.kpi_row([
        ("Gastos totales", _fmt_currency(report_data["total_expenses"]), "red"),
        ("Ingresos totales", _fmt_currency(report_data["total_income"]), "green"),
        ("Tasa de ahorro", f"{report_data['savings_rate']}%", savings_color),
        ("vs Mes anterior", f"{mom_arrow} {abs(report_data['mom_change'])}%", mom_color),
    ])

    pdf.set_font("Helvetica", "", 8)
    pdf.set_text_color(*_hex_to_rgb(C_GRAY_400))
    pdf.cell(0, 5, f"{report_data['expense_count']} transacciones este mes", align="C")
    pdf.ln(10)

    # ── Pie chart ──────────────────────────────────────────────────────
    all_cats = report_data.get("all_categories", [])
    if all_cats and report_data["total_expenses"] > 0:
        pdf.section_title("Distribucion por Categoria")
        pie_png = _create_pie_chart(all_cats, report_data["total_expenses"])
        if pie_png:
            pdf.image(io.BytesIO(pie_png), x=10, w=190)
            pdf.ln(4)

    # ── Bar chart comparison ───────────────────────────────────────────
    cat_comp = report_data.get("category_comparison", [])
    if cat_comp:
        pdf.section_title("Comparativa vs Mes Anterior")
        bar_png = _create_bar_comparison(cat_comp)
        if bar_png:
            pdf.image(io.BytesIO(bar_png), x=10, w=190)
            pdf.ln(4)

    # ── Trend chart ────────────────────────────────────────────────────
    trend = report_data.get("trend_history", [])
    if trend:
        pdf.section_title("Evolucion de Ultimos 6 Meses")
        trend_png = _create_trend_chart(trend)
        if trend_png:
            pdf.image(io.BytesIO(trend_png), x=10, w=190)
            pdf.ln(2)

    # ── Trend table ────────────────────────────────────────────────────
    if trend:
        pdf.trend_table(trend)

    # ── Top 5 expenses ─────────────────────────────────────────────────
    top_exp = report_data.get("top_expenses", [])
    if top_exp:
        pdf.section_title("Mayores Gastos")
        pdf.top_expenses_table(top_exp)

    # ── Accounts summary ───────────────────────────────────────────────
    accts = report_data.get("accounts_summary", [])
    if accts:
        pdf.section_title("Resumen de Cuentas")
        pdf.accounts_table(accts)

    # ── Cards summary ──────────────────────────────────────────────────
    cards = report_data.get("cards_summary", [])
    if cards:
        pdf.section_title("Resumen de Tarjetas")
        pdf.cards_table(cards)

    # ── Future installments ────────────────────────────────────────────
    if report_data.get("future_installments"):
        pdf.section_title("Cuotas Futuras")
        pdf.future_installments_section(report_data)

    # ── LLM Analysis ───────────────────────────────────────────────────
    if report_data.get("analysis"):
        pdf.section_title("Analisis IA")
        pdf.analysis_box(report_data["analysis"])

    # ── Footer ─────────────────────────────────────────────────────────
    pdf.ln(8)
    pdf.set_font("Helvetica", "I", 7)
    pdf.set_text_color(*_hex_to_rgb(C_GRAY_400))
    pdf.cell(0, 5, "Generado por NikoFin", align="C")

    return bytes(pdf.output())
