"""Printable HTML for the monthly report download (#566)."""

from __future__ import annotations

from datetime import date

from app.services.date_utils import MONTHS_ES
from app.services.money import format_money


def build_report_html(data: dict, user_name: str) -> str:
    """Build a printable HTML report from monthly report data."""
    month_str = data["month"]
    year, month_num = month_str.split("-")
    month_name = MONTHS_ES.get(int(month_num), month_num)

    categories_html = ""
    for cat in data.get("top_categories", []):
        pct = (cat["total"] / data["total_expenses"] * 100) if data["total_expenses"] > 0 else 0
        categories_html += f"""
        <tr>
            <td style="padding:8px;border-bottom:1px solid #eee;">
                <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:{cat["color"]};margin-right:8px;vertical-align:middle;"></span>
                {cat["name"]}
            </td>
            <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">{format_money(cat["total"], "ARS")}</td>
            <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">{cat["count"]}</td>
            <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">{pct:.1f}%</td>
        </tr>"""

    trend_rows = ""
    for t in data.get("trend_history", []):
        y_t, m_t = t["month"].split("-")
        m_name = MONTHS_ES.get(int(m_t), m_t)
        trend_rows += f"""
        <tr>
            <td style="padding:6px;border-bottom:1px solid #eee;">{m_name} {y_t}</td>
            <td style="padding:6px;border-bottom:1px solid #eee;text-align:right;">{format_money(t["expenses"], "ARS")}</td>
            <td style="padding:6px;border-bottom:1px solid #eee;text-align:right;">{format_money(t["income"], "ARS")}</td>
            <td style="padding:6px;border-bottom:1px solid #eee;text-align:right;">{format_money(t["income"] - t["expenses"], "ARS")}</td>
        </tr>"""

    analysis_html = ""
    if data.get("analysis"):
        a = data["analysis"]
        analysis_html = f"""
        <div style="margin-top:30px;padding:20px;background:#f8f9fa;border-radius:8px;">
            <h2 style="color:#6366f1;margin-bottom:15px;">✨ Análisis IA</h2>
            <p style="color:#374151;line-height:1.6;">{a.get("summary", "")}</p>
            {"".join(f'<p style="color:#059669;margin:5px 0;">✓ {h}</p>' for h in a.get("highlights", []))}
            {"".join(f'<p style="color:#d97706;margin:5px 0;">⚠️ {a["concern"]}</p>' if a.get("concern") else "")}
            {"".join(f'<p style="color:#6366f1;margin:5px 0;">💡 {a["tip"]}</p>' if a.get("tip") else "")}
        </div>"""

    savings_color = "#059669" if data["savings_rate"] >= 0 else "#dc2626"
    mom_color = "#059669" if data["mom_change"] <= 0 else "#dc2626"
    mom_arrow = "↓" if data["mom_change"] < 0 else "↑" if data["mom_change"] > 0 else "→"

    return f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Reporte Mensual - {month_name} {year}</title>
    <style>
        @media print {{
            body {{ margin: 0; }}
            .no-print {{ display: none !important; }}
        }}
    </style>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; color: #1f2937;">
    <div class="no-print" style="text-align: right; margin-bottom: 20px;">
        <button onclick="window.print()" style="background: #6366f1; color: white; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; font-size: 14px;">
            🖨️ Imprimir / Guardar PDF
        </button>
    </div>

    <div style="text-align: center; margin-bottom: 30px;">
        <h1 style="color: #6366f1; margin: 0;">📊 Reporte Mensual</h1>
        <p style="color: #6b7280; margin: 5px 0;">{month_name} {year}</p>
        <p style="color: #9ca3af; font-size: 12px;">Generado para {user_name}</p>
    </div>

    <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin-bottom: 30px;">
        <div style="background: #fef2f2; padding: 15px; border-radius: 8px; text-align: center;">
            <p style="color: #6b7280; font-size: 11px; margin: 0;">GASTOS</p>
            <p style="color: #dc2626; font-size: 20px; font-weight: bold; margin: 5px 0;">{format_money(data["total_expenses"], "ARS")}</p>
            <p style="color: #9ca3af; font-size: 11px; margin: 0;">{data["expense_count"]} transacciones</p>
        </div>
        <div style="background: #f0fdf4; padding: 15px; border-radius: 8px; text-align: center;">
            <p style="color: #6b7280; font-size: 11px; margin: 0;">INGRESOS</p>
            <p style="color: #059669; font-size: 20px; font-weight: bold; margin: 5px 0;">{format_money(data["total_income"], "ARS")}</p>
        </div>
        <div style="background: #f5f3ff; padding: 15px; border-radius: 8px; text-align: center;">
            <p style="color: #6b7280; font-size: 11px; margin: 0;">TASA DE AHORRO</p>
            <p style="color: {savings_color}; font-size: 20px; font-weight: bold; margin: 5px 0;">{data["savings_rate"]}%</p>
        </div>
        <div style="background: #f8fafc; padding: 15px; border-radius: 8px; text-align: center;">
            <p style="color: #6b7280; font-size: 11px; margin: 0;">VS MES ANTERIOR</p>
            <p style="color: {mom_color}; font-size: 20px; font-weight: bold; margin: 5px 0;">{mom_arrow} {abs(data["mom_change"])}%</p>
        </div>
    </div>

    <h2 style="color: #374151; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px;">Top Categorías</h2>
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 30px;">
        <thead>
            <tr style="background: #f9fafb;">
                <th style="padding: 8px; text-align: left; font-size: 12px; color: #6b7280;">Categoría</th>
                <th style="padding: 8px; text-align: right; font-size: 12px; color: #6b7280;">Monto</th>
                <th style="padding: 8px; text-align: right; font-size: 12px; color: #6b7280;">Transacciones</th>
                <th style="padding: 8px; text-align: right; font-size: 12px; color: #6b7280;">%</th>
            </tr>
        </thead>
        <tbody>{categories_html}</tbody>
    </table>

    <h2 style="color: #374151; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px;">Evolución (6 meses)</h2>
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 30px;">
        <thead>
            <tr style="background: #f9fafb;">
                <th style="padding: 6px; text-align: left; font-size: 12px; color: #6b7280;">Mes</th>
                <th style="padding: 6px; text-align: right; font-size: 12px; color: #6b7280;">Gastos</th>
                <th style="padding: 6px; text-align: right; font-size: 12px; color: #6b7280;">Ingresos</th>
                <th style="padding: 6px; text-align: right; font-size: 12px; color: #6b7280;">Balance</th>
            </tr>
        </thead>
        <tbody>{trend_rows}</tbody>
    </table>

    {analysis_html}

    <div style="margin-top: 40px; text-align: center; color: #9ca3af; font-size: 11px; border-top: 1px solid #e5e7eb; padding-top: 15px;">
        Generado por NikoFin • {date.today().strftime("%d/%m/%Y")}
    </div>
</body>
</html>"""
