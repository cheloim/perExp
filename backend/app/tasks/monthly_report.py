import json
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

    # By category
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

    top_categories = sorted(by_cat.values(), key=lambda x: x["total"], reverse=True)[:5]

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
            title=f"Reporte listo: {month_name} {y_n}",
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
                    title=f"Reporte listo: {month_name} {y_n}",
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
