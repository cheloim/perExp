import json
from calendar import monthrange
from collections import defaultdict
from datetime import date

from app.celery_app import celery_app
from app.database import SessionLocal
from app.models import Category, Expense, MonthlyReport, User
from app.routers.groups import get_group_user_ids


def _generate_report_data(user_id: int, month_str: str, db) -> dict:
    """Generate the monthly report data for a user and month."""
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
    from app.services.date_utils import add_months

    prev_start = add_months(target_start, -1)
    prev_end = date(prev_start.year, prev_start.month, monthrange(prev_start.year, prev_start.month)[1])
    prev_expenses = (
        db.query(Expense)
        .filter(Expense.user_id.in_(uid_list), Expense.date >= prev_start, Expense.date <= prev_end)
        .all()
    )
    previous_total = sum(abs(e.amount) for e in prev_expenses if not e.is_income)
    previous_income = sum(abs(e.amount) for e in prev_expenses if e.is_income)

    # Savings rate
    savings_rate = 0.0
    if total_income > 0:
        savings_rate = ((total_income - total_expenses) / total_income) * 100

    # MoM change
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


@celery_app.task(name="app.tasks.monthly_report.generate_monthly_reports")
def generate_monthly_reports():
    """
    Generate monthly reports for all users.
    Runs on the 1st of each month at 20:00 UTC-3 (23:00 UTC).
    """
    db = SessionLocal()
    try:
        # Generate for previous month
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
                report = MonthlyReport(
                    user_id=user.id,
                    month=month_str,
                    report_data=json.dumps(report_data),
                    generated_at=date.today(),
                )
                db.add(report)
                generated_count += 1
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


def generate_user_report(user_id: int, month_str: str) -> dict:
    """Generate and store a report for a specific user and month. Used for on-demand generation."""
    db = SessionLocal()
    try:
        # Check if report already exists
        existing = (
            db.query(MonthlyReport)
            .filter(MonthlyReport.user_id == user_id, MonthlyReport.month == month_str)
            .first()
        )
        if existing:
            return json.loads(existing.report_data)

        report_data = _generate_report_data(user_id, month_str, db)
        report = MonthlyReport(
            user_id=user_id,
            month=month_str,
            report_data=json.dumps(report_data),
            generated_at=date.today(),
        )
        db.add(report)
        db.commit()
        return report_data
    finally:
        db.close()
