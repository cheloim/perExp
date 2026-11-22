"""Monthly report generation, listing and download payloads (#566).

The HTTP router keeps the endpoints and dependency wiring; this module owns the
report math, the LLM context and the error semantics (translated to HTTP by the
router).
"""

from __future__ import annotations

import json
from calendar import monthrange
from collections import defaultdict
from datetime import date, datetime

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import Category, Expense, MonthlyReport, Notification, User
from app.services.access import scoped_user_ids
from app.services.aggregation import ars_amount_expression
from app.services.dashboard_report_html import build_report_html
from app.services.date_utils import MONTHS_ES, add_months
from app.services.llm import LLMMessage, get_client, is_configured
from app.services.money import format_money


class ReportRequestError(Exception):
    """Report request that the HTTP layer must translate into an HTTP error."""

    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


async def compute_monthly_report(
    month: str | None = None,
    db: Session = None,
    current_user: User = None,
):
    """Generate a monthly analysis report with income vs expenses and LLM insights."""
    uid_list = scoped_user_ids(current_user, db)

    # Determine target month
    if month:
        try:
            y, m = int(month[:4]), int(month[5:7])
            target_start = date(y, m, 1)
        except (ValueError, IndexError):
            target_start = date.today().replace(day=1)
    else:
        target_start = date.today().replace(day=1)

    target_end = date(
        target_start.year, target_start.month, monthrange(target_start.year, target_start.month)[1]
    )

    # Previous month for comparison
    prev_start = add_months(target_start, -1)
    prev_end = date(
        prev_start.year, prev_start.month, monthrange(prev_start.year, prev_start.month)[1]
    )

    # Issue #393 (item 4): when reporting the current month, also compare
    # against the previous month cut at the same day (MTD) and project pace.
    today = date.today()
    is_current_month = target_start.strftime("%Y-%m") == today.strftime("%Y-%m")
    mtd_cutoff = today.day if is_current_month else None

    def _query_totals(start: date, end: date):
        converted = ars_amount_expression(db, uid_list)
        base_filter = [
            Expense.user_id.in_(uid_list),
            Expense.date >= start,
            Expense.date <= end,
        ]
        total_expenses = (
            db.query(func.coalesce(func.sum(func.abs(converted)), 0.0))
            .filter(*base_filter, Expense.is_income == False)
            .scalar()
        )
        total_income = (
            db.query(func.coalesce(func.sum(func.abs(converted)), 0.0))
            .filter(*base_filter, Expense.is_income == True)
            .scalar()
        )
        count = (
            db.query(func.count(Expense.id))
            .filter(*base_filter, Expense.is_income == False)
            .scalar()
        )

        # Pre-fetch all categories for the user to avoid N+1 queries
        all_cats = {
            c.id: c for c in db.query(Category).filter(Category.user_id.in_(uid_list)).all()
        }
        # Also fetch parent categories (they may belong to a different user in the group)
        parent_ids = {c.parent_id for c in all_cats.values() if c.parent_id}
        if parent_ids:
            parents = {
                c.id: c for c in db.query(Category).filter(Category.id.in_(parent_ids)).all()
            }
            all_cats.update(parents)

        # By category (only expenses, not income) — aggregated in SQL
        cat_rows = (
            db.query(
                Expense.category_id,
                func.coalesce(func.sum(func.abs(converted)), 0.0),
                func.count(Expense.id),
            )
            .filter(*base_filter, Expense.is_income == False)
            .group_by(Expense.category_id)
            .all()
        )
        by_cat = defaultdict(lambda: {"total": 0.0, "count": 0, "name": "", "color": ""})
        for cat_id, cat_total, cat_count in cat_rows:
            cat_name = "Sin categoría"
            cat_color = "#6b7280"
            if cat_id:
                cat = all_cats.get(cat_id)
                if cat:
                    cat_name = cat.name
                    cat_color = cat.color or "#6b7280"
                    if cat.parent_id:
                        parent = all_cats.get(cat.parent_id)
                        if parent:
                            cat_name = f"{parent.name} > {cat.name}"
            by_cat[cat_id or 0]["total"] = float(cat_total)
            by_cat[cat_id or 0]["count"] = cat_count
            by_cat[cat_id or 0]["name"] = cat_name
            by_cat[cat_id or 0]["color"] = cat_color

        top_categories = sorted(by_cat.values(), key=lambda x: x["total"], reverse=True)[:5]

        return {
            "total_expenses": float(total_expenses),
            "total_income": float(total_income),
            "count": count,
            "top_categories": top_categories,
        }

    current = _query_totals(target_start, target_end)
    previous = _query_totals(prev_start, prev_end)

    # MTD slice of the previous month (same-day comparison). For closed months
    # the MTD window is the whole month, so it equals the full comparison.
    if is_current_month:
        prev_mtd_end = date(prev_start.year, prev_start.month, min(today.day, prev_end.day))
        previous_mtd = _query_totals(prev_start, prev_mtd_end)
    else:
        previous_mtd = previous

    # Savings rate
    savings_rate = 0.0
    if current["total_income"] > 0:
        savings_rate = (
            (current["total_income"] - current["total_expenses"]) / current["total_income"]
        ) * 100

    # MoM change
    mom_change = 0.0
    if previous["total_expenses"] > 0:
        mom_change = (
            (current["total_expenses"] - previous["total_expenses"]) / previous["total_expenses"]
        ) * 100

    # MTD change (same-day pace) + month-end projection at current pace
    mtd_change = 0.0
    projected_total = None
    if is_current_month:
        if previous_mtd["total_expenses"] > 0:
            mtd_change = (
                (current["total_expenses"] - previous_mtd["total_expenses"])
                / previous_mtd["total_expenses"]
            ) * 100
        days_in_month = monthrange(target_start.year, target_start.month)[1]
        projected_total = round(current["total_expenses"] / today.day * days_in_month, 2)

    # 6-month trend history for charts — single GROUP BY query
    trend_start = add_months(target_start, -5).replace(day=1)
    # Una sola expresión compartida entre SELECT y GROUP BY: con psycopg v3 (server-side
    # binds) dos llamadas iguales generan dos parámetros distintos y Postgres rechaza el
    # GROUP BY porque no puede probar que sean la misma expresión.
    month_key = func.to_char(Expense.date, "YYYY-MM")
    converted = ars_amount_expression(db, uid_list)
    trend_rows = (
        db.query(
            month_key,
            Expense.is_income,
            func.coalesce(func.sum(func.abs(converted)), 0.0),
        )
        .filter(
            Expense.user_id.in_(uid_list), Expense.date >= trend_start, Expense.date <= target_end
        )
        .group_by(month_key, Expense.is_income)
        .all()
    )
    trend_map: dict = {}
    for mkey, is_inc, tot in trend_rows:
        d = trend_map.setdefault(mkey, {"expenses": 0.0, "income": 0.0})
        if is_inc:
            d["income"] = float(tot)
        else:
            d["expenses"] = float(tot)
    trend_history = []
    for i in range(5, -1, -1):
        m = add_months(target_start, -i)
        mkey = m.strftime("%Y-%m")
        vals = trend_map.get(mkey, {"expenses": 0.0, "income": 0.0})
        trend_history.append(
            {
                "month": mkey,
                "expenses": round(vals["expenses"], 2),
                "income": round(vals["income"], 2),
            }
        )

    # LLM analysis
    analysis = None
    if is_configured():
        try:
            import asyncio

            # Build context for LLM
            trend_lines = []
            for t in trend_history:
                trend_lines.append(
                    f"  {t['month']}: gastos={format_money(t['expenses'], 'ARS')}, ingresos={format_money(t['income'], 'ARS')}"
                )

            cat_lines = []
            for cat in current["top_categories"]:
                cat_lines.append(
                    f"  - {cat['name']}: {format_money(cat['total'], 'ARS')} ({cat['count']} transacciones)"
                )

            llm_context = f"""ANÁLISIS MENSUAL - {target_start.strftime("%B %Y").capitalize()}

RESUMEN DEL MES:
- Gastos totales: {format_money(current["total_expenses"], "ARS")}
- Ingresos totales: {format_money(current["total_income"], "ARS")}
- Tasa de ahorro: {savings_rate:.1f}%
- Cantidad de transacciones: {current["count"]}
- Variación vs mes anterior: {mom_change:+.1f}%
{"- Variación mismo día mes anterior (MTD): " + f"{mtd_change:+.1f}%" if is_current_month else ""}
{"- Proyección fin de mes (ritmo actual): " + format_money(projected_total, "ARS") if is_current_month and projected_total is not None else ""}

TOP CATEGORÍAS:
{chr(10).join(cat_lines) or "  Sin datos"}

HISTORIAL (últimos 6 meses):
{chr(10).join(trend_lines)}

Fecha actual: {today.isoformat()}"""

            prompt = """Sos un analista financiero personal. Analizá el resumen mensual y devolvé UNICAMENTE JSON válido.

El JSON debe tener esta estructura:
{
  "summary": "<resumen ejecutivo de 2-3 líneas del mes, con emojis>",
  "highlights": ["<highlight 1>", "<highlight 2>", "<highlight 3>"],
  "concern": "<preocupación o área de mejora, o null si todo está bien>",
  "tip": "<consejo concreto de ahorro basado en los datos>"
}

Sé específico con los números. Respondé en español, de forma clara y amigable. Usá emojis para hacerlo más visual."""

            analysis = await asyncio.wait_for(
                get_client().acomplete_json(
                    [LLMMessage(role="user", text=llm_context)],
                    feature="dashboard_monthly",
                    system=prompt,
                ),
                timeout=8.0,
            )
        except Exception:
            analysis = None  # Don't fail the endpoint if LLM fails

    return {
        "month": target_start.strftime("%Y-%m"),
        "total_expenses": current["total_expenses"],
        "total_income": current["total_income"],
        "savings_rate": round(savings_rate, 1),
        "expense_count": current["count"],
        "top_categories": current["top_categories"],
        "previous_total": previous["total_expenses"],
        "previous_income": previous["total_income"],
        "mom_change": round(mom_change, 1),
        "is_current_month": is_current_month,
        "mtd_cutoff_day": mtd_cutoff,
        "previous_mtd_total": previous_mtd["total_expenses"],
        "previous_mtd_income": previous_mtd["total_income"],
        "mtd_change": round(mtd_change, 1),
        "projected_total": projected_total,
        "trend_history": trend_history,
        "analysis": analysis,
    }


