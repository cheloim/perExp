"""PDF report generation for monthly analysis using FPDF2."""

import json
import re
from calendar import monthrange
from collections import defaultdict
from datetime import date

from fpdf import FPDF

# Emoji pattern - matches most common emojis
_EMOJI_RE = re.compile(
    "["
    "\U0001F600-\U0001F64F"  # emoticons
    "\U0001F300-\U0001F5FF"  # symbols & pictographs
    "\U0001F680-\U0001F6FF"  # transport & map
    "\U0001F1E0-\U0001F1FF"  # flags
    "\U00002702-\U000027B0"  # dingbats
    "\U000024C2-\U0001F251"  # enclosed characters
    "\U0001f926-\U0001f937"
    "\U00010000-\U0010ffff"
    "]+",
    flags=re.UNICODE,
)


def _strip_emojis(text: str) -> str:
    """Remove emojis from text for FPDF2 compatibility."""
    return _EMOJI_RE.sub("", text).strip()

from app.database import SessionLocal
from app.models import Category, Expense, MonthlyReport, User
from app.routers.groups import get_group_user_ids
from app.services.date_utils import add_months

MONTHS_ES = {
    1: "Enero", 2: "Febrero", 3: "Marzo", 4: "Abril",
    5: "Mayo", 6: "Junio", 7: "Julio", 8: "Agosto",
    9: "Septiembre", 10: "Octubre", 11: "Noviembre", 12: "Diciembre",
}


