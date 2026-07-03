import json
import re
from calendar import monthrange
from collections import defaultdict
from datetime import date, datetime

from app.celery_app import celery_app
from app.database import SessionLocal
from app.models import Category, Expense, MonthlyReport, Notification, User
from app.routers.groups import get_group_user_ids

MONTHS_ES = {
    1: "Enero", 2: "Febrero", 3: "Marzo", 4: "Abril",
    5: "Mayo", 6: "Junio", 7: "Julio", 8: "Agosto",
    9: "Septiembre", 10: "Octubre", 11: "Noviembre", 12: "Diciembre",
}


def _generate_report_data(user_id: int, month_str: str, db) -> dict:
    """Generate the monthly report data for a user and month."""
    from app.services.date_utils import add_months

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

    # By category (all, for pie chart)
    by_cat = defaultdict(lambda: {"total": 0.0, "count": 0, "name": "", "color": ""})
    for e in expenses:
        if e.is_income:
            continue
        cat_name = "Sin categoría"
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

    all_categories = sorted(by_cat.values(), key=lambda x: x["total"], reverse=True)
    top_categories = all_categories[:5]

    # Previous month for comparison
    prev_start = add_months(target_start, -1)
    prev_end = date(prev_start.year, prev_start.month, monthrange(prev_start.year, prev_start.month)[1])
    prev_expenses = (
        db.query(Expense)
        .filter(Expense.user_id.in_(uid_list), Expense.date >= prev_start, Expense.date <= prev_end)
        .all()
    )
    previous_total = sum(abs(e.amount) for e in prev_expenses if not e.is_income)
    previous_income = sum(abs(e.amount) for e in prev_expenses if e.is_income)

    # Same month last year for comparison
    last_year_start = date(y - 1, m, 1)
    last_year_end = date(y - 1, m, monthrange(y - 1, m)[1])
    ly_expenses = (
        db.query(Expense)
        .filter(Expense.user_id.in_(uid_list), Expense.date >= last_year_start, Expense.date <= last_year_end)
        .all()
    )
    last_year_total = sum(abs(e.amount) for e in ly_expenses if not e.is_income)
    last_year_income = sum(abs(e.amount) for e in ly_expenses if e.is_income)

    # Category comparison vs last month
    prev_by_cat = defaultdict(float)
    for e in prev_expenses:
        if e.is_income:
            continue
        cat_name = "Sin categoría"
        if e.category_id:
            cat = db.query(Category).filter(Category.id == e.category_id).first()
            if cat:
                cat_name = cat.name
                if cat.parent_id:
                    parent = db.query(Category).filter(Category.id == cat.parent_id).first()
                    if parent:
                        cat_name = f"{parent.name} > {cat.name}"
        prev_by_cat[cat_name] += abs(e.amount)

    category_comparison = []
    for cat in all_categories[:8]:
        prev_val = prev_by_cat.get(cat["name"], 0.0)
        change_pct = ((cat["total"] - prev_val) / prev_val * 100) if prev_val > 0 else 0
        category_comparison.append({
            "name": cat["name"],
            "total": cat["total"],
            "previous": round(prev_val, 2),
            "change_pct": round(change_pct, 1),
        })

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

    # Top 5 expenses (individual transactions)
    top_expenses = sorted(
        [e for e in expenses if not e.is_income],
        key=lambda e: abs(e.amount),
        reverse=True,
    )[:5]
    top_expenses_data = []
    for e in top_expenses:
        cat_name = "Sin categoría"
        if e.category_id:
            cat = db.query(Category).filter(Category.id == e.category_id).first()
            if cat:
                cat_name = cat.name
        top_expenses_data.append({
            "date": e.date.strftime("%d/%m"),
            "description": (e.description or "")[:40],
            "amount": abs(e.amount),
            "category": cat_name,
        })

    # Accounts summary
    from app.models import Account, Card

    accounts = db.query(Account).filter(Account.user_id.in_(uid_list)).all()
    accounts_summary = []
    for acc in accounts:
        acc_expenses = [e for e in expenses if e.account_id == acc.id and not e.is_income]
        acc_total = sum(abs(e.amount) for e in acc_expenses)
        accounts_summary.append({
            "name": acc.name,
            "type": acc.type,
            "total": round(acc_total, 2),
            "count": len(acc_expenses),
        })
    accounts_summary.sort(key=lambda x: x["total"], reverse=True)

    # Cards summary
    cards = db.query(Card).filter(Card.user_id.in_(uid_list)).all()
    cards_summary = []
    for card in cards:
        card_expenses = [e for e in expenses if e.card_id == card.id and not e.is_income]
        card_total = sum(abs(e.amount) for e in card_expenses)
        cards_summary.append({
            "name": card.card_name,
            "bank": card.bank or "",
            "total": round(card_total, 2),
            "count": len(card_expenses),
        })
    cards_summary.sort(key=lambda x: x["total"], reverse=True)

    # Future installments
    from app.models import ScheduledExpense

    scheduled = (
        db.query(ScheduledExpense)
        .filter(
            ScheduledExpense.user_id.in_(uid_list),
            ScheduledExpense.status == "PENDING",
            ScheduledExpense.scheduled_date > target_end,
        )
        .order_by(ScheduledExpense.scheduled_date)
        .limit(20)
        .all()
    )
    future_installments = []
    for s in scheduled:
        future_installments.append({
            "date": s.scheduled_date.strftime("%d/%m/%Y"),
            "description": (s.description or "")[:40],
            "amount": abs(s.amount),
        })

    # Daily spending pattern (which days of week have most spending)
    from collections import Counter
    DAY_NAMES = ["Lun", "Mar", "Mie", "Jue", "Vie", "Sab", "Dom"]
    day_totals = defaultdict(float)
    for e in expenses:
        if not e.is_income and e.date:
            day_totals[e.date.weekday()] += abs(e.amount)
    daily_pattern = [{"day": DAY_NAMES[d], "total": round(day_totals[d], 2)} for d in range(7)]

    # Category trends (which categories increased vs last month)
    category_trends = []
    for cat_id, cat_data in by_cat.items():
        cat_name = cat_data["name"]
        current_val = cat_data["total"]
        prev_val = prev_by_cat.get(cat_name, 0)
        if prev_val > 0:
            change_pct = ((current_val - prev_val) / prev_val) * 100
        elif current_val > 0:
            change_pct = 100.0  # New category
        else:
            change_pct = 0.0
        category_trends.append({
            "name": cat_name,
            "current": round(current_val, 2),
            "previous": round(prev_val, 2),
            "change_pct": round(change_pct, 1),
            "trend": "up" if change_pct > 5 else "down" if change_pct < -5 else "stable",
        })
    category_trends.sort(key=lambda x: abs(x["change_pct"]), reverse=True)

    # Payment method breakdown
    from app.models import Card
    cards_map = {c.id: c for c in db.query(Card).filter(Card.user_id.in_(uid_list)).all()}
    payment_methods = defaultdict(lambda: {"total": 0.0, "count": 0, "name": ""})
    for e in expenses:
        if e.is_income:
            continue
        if e.card_id and e.card_id in cards_map:
            card = cards_map[e.card_id]
            method = f"{card.bank or 'Tarjeta'} {card.card_name}"
        elif e.account_id:
            method = "Efectivo/Transferencia"
        else:
            method = "Otro"
        payment_methods[method]["total"] += abs(e.amount)
        payment_methods[method]["count"] += 1
        payment_methods[method]["name"] = method
    payment_list = sorted(payment_methods.values(), key=lambda x: x["total"], reverse=True)

    # Investment data for right panel pie chart
    from app.models import Investment
    investments = db.query(Investment).filter(Investment.user_id.in_(uid_list)).all()
    inv_by_broker = defaultdict(float)
    for inv in investments:
        value = (inv.quantity or 0) * (inv.current_price or inv.avg_cost or 0)
        if value > 0:
            inv_by_broker[inv.broker or "Otro"] += value
    investment_list = [{"name": k, "total": round(v, 2)} for k, v in inv_by_broker.items() if v > 0]
    investment_list.sort(key=lambda x: x["total"], reverse=True)

    # Spending velocity (daily average)
    days_in_month = monthrange(y, m)[1]
    daily_avg = total_expenses / max(days_in_month, 1)

    # Previous month daily average for comparison
    prev_y, prev_m = prev_start.year, prev_start.month
    prev_days = monthrange(prev_y, prev_m)[1]
    prev_daily_avg = previous_total / max(prev_days, 1) if previous_total > 0 else 0

    velocity_data = {
        "current_daily": round(daily_avg, 2),
        "previous_daily": round(prev_daily_avg, 2),
    }

    # Recurring expenses (same description + amount, 2+ times)
    from collections import Counter
    merchant_amounts = [(e.description.strip(), abs(e.amount)) for e in expenses if not e.is_income]
    recurring_counter = Counter(merchant_amounts)
    recurring_list = [
        {"description": desc, "total": round(total, 2), "count": count}
        for (desc, total), count in recurring_counter.items()
        if count >= 2
    ]
    recurring_list.sort(key=lambda x: x["total"], reverse=True)

    # Weekend vs Weekday
    weekend_total = sum(abs(e.amount) for e in expenses if not e.is_income and e.date and e.date.weekday() >= 5)
    weekday_total = total_expenses - weekend_total
    weekend_data = {
        "weekend": round(weekend_total, 2),
        "weekday": round(weekday_total, 2),
    }

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
            for e in top_expenses_data:
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
  "resume": "<resumen completo y detallado de 5-6 lineas que cubra: comparativa con mes anterior, distribucion de categorias, estado de cuentas/tarjetas, cuotas futuras, y tendencias. Usar numeros concretos.>",
  "highlights": ["<highlight 1>", "<highlight 2>", "<highlight 3>"],
  "concern": "<preocupacion o null>",
  "alerts": ["<alerta critica o null, ej: gasto excesivo en X>"],
  "flags": ["<bandera de atencion o null, ej: tendencia preocupante en Y>"],
  "tip": "<consejo concreto de ahorro>",
  "next_month_suggestion": "<sugerencia especifica para el proximo mes>",
  "hbar_notes": "<nota breve sobre la comparativa de gastos corriente vs anterior, 1 linea>",
  "vbar_notes": "<nota breve sobre la distribucion por categorias y cual cambio mas, 1 linea>",
  "heatmap_notes": "<nota breve sobre que cuenta/tarjeta gasto mas, 1 linea>",
  "cuotas_notes": "<nota breve sobre impacto de cuotas futuras, 1 linea>"
}
Sé especifico con numeros. Español, claro, amigable. Sin emojis.
El resume debe ser un texto corrido y detallado, no solo oraciones sueltas.
Usa alerts para gastos criticos o inusuales.
Usa flags para tendencias preocupantes a monitorear."""

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
            raw_text = response.text.strip()
            print(f"[MONTHLY REPORT] LLM raw response ({len(raw_text)} chars)")
            # Print last 500 chars to see what's after the JSON
            print(f"[MONTHLY REPORT] Last 500 chars: {raw_text[-500:]}")
            # Also print first 200 chars
            print(f"[MONTHLY REPORT] First 200 chars: {raw_text[:200]}")

            analysis = None
            # Strategy 1: Direct parse
            try:
                analysis = json.loads(raw_text)
                print(f"[MONTHLY REPORT] Strategy 1 (direct) succeeded")
            except json.JSONDecodeError as e:
                print(f"[MONTHLY REPORT] Strategy 1 failed: {e}")

            # Strategy 2: Extract from markdown code blocks
            if analysis is None:
                for marker in ["```json", "```"]:
                    if marker in raw_text:
                        try:
                            extracted = raw_text.split(marker)[1].split("```")[0].strip()
                            analysis = json.loads(extracted)
                            print(f"[MONTHLY REPORT] Strategy 2 (markdown) succeeded")
                            break
                        except (json.JSONDecodeError, IndexError) as e:
                            print(f"[MONTHLY REPORT] Strategy 2 failed: {e}")

            # Strategy 3: Find first { ... } block
            if analysis is None:
                try:
                    start = raw_text.find("{")
                    end = raw_text.rfind("}") + 1
                    if start >= 0 and end > start:
                        snippet = raw_text[start:end]
                        print(f"[MONTHLY REPORT] Strategy 3 snippet ({len(snippet)} chars): {snippet[:100]}...")
                        analysis = json.loads(snippet)
                        print(f"[MONTHLY REPORT] Strategy 3 (find braces) succeeded")
                except json.JSONDecodeError as e:
                    print(f"[MONTHLY REPORT] Strategy 3 failed: {e}")

            # Strategy 4: Clean and retry
            if analysis is None:
                try:
                    cleaned = raw_text.strip()
                    if cleaned.startswith("```"):
                        lines = cleaned.split("\n")
                        cleaned = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])
                    cleaned = cleaned.strip()
                    # Find the last closing brace and truncate
                    last_brace = cleaned.rfind("}")
                    if last_brace > 0:
                        cleaned = cleaned[:last_brace + 1]
                    analysis = json.loads(cleaned)
                    print(f"[MONTHLY REPORT] Strategy 4 (clean) succeeded")
                except json.JSONDecodeError as e:
                    print(f"[MONTHLY REPORT] Strategy 4 failed: {e}")

            # Strategy 5: Fix common JSON issues (missing commas, trailing commas)
            if analysis is None:
                try:
                    cleaned = raw_text.strip()
                    if cleaned.startswith("```"):
                        lines = cleaned.split("\n")
                        cleaned = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])
                    cleaned = cleaned.strip()
                    last_brace = cleaned.rfind("}")
                    if last_brace > 0:
                        cleaned = cleaned[:last_brace + 1]
                    # Fix missing commas between JSON key-value pairs
                    # Match: "value"\n  "key"  ->  "value",\n  "key"
                    cleaned = re.sub(r'(".*?")\s*\n(\s*")', r'\1,\n\2', cleaned)
                    # Fix missing commas after arrays/objects
                    cleaned = re.sub(r'(\])\s*\n(\s*")', r'\1,\n\2', cleaned)
                    cleaned = re.sub(r'(\})\s*\n(\s*")', r'\1,\n\2', cleaned)
                    # Remove trailing commas before closing braces
                    cleaned = re.sub(r',\s*}', '}', cleaned)
                    cleaned = re.sub(r',\s*]', ']', cleaned)
                    analysis = json.loads(cleaned)
                    print(f"[MONTHLY REPORT] Strategy 5 (fix JSON) succeeded")
                except json.JSONDecodeError as e:
                    print(f"[MONTHLY REPORT] All JSON strategies failed: {e}")
                    analysis = None
        except Exception as e:
            print(f"[MONTHLY REPORT] LLM analysis failed: {e}")
            analysis = None

    if analysis is None:
        raise ValueError("No se pudo generar el analisis LLM. Verifique la configuracion de la API key.")

    return {
        "month": month_str,
        "total_expenses": total_expenses,
        "total_income": total_income,
        "savings_rate": round(savings_rate, 1),
        "expense_count": count,
        "all_categories": all_categories,
        "top_categories": top_categories,
        "category_comparison": category_comparison,
        "previous_total": previous_total,
        "previous_income": previous_income,
        "last_year_total": last_year_total,
        "last_year_income": last_year_income,
        "mom_change": round(mom_change, 1),
        "trend_history": trend_history,
        "top_expenses": top_expenses_data,
        "accounts_summary": accounts_summary,
        "cards_summary": cards_summary,
        "future_installments": future_installments,
        "future_installments_count": len(future_installments),
        "future_installments_total": round(sum(fi["amount"] for fi in future_installments), 2),
        "daily_pattern": daily_pattern,
        "category_trends": category_trends,
        "payment_methods": payment_list,
        "investments": investment_list,
        "velocity_data": velocity_data,
        "recurring_expenses": recurring_list,
        "weekend_data": weekend_data,
        "analysis": analysis,
    }


@celery_app.task(name="app.tasks.monthly_report.generate_single_report")
def generate_single_report(user_id: int, month_str: str):
    """
    Generate a single monthly report for a user.
    Called on-demand from the API. Creates notification when done.
    """
    db = SessionLocal()
    try:
        from app.services.pdf_report import generate_pdf

        # Find the pending report
        report = (
            db.query(MonthlyReport)
            .filter(
                MonthlyReport.user_id == user_id,
                MonthlyReport.month == month_str,
                MonthlyReport.status == "PENDING",
            )
            .first()
        )
        if not report:
            print(f"[MONTHLY REPORT] No pending report found for user {user_id}, month {month_str}")
            return

        # Generate report data
        report_data = _generate_report_data(user_id, month_str, db)

        # Generate PDF
        user = db.query(User).filter(User.id == user_id).first()
        user_name = user.full_name if user and user.full_name else (user.email if user else "Usuario")
        pdf_bytes = generate_pdf(report_data, user_name)

        # Update report
        report.report_data = json.dumps(report_data)
        report.pdf_data = pdf_bytes
        report.status = "READY"
        report.generated_at = datetime.utcnow()

        # Create notification
        y_n, m_n = int(month_str[:4]), int(month_str[5:7])
        month_name = MONTHS_ES.get(m_n, str(m_n))
        notification = Notification(
            user_id=user_id,
            type="monthly_report_ready",
            title=f"Reporte generado: {month_name} {y_n}",
            body="Tu reporte mensual PDF está listo para descargar.",
            data=json.dumps({"month": month_str}),
            read=False,
        )
        db.add(notification)
        db.commit()
        print(f"[MONTHLY REPORT] Generated report for user {user_id}, month {month_str}")

    except Exception as e:
        print(f"[MONTHLY REPORT] Error generating report for user {user_id}: {e}")
        import traceback
        traceback.print_exc()

        # Mark as failed
        try:
            report = (
                db.query(MonthlyReport)
                .filter(
                    MonthlyReport.user_id == user_id,
                    MonthlyReport.month == month_str,
                )
                .first()
            )
            if report:
                report.status = "FAILED"
                report.error_message = str(e)[:500]
                db.commit()

            # Create error notification
            y_n, m_n = int(month_str[:4]), int(month_str[5:7])
            month_name = MONTHS_ES.get(m_n, str(m_n))
            notification = Notification(
                user_id=user_id,
                type="monthly_report_failed",
                title=f"Error al generar reporte: {month_name} {y_n}",
                body=f"No se pudo generar: {str(e)[:100]}",
                data=json.dumps({"month": month_str, "error": str(e)[:200]}),
                read=False,
            )
            db.add(notification)
            db.commit()
        except Exception:
            db.rollback()

    finally:
        db.close()


@celery_app.task(name="app.tasks.monthly_report.generate_monthly_reports")
def generate_monthly_reports():
    """
    Generate monthly reports for all users.
    Runs on the 1st of each month at 20:00 UTC-3 (23:00 UTC).
    """
    db = SessionLocal()
    try:
        from app.services.date_utils import add_months

        today = date.today()
        prev_month = add_months(today.replace(day=1), -1)
        month_str = prev_month.strftime("%Y-%m")

        users = db.query(User).filter(User.is_active == True).all()
        generated_count = 0

        for user in users:
            # Check if report already exists
            existing = (
                db.query(MonthlyReport)
                .filter(MonthlyReport.user_id == user.id, MonthlyReport.month == month_str)
                .first()
            )
            if existing:
                continue

            try:
                report_data = _generate_report_data(user.id, month_str, db)

                # Generate PDF
                from app.services.pdf_report import generate_pdf

                user_name = user.full_name if user.full_name else user.email
                pdf_bytes = generate_pdf(report_data, user_name)

                report = MonthlyReport(
                    user_id=user.id,
                    month=month_str,
                    status="READY",
                    report_data=json.dumps(report_data),
                    pdf_data=pdf_bytes,
                    generated_at=datetime.utcnow(),
                )
                db.add(report)
                generated_count += 1

                # Create notification
                y_n, m_n = int(month_str[:4]), int(month_str[5:7])
                month_name = MONTHS_ES.get(m_n, str(m_n))
                notification = Notification(
                    user_id=user.id,
                    type="monthly_report_ready",
                    title=f"Reporte generado: {month_name} {y_n}",
                    body="Tu reporte mensual PDF está listo para descargar.",
                    data=json.dumps({"month": month_str}),
                    read=False,
                )
                db.add(notification)

            except Exception as e:
                print(f"[MONTHLY REPORT] Error generating for user {user.id}: {e}")
                continue

        db.commit()
        print(f"[MONTHLY REPORT] Generated {generated_count} reports for {month_str}")
    except Exception as e:
        print(f"[MONTHLY REPORT] Error: {e}")
        db.rollback()
    finally:
        db.close()
