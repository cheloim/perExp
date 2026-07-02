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
            for cat in top_categories:
                cat_lines.append(f"  - {cat['name']}: ${cat['total']:,.0f} ({cat['count']} transacciones)")

            llm_context = f"""RESUMEN MENSUAL - {MONTHS_ES[m]} {y}

- Gastos totales: ${total_expenses:,.0f}
- Ingresos totales: ${total_income:,.0f}
- Tasa de ahorro: {savings_rate:.1f}%
- Transacciones: {count}
- Variacion vs mes anterior: {mom_change:+.1f}%

TOP CATEGORIAS:
{chr(10).join(cat_lines) or '  Sin datos'}

HISTORIAL (6 meses):
{chr(10).join(trend_lines)}

Fecha: {today.isoformat()}"""

            prompt = """Sos un analista financiero personal. Devolve UNICAMENTE JSON valido:
{
  "summary": "<resumen 2-3 lineas, con emojis>",
  "highlights": ["<highlight 1>", "<highlight 2>", "<highlight 3>"],
  "concern": "<preocupacion o null>",
  "tip": "<consejo concreto>"
}
Sé specifico con numeros. Español, claro, amigable."""

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

    # Top Categories
    if report_data.get("top_categories"):
        pdf.section_title("Top Categorias")
        pdf.category_table(report_data["top_categories"])

    # Trend
    if report_data.get("trend_history"):
        pdf.section_title("Evolucion (6 meses)")
        pdf.trend_table(report_data["trend_history"])

    # Analysis
    if report_data.get("analysis"):
        pdf.section_title("Analisis IA")
        pdf.analysis_box(report_data["analysis"])

    # Footer
    pdf.ln(10)
    pdf.set_font("Helvetica", "I", 7)
    pdf.set_text_color(156, 163, 175)
    pdf.cell(0, 5, f"Generado por NikoFin - {date.today().strftime('%d/%m/%Y')}", align="C")

    return bytes(pdf.output())