class MonthlyReportPDF(FPDF):
    """Custom PDF class for monthly financial reports."""

    def __init__(self):
        super().__init__()
        self.set_auto_page_break(auto=True, margin=20)

    def header(self):
        self.set_font("Helvetica", "B", 10)
        self.set_text_color(100, 100, 100)
        self.cell(0, 8, "NikoFin - Reporte Mensual", align="R")
        self.ln(10)

    def footer(self):
        self.set_y(-15)
        self.set_font("Helvetica", "I", 8)
        self.set_text_color(150, 150, 150)
        self.cell(0, 10, f"Pagina {self.page_no()}/{{nb}}", align="C")

    def section_title(self, title: str):
        self.set_font("Helvetica", "B", 12)
        self.set_text_color(99, 102, 241)  # Primary color
        self.cell(0, 10, title)
        self.ln(8)
        # Draw line
        self.set_draw_color(99, 102, 241)
        self.set_line_width(0.5)
        self.line(10, self.get_y(), 200, self.get_y())
        self.ln(4)

    def kpi_row(self, items: list[tuple[str, str, str]]):
        """Render a row of KPI cards. items = [(label, value, color), ...]"""
        col_width = 190 / len(items)
        for label, value, color in items:
            x = self.get_x()
            y = self.get_y()
            # Background
            self.set_fill_color(248, 249, 250)
            self.rect(x, y, col_width - 4, 22, "F")
            # Label
            self.set_font("Helvetica", "", 7)
            self.set_text_color(107, 114, 128)
            self.set_xy(x + 2, y + 2)
            self.cell(col_width - 4, 5, label.upper())
            # Value
            self.set_font("Helvetica", "B", 11)
            if color == "green":
                self.set_text_color(5, 150, 105)
            elif color == "red":
                self.set_text_color(220, 38, 38)
            else:
                self.set_text_color(31, 41, 55)
            self.set_xy(x + 2, y + 9)
            self.cell(col_width - 4, 8, value)
            self.set_xy(x + col_width - 2, y)
        self.ln(26)

    def category_table(self, categories: list[dict]):
        """Render top categories as a table."""
        self.set_font("Helvetica", "B", 8)
        self.set_fill_color(249, 250, 251)
        self.set_text_color(107, 114, 128)
        self.cell(80, 7, "Categoria", border=1, fill=True)
        self.cell(35, 7, "Monto", border=1, fill=True, align="R")
        self.cell(25, 7, "Trans.", border=1, fill=True, align="R")
        self.cell(25, 7, "Porcentaje", border=1, fill=True, align="R")
        self.ln()

        self.set_font("Helvetica", "", 8)
        self.set_text_color(31, 41, 55)
        total = sum(c["total"] for c in categories) if categories else 1
        for cat in categories:
            pct = (cat["total"] / total * 100) if total > 0 else 0
            # Color dot
            r, g, b = _hex_to_rgb(cat.get("color", "#6b7280"))
            self.set_fill_color(r, g, b)
            self.rect(self.get_x() + 2, self.get_y() + 2, 3, 3, "F")
            self.set_x(self.get_x() + 7)
            self.cell(73, 7, cat["name"][:35])
            self.cell(35, 7, f"${cat['total']:,.2f}", align="R")
            self.cell(25, 7, str(cat["count"]), align="R")
            self.cell(25, 7, f"{pct:.1f}%", align="R")
            self.ln()
        self.ln(4)

    def trend_table(self, trend: list[dict]):
        """Render 6-month trend table."""
        self.set_font("Helvetica", "B", 8)
        self.set_fill_color(249, 250, 251)
        self.set_text_color(107, 114, 128)
        self.cell(40, 7, "Mes", border=1, fill=True)
        self.cell(35, 7, "Gastos", border=1, fill=True, align="R")
        self.cell(35, 7, "Ingresos", border=1, fill=True, align="R")
        self.cell(35, 7, "Balance", border=1, fill=True, align="R")
        self.ln()

        self.set_font("Helvetica", "", 8)
        for t in trend:
            y_t, m_t = t["month"].split("-")
            m_name = MONTHS_ES.get(int(m_t), m_t)[:3]
            balance = t["income"] - t["expenses"]
            self.set_text_color(31, 41, 55)
            self.cell(40, 7, f"{m_name} {y_t}")
            self.cell(35, 7, f"${t['expenses']:,.2f}", align="R")
            self.cell(35, 7, f"${t['income']:,.2f}", align="R")
            if balance >= 0:
                self.set_text_color(5, 150, 105)
            else:
                self.set_text_color(220, 38, 38)
            self.cell(35, 7, f"${balance:,.2f}", align="R")
            self.ln()
        self.ln(4)

    def analysis_box(self, analysis: dict):
        """Render LLM analysis section."""
        self.set_font("Helvetica", "B", 10)
        self.set_text_color(99, 102, 241)
        self.cell(0, 8, "Analisis IA")
        self.ln(8)

        # Summary
        self.set_font("Helvetica", "", 9)
        self.set_text_color(55, 65, 81)
        self.multi_cell(0, 5, _strip_emojis(analysis.get("summary", "")))
        self.ln(3)

        # Highlights
        for h in analysis.get("highlights", []):
            self.set_font("Helvetica", "", 9)
            self.set_text_color(5, 150, 105)
            self.cell(5, 5, "+")
            self.set_text_color(55, 65, 81)
            self.cell(0, 5, f" {_strip_emojis(h)}")
            self.ln(5)

        # Category notes
        if analysis.get("category_notes"):
            self.set_font("Helvetica", "I", 8)
            self.set_text_color(107, 114, 128)
            self.multi_cell(0, 4, _strip_emojis(analysis["category_notes"]))
            self.ln(2)

        # Comparison notes
        if analysis.get("comparison_notes"):
            self.set_font("Helvetica", "I", 8)
            self.set_text_color(107, 114, 128)
            self.multi_cell(0, 4, _strip_emojis(analysis["comparison_notes"]))
            self.ln(2)

        # Future notes
        if analysis.get("future_notes"):
            self.set_font("Helvetica", "I", 8)
            self.set_text_color(107, 114, 128)
            self.multi_cell(0, 4, _strip_emojis(analysis["future_notes"]))
            self.ln(2)

        # Accounts notes
        if analysis.get("accounts_notes"):
            self.set_font("Helvetica", "I", 8)
            self.set_text_color(107, 114, 128)
            self.multi_cell(0, 4, _strip_emojis(analysis["accounts_notes"]))
            self.ln(2)

        # Concern
        if analysis.get("concern"):
            self.set_fill_color(255, 251, 235)
            self.set_draw_color(217, 119, 6)
            y = self.get_y()
            self.rect(10, y, 190, 12, "DF")
            self.set_xy(12, y + 2)
            self.set_font("Helvetica", "B", 8)
            self.set_text_color(217, 119, 6)
            self.cell(5, 5, "!")
            self.set_font("Helvetica", "", 8)
            self.set_text_color(120, 80, 20)
            self.cell(0, 5, f" {_strip_emojis(analysis['concern'])}")
            self.ln(14)

        # Tip
        if analysis.get("tip"):
            self.set_fill_color(238, 242, 255)
            self.set_draw_color(99, 102, 241)
            y = self.get_y()
            self.rect(10, y, 190, 12, "DF")
            self.set_xy(12, y + 2)
            self.set_font("Helvetica", "B", 8)
            self.set_text_color(99, 102, 241)
            self.cell(5, 5, "*")
            self.set_font("Helvetica", "", 8)
            self.set_text_color(55, 55, 100)
            self.cell(0, 5, f" {_strip_emojis(analysis['tip'])}")
            self.ln(14)

        # Next month suggestion
        if analysis.get("next_month_suggestion"):
            self.set_fill_color(240, 253, 244)
            self.set_draw_color(5, 150, 105)
            y = self.get_y()
            self.rect(10, y, 190, 12, "DF")
            self.set_xy(12, y + 2)
            self.set_font("Helvetica", "B", 8)
            self.set_text_color(5, 150, 105)
            self.cell(5, 5, ">")
            self.set_font("Helvetica", "", 8)
            self.set_text_color(20, 80, 50)
            self.cell(0, 5, f" {_strip_emojis(analysis['next_month_suggestion'])}")
            self.ln(14)

    def pie_chart(self, categories: list[dict], total: float):
        """Render a pie chart showing category distribution."""
        if not categories or total == 0:
            return

        cx, cy = 60, 55  # Center of pie
        radius = 35
        start_angle = 0

        for cat in categories[:8]:  # Max 8 slices
            pct = cat["total"] / total
            if pct < 0.01:
                continue  # Skip tiny slices
            end_angle = start_angle + pct * 360

            r, g, b = _hex_to_rgb(cat.get("color", "#6b7280"))
            self.set_fill_color(r, g, b)
            self.set_draw_color(255, 255, 255)

            # Draw arc using lines
            import math
            steps = max(3, int(abs(end_angle - start_angle) / 5))
            points = [(cx, cy)]
            for i in range(steps + 1):
                angle = math.radians(start_angle + (end_angle - start_angle) * i / steps)
                x = cx + radius * math.cos(angle)
                y = cy + radius * math.sin(angle)
                points.append((x, y))
            points.append((cx, cy))

            # Fill polygon
            self.set_fill_color(r, g, b)
            for i in range(len(points) - 2):
                x1, y1 = points[i]
                x2, y2 = points[i + 1]
                x3, y3 = points[i + 2]
                # Simple triangle fill using lines
                self.set_line_width(0.3)
                self.line(x1, y1, x2, y2)
                self.line(x2, y2, x3, y3)
                self.line(x3, y3, x1, y1)

            start_angle = end_angle

        # Legend
        legend_x = 110
        legend_y = 25
        for i, cat in enumerate(categories[:8]):
            pct = (cat["total"] / total * 100) if total > 0 else 0
            r, g, b = _hex_to_rgb(cat.get("color", "#6b7280"))
            self.set_fill_color(r, g, b)
            self.rect(legend_x, legend_y + i * 7, 4, 4, "F")
            self.set_font("Helvetica", "", 7)
            self.set_text_color(55, 65, 81)
            label = cat["name"][:20] if len(cat["name"]) > 20 else cat["name"]
            self.set_xy(legend_x + 6, legend_y + i * 7 - 1)
            self.cell(60, 5, f"{label}")
            self.set_text_color(107, 114, 128)
            self.cell(25, 5, f"${cat['total']:,.0f}", align="R")
            self.cell(15, 5, f"{pct:.0f}%", align="R")

        self.set_y(max(cy + radius + 5, legend_y + len(categories[:8]) * 7 + 5))

    def bar_chart_comparison(self, data: list[dict]):
        """Render bar chart comparing current vs last month."""
        if not data:
            return

        chart_x = 15
        chart_y = self.get_y() + 5
        chart_w = 170
        chart_h = 50
        bar_w = 16
        gap = (chart_w - len(data) * bar_w * 2) / (len(data) + 1)

        max_val = max(max(d["total"], d["previous"]) for d in data) or 1

        # Draw bars
        for i, d in enumerate(data):
            x = chart_x + gap + i * (bar_w * 2 + gap)

            # Current month bar (blue)
            h_current = (d["total"] / max_val) * chart_h
            self.set_fill_color(99, 102, 241)
            self.rect(x, chart_y + chart_h - h_current, bar_w, h_current, "F")

            # Previous month bar (gray)
            h_previous = (d["previous"] / max_val) * chart_h
            self.set_fill_color(209, 213, 219)
            self.rect(x + bar_w + 2, chart_y + chart_h - h_previous, bar_w, h_previous, "F")

            # Label
            self.set_font("Helvetica", "", 5)
            self.set_text_color(107, 114, 128)
            label = d["name"][:12] if len(d["name"]) > 12 else d["name"]
            self.set_xy(x, chart_y + chart_h + 2)
            self.cell(bar_w * 2 + 2, 4, label, align="C")

        # Legend
        self.set_fill_color(99, 102, 241)
        self.rect(chart_x, chart_y - 5, 4, 4, "F")
        self.set_font("Helvetica", "", 6)
        self.set_text_color(55, 65, 81)
        self.set_xy(chart_x + 6, chart_y - 5)
        self.cell(20, 4, "Este mes")

        self.set_fill_color(209, 213, 219)
        self.rect(chart_x + 35, chart_y - 5, 4, 4, "F")
        self.set_xy(chart_x + 41, chart_y - 5)
        self.cell(20, 4, "Mes anterior")

        self.set_y(chart_y + chart_h + 10)

    def top_expenses_table(self, expenses: list[dict]):
        """Render top 5 expenses table."""
        self.set_font("Helvetica", "B", 8)
        self.set_fill_color(249, 250, 251)
        self.set_text_color(107, 114, 128)
        self.cell(20, 7, "Fecha", border=1, fill=True)
        self.cell(80, 7, "Descripcion", border=1, fill=True)
        self.cell(40, 7, "Categoria", border=1, fill=True)
        self.cell(30, 7, "Monto", border=1, fill=True, align="R")
        self.ln()

        self.set_font("Helvetica", "", 7)
        for e in expenses:
            self.set_text_color(31, 41, 55)
            self.cell(20, 6, e["date"])
            self.cell(80, 6, e["description"][:35])
            self.cell(40, 6, e["category"][:20])
            self.set_text_color(220, 38, 38)
            self.cell(30, 6, f"${e['amount']:,.2f}", align="R")
            self.ln()
        self.ln(4)

    def accounts_table(self, accounts: list[dict]):
        """Render accounts summary table."""
        if not accounts:
            return
        self.set_font("Helvetica", "B", 8)
        self.set_fill_color(249, 250, 251)
        self.set_text_color(107, 114, 128)
        self.cell(60, 7, "Cuenta", border=1, fill=True)
        self.cell(30, 7, "Tipo", border=1, fill=True)
        self.cell(30, 7, "Trans.", border=1, fill=True, align="R")
        self.cell(40, 7, "Monto", border=1, fill=True, align="R")
        self.ln()

        self.set_font("Helvetica", "", 7)
        for a in accounts:
            if a["total"] == 0:
                continue
            self.set_text_color(31, 41, 55)
            self.cell(60, 6, a["name"][:30])
            self.cell(30, 6, a["type"])
            self.cell(30, 6, str(a["count"]), align="R")
            self.cell(40, 6, f"${a['total']:,.2f}", align="R")
            self.ln()
        self.ln(4)

    def cards_table(self, cards: list[dict]):
        """Render cards summary table."""
        if not cards:
            return
        self.set_font("Helvetica", "B", 8)
        self.set_fill_color(249, 250, 251)
        self.set_text_color(107, 114, 128)
        self.cell(40, 7, "Tarjeta", border=1, fill=True)
        self.cell(40, 7, "Banco", border=1, fill=True)
        self.cell(25, 7, "Trans.", border=1, fill=True, align="R")
        self.cell(40, 7, "Monto", border=1, fill=True, align="R")
        self.ln()

        self.set_font("Helvetica", "", 7)
        for c in cards:
            if c["total"] == 0:
                continue
            self.set_text_color(31, 41, 55)
            self.cell(40, 6, c["name"][:20])
            self.cell(40, 6, c["bank"][:20])
            self.cell(25, 6, str(c["count"]), align="R")
            self.cell(40, 6, f"${c['total']:,.2f}", align="R")
            self.ln()
        self.ln(4)

    def future_installments_section(self, data: dict):
        """Render future installments section."""
        installments = data.get("future_installments", [])
        total = data.get("future_installments_total", 0)
        count = data.get("future_installments_count", 0)

        if not installments:
            self.set_font("Helvetica", "", 8)
            self.set_text_color(107, 114, 128)
            self.cell(0, 6, "No hay cuotas futuras programadas.")
            self.ln(8)
            return

        # Summary
        self.set_font("Helvetica", "B", 8)
        self.set_text_color(55, 65, 81)
        self.cell(0, 6, f"{count} cuotas por un total de ${total:,.2f}")
        self.ln(8)

        # Table
        self.set_font("Helvetica", "B", 8)
        self.set_fill_color(249, 250, 251)
        self.set_text_color(107, 114, 128)
        self.cell(30, 7, "Fecha", border=1, fill=True)
        self.cell(90, 7, "Descripcion", border=1, fill=True)
        self.cell(40, 7, "Monto", border=1, fill=True, align="R")
        self.ln()

        self.set_font("Helvetica", "", 7)
        for inst in installments[:10]:  # Show max 10
            self.set_text_color(31, 41, 55)
            self.cell(30, 6, inst["date"])
            self.cell(90, 6, inst["description"][:40])
            self.cell(40, 6, f"${inst['amount']:,.2f}", align="R")
            self.ln()
        self.ln(4)