def monthly_report_download(month: str | None, db: Session, current_user: User) -> str:
    """Return the printable HTML for a month, generating it on demand."""
    from app.tasks.monthly_report import _generate_report_data

    if month:
        try:
            y, m = int(month[:4]), int(month[5:7])
            month_str = f"{y}-{m:02d}"
        except (ValueError, IndexError):
            month_str = date.today().replace(day=1).strftime("%Y-%m")
    else:
        month_str = date.today().replace(day=1).strftime("%Y-%m")

    report_data = _generate_report_data(current_user.id, month_str, db)

    user_name = current_user.full_name or current_user.email
    return build_report_html(report_data, user_name)


def list_monthly_reports(db: Session, current_user: User) -> dict:
    """List generated monthly reports for the current user."""
    reports = (
        db.query(MonthlyReport)
        .filter(MonthlyReport.user_id == current_user.id)
        .order_by(MonthlyReport.month.desc())
        .all()
    )

    result = []
    for r in reports:
        report_data = json.loads(r.report_data) if r.report_data else {}
        result.append(
            {
                "month": r.month,
                "status": r.status or "READY",
                "total_expenses": report_data.get("total_expenses", 0)
                if r.status == "READY"
                else None,
                "generated_at": r.generated_at.isoformat() if r.generated_at else None,
            }
        )

    return {"reports": result}