def _hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    """Convert hex color to RGB tuple."""
    hex_color = hex_color.lstrip("#")
    return tuple(int(hex_color[i : i + 2], 16) for i in (0, 2, 4))


def _build_report_data(user_id: int, month_str: str, db) -> dict:
    """Build report data for a user and month."""
    y, m = int(month_str[:4]), int(month_str[5:7])
    target_start = date(y, m, 1)
    target_end = date(y, m, monthrange(y, m)[1])

    uid_list = get_group_user_ids(user_id, db)

    expenses = (
        db.query(Expense)
        .filter(Expense.user_id.in_(uid_list), Expense.date >= target_start, Expense.date <= target_end)
        .all()
    )

    total_expenses = sum(abs(e.amount) for e in expenses if not e.is_income)
    total_income = sum(abs(e.amount) for e in expenses if e.is_income)
    count = sum(1 for e in expenses if not e.is_income)

    # By category
    by_cat = defaultdict(lambda: {"total": 0.0, "count": 0, "name": "", "color": ""})
    for e in expenses:
        if e.is_income:
            continue
        cat_name = "Sin categoria"
        cat_color = "#6b7280"
        if e.category_id:
            cat = db.query(Category).filter(Category.id == e.category_id).first()
            if cat:
                cat_name = cat.name
                cat_color = cat.color or "#6b7280"
                if cat.parent_id:
                    parent = db.query(Category).filter(Category.id == cat.parent_id).first()
                    if parent:
                        cat_name = f"{parent.name} > {cat.name}"
        by_cat[e.category_id or 0]["total"] += abs(e.amount)
        by_cat[e.category_id or 0]["count"] += 1
        by_cat[e.category_id or 0]["name"] = cat_name
        by_cat[e.category_id or 0]["color"] = cat_color

    top_categories = sorted(by_cat.values(), key=lambda x: x["total"], reverse=True)[:5]

    # Previous month
    prev_start = add_months(target_start, -1)
    prev_end = date(prev_start.year, prev_start.month, monthrange(prev_start.year, prev_start.month)[1])
    prev_expenses = (
        db.query(Expense)
        .filter(Expense.user_id.in_(uid_list), Expense.date >= prev_start, Expense.date <= prev_end)
        .all()
    )
    previous_total = sum(abs(e.amount) for e in prev_expenses if not e.is_income)
    previous_income = sum(abs(e.amount) for e in prev_expenses if e.is_income)

    savings_rate = 0.0
    if total_income > 0:
        savings_rate = ((total_income - total_expenses) / total_income) * 100

    mom_change = 0.0
    if previous_total > 0:
        mom_change = ((total_expenses - previous_total) / previous_total) * 100

    # Trend history (6 months)
    trend_history = []
    for i in range(5, -1, -1):
        m_hist = add_months(target_start, -i)
        m_start = date(m_hist.year, m_hist.month, 1)
        m_end = date(m_hist.year, m_hist.month, monthrange(m_hist.year, m_hist.month)[1])
        hist_expenses = (
            db.query(Expense)
            .filter(Expense.user_id.in_(uid_list), Expense.date >= m_start, Expense.date <= m_end)
            .all()
        )
        hist_total = sum(abs(e.amount) for e in hist_expenses if not e.is_income)
        hist_income = sum(abs(e.amount) for e in hist_expenses if e.is_income)
        trend_history.append({
            "month": m_hist.strftime("%Y-%m"),
            "expenses": round(hist_total, 2),
            "income": round(hist_income, 2),
        })

    # LLM analysis
    analysis = None
    import os

    api_key = os.getenv("LLM_API_KEY")
    if api_key:
        try:
            import asyncio
            from google import genai
            from google.genai import types as genai_types

            today = date.today()
            trend_lines = []
            for t in trend_history:
                trend_lines.append(f"  {t['month']}: gastos=${t['expenses']:,.0f}, ingresos=${t['income']:,.0f}")

            cat_lines = []
            for cat in all_categories[:8]:
                cat_lines.append(f"  - {cat['name']}: ${cat['total']:,.0f} ({cat['count']} transacciones)")

            comp_lines = []
            for c in category_comparison:
                comp_lines.append(f"  - {c['name']}: actual=${c['total']:,.0f}, anterior=${c['previous']:,.0f}, cambio={c['change_pct']:+.1f}%")

            expense_lines = []
            for e in top_expenses:
                expense_lines.append(f"  - {e['date']} {e['description']}: ${e['amount']:,.2f} ({e['category']})")

            account_lines = []
            for a in accounts_summary:
                if a['total'] > 0:
                    account_lines.append(f"  - {a['name']} ({a['type']}): ${a['total']:,.2f} ({a['count']} transacciones)")

            card_lines = []
            for c in cards_summary:
                if c['total'] > 0:
                    card_lines.append(f"  - {c['name']} {c['bank']}: ${c['total']:,.2f} ({c['count']} transacciones)")

            future_lines = []
            for fi in future_installments[:5]:
                future_lines.append(f"  - {fi['date']}: {fi['description']} ${fi['amount']:,.2f}")

            llm_context = f"""RESUMEN MENSUAL - {MONTHS_ES[m]} {y}

RESUMEN:
- Gastos totales: ${total_expenses:,.0f}
- Ingresos totales: ${total_income:,.0f}
- Tasa de ahorro: {savings_rate:.1f}%
- Transacciones: {count}
- Variacion vs mes anterior: {mom_change:+.1f}%
- Gastos mismo mes ano anterior: ${last_year_total:,.0f}

TOP CATEGORIAS:
{chr(10).join(cat_lines) or '  Sin datos'}

COMPARATIVA vs MES ANTERIOR:
{chr(10).join(comp_lines) or '  Sin datos'}

MAYORES GASTOS:
{chr(10).join(expense_lines) or '  Sin datos'}

CUENTAS:
{chr(10).join(account_lines) or '  Sin datos'}

TARJETAS:
{chr(10).join(card_lines) or '  Sin datos'}

CUOTAS FUTURAS ({len(future_installments)} cuotas, ${sum(fi['amount'] for fi in future_installments):,.2f} total):
{chr(10).join(future_lines) or '  Sin cuotas futuras'}

HISTORIAL (6 meses):
{chr(10).join(trend_lines)}

Fecha: {today.isoformat()}"""

            prompt = """Sos un analista financiero personal. Devolve UNICAMENTE JSON valido:
{
  "summary": "<resumen ejecutivo 3-4 lineas>",
  "highlights": ["<highlight 1>", "<highlight 2>", "<highlight 3>"],
  "concern": "<preocupacion o null>",
  "category_notes": "<nota sobre distribucion de categorias, 1-2 lineas>",
  "comparison_notes": "<nota sobre comparativa con mes anterior, 1-2 lineas>",
  "future_notes": "<nota sobre cuotas futuras, 1-2 lineas>",
  "accounts_notes": "<nota sobre cuentas/tarjetas, 1-2 lineas>",
  "tip": "<consejo concreto de ahorro>",
  "next_month_suggestion": "<sugerencia especifica para el proximo mes>"
}
Sé especifico con numeros. Español, claro, amigable. Sin emojis."""

            client = genai.Client(api_key=api_key)

            async def _call_llm():
                return await client.aio.models.generate_content(
                    model="gemini-flash-latest",
                    contents=llm_context,
                    config=genai_types.GenerateContentConfig(
                        system_instruction=prompt,
                        response_mime_type="application/json",
                    ),
                )

            response = asyncio.run(_call_llm())
            analysis = json.loads(response.text)
        except Exception:
            analysis = None

    return {
        "month": month_str,
        "total_expenses": total_expenses,
        "total_income": total_income,
        "savings_rate": round(savings_rate, 1),
        "expense_count": count,
        "top_categories": top_categories,
        "previous_total": previous_total,
        "previous_income": previous_income,
        "mom_change": round(mom_change, 1),
        "trend_history": trend_history,
        "analysis": analysis,
    }


def generate_pdf(report_data: dict, user_name: str) -> bytes:
    """Generate PDF report from report data. Returns PDF bytes."""
    pdf = MonthlyReportPDF()
    pdf.alias_nb_pages()
    pdf.add_page()

    month_str = report_data["month"]
    y, m = int(month_str[:4]), int(month_str[5:7])
    month_name = MONTHS_ES.get(m, str(m))

    # Title
    pdf.set_font("Helvetica", "B", 18)
    pdf.set_text_color(31, 41, 55)
    pdf.cell(0, 12, f"Reporte Mensual", align="C")
    pdf.ln(10)

    pdf.set_font("Helvetica", "", 11)
    pdf.set_text_color(107, 114, 128)
    pdf.cell(0, 8, f"{month_name} {y}", align="C")
    pdf.ln(6)

    pdf.set_font("Helvetica", "I", 8)
    pdf.set_text_color(156, 163, 175)
    pdf.cell(0, 5, f"Generado para {user_name}", align="C")
    pdf.ln(12)

    # KPIs
    savings_color = "green" if report_data["savings_rate"] >= 0 else "red"
    mom_color = "green" if report_data["mom_change"] <= 0 else "red"
    mom_arrow = "B" if report_data["mom_change"] < 0 else "A" if report_data["mom_change"] > 0 else "-"

    pdf.kpi_row([
        ("Gastos", f"${report_data['total_expenses']:,.2f}", "red"),
        ("Ingresos", f"${report_data['total_income']:,.2f}", "green"),
        ("Tasa de ahorro", f"{report_data['savings_rate']}%", savings_color),
        ("vs Mes anterior", f"{mom_arrow} {abs(report_data['mom_change'])}%", mom_color),
    ])

    pdf.set_font("Helvetica", "I", 8)
    pdf.set_text_color(156, 163, 175)
    pdf.cell(0, 5, f"{report_data['expense_count']} transacciones este mes")
    pdf.ln(10)

    # Pie chart - Category distribution
    if report_data.get("all_categories"):
        pdf.section_title("Distribucion por Categoria")
        pdf.pie_chart(report_data["all_categories"], report_data["total_expenses"])
        pdf.ln(4)

    # Bar chart - Category comparison vs last month
    if report_data.get("category_comparison"):
        pdf.section_title("Comparativa vs Mes Anterior")
        pdf.bar_chart_comparison(report_data["category_comparison"])
        pdf.ln(4)

    # Trend
    if report_data.get("trend_history"):
        pdf.section_title("Evolucion (6 meses)")
        pdf.trend_table(report_data["trend_history"])

    # Top 5 expenses
    if report_data.get("top_expenses"):
        pdf.section_title("Mayores Gastos")
        pdf.top_expenses_table(report_data["top_expenses"])

    # Accounts summary
    if report_data.get("accounts_summary"):
        pdf.section_title("Resumen Cuentas")
        pdf.accounts_table(report_data["accounts_summary"])

    # Cards summary
    if report_data.get("cards_summary"):
        pdf.section_title("Resumen Tarjetas")
        pdf.cards_table(report_data["cards_summary"])

    # Future installments
    if report_data.get("future_installments"):
        pdf.section_title("Cuotas Futuras")
        pdf.future_installments_section(report_data)

    # LLM Analysis
    if report_data.get("analysis"):
        pdf.section_title("Analisis IA")
        pdf.analysis_box(report_data["analysis"])

    # Footer
    pdf.ln(10)
    pdf.set_font("Helvetica", "I", 7)
    pdf.set_text_color(156, 163, 175)
    pdf.cell(0, 5, f"Generado por NikoFin - {date.today().strftime('%d/%m/%Y')}", align="C")

    return bytes(pdf.output())