def request_monthly_report(month: str, db: Session, current_user: User) -> dict:
    """Validate and queue an on-demand monthly report generation."""
    try:
        y, m_int = int(month[:4]), int(month[5:7])
        month_str = f"{y}-{m_int:02d}"
    except (ValueError, IndexError):
        raise ReportRequestError(400, "Invalid month format. Use YYYY-MM.")

    # Validate month range
    if m_int < 1 or m_int > 12:
        raise ReportRequestError(400, "Invalid month. Use a value between 01 and 12.")

    # Validate: cannot generate current month before 20:00 on last day (UTC-3)
    today = date.today()
    last_day = monthrange(y, m_int)[1]
    deadline = datetime(y, m_int, last_day, 23, 0, 0)  # 23:00 UTC = 20:00 UTC-3

    if y == today.year and m_int == today.month and datetime.utcnow() < deadline:
        month_name = MONTHS_ES.get(m_int, str(m_int))
        raise ReportRequestError(
            400,
            f"El reporte de {month_name} {y} estará disponible después de las 20:00 del {last_day} de {month_name}.",
        )

    # Reject future months
    if date(y, m_int, 1) > today.replace(day=1):
        raise ReportRequestError(400, "No se pueden generar reportes de meses futuros.")

    # Check if already exists and ready
    existing = (
        db.query(MonthlyReport)
        .filter(MonthlyReport.user_id == current_user.id, MonthlyReport.month == month_str)
        .first()
    )
    if existing and existing.status == "READY":
        return {"month": month_str, "status": "already_exists"}
    if existing and existing.status == "PENDING":
        return {"month": month_str, "status": "already_generating"}

    # Create PENDING record
    report = MonthlyReport(
        user_id=current_user.id,
        month=month_str,
        status="PENDING",
        report_data="{}",
    )
    db.add(report)

    # Create queued notification
    y_n, m_n = int(month_str[:4]), int(month_str[5:7])
    month_name = MONTHS_ES.get(m_n, str(m_n))
    notification = Notification(
        user_id=current_user.id,
        type="monthly_report_queued",
        title=f"Generando reporte: {month_name} {y_n}",
        body="Tu reporte se está generando...",
        data=json.dumps({"month": month_str}),
        read=False,
    )
    db.add(notification)
    db.commit()

    # Dispatch Celery task
    from app.tasks.monthly_report import generate_single_report

    generate_single_report.delay(current_user.id, month_str)

    return {"month": month_str, "status": "queued"}


def report_image_payload(month: str, db: Session, current_user: User) -> tuple[bytes, str, str]:
    """Return (content, media_type, filename) for a generated report image."""
    report = (
        db.query(MonthlyReport)
        .filter(MonthlyReport.user_id == current_user.id, MonthlyReport.month == month)
        .first()
    )

    if not report:
        raise ReportRequestError(404, "Report not found.")

    # Try png_data first, fallback to pdf_data for legacy reports
    image_data = report.png_data or report.pdf_data
    if not image_data:
        raise ReportRequestError(404, "Report not generated yet.")

    # Determine content type
    if report.png_data:
        media_type = "image/png"
        filename = f"reporte-{month}.png"
    else:
        media_type = "application/pdf"
        filename = f"reporte-{month}.pdf"

    return bytes(image_data), media_type, filename
