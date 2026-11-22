"""Spending calculations for budgets (#569).

Every helper here answers "how much was spent" for a category or macro group
in the budget's currency. Conversion is delegated to
``services.aggregation`` so budgets follow the same FX contract as the
dashboard and Gastos (#508c/#508d): rows are never summed nominally.
"""

from calendar import monthrange
from datetime import date, timedelta

from sqlalchemy.orm import Session

from app.models import Category, Expense
from app.services.access import scoped_user_ids_for
from app.services.aggregation import fallback_rate as resolve_fallback_rate
from app.services.aggregation import spending_breakdown_from_rows


def group_user_ids(user_id: int, db: Session) -> list[int]:
    """Canonical tenant scope."""
    return scoped_user_ids_for(user_id, db)


def converted_spending(rows, db: Session, target: str = "ARS") -> float:
    """Convert budget rows to the budget's currency, never summing nominally."""
    if target == "USD":
        fallback = resolve_fallback_rate(db)
        rate = float(fallback["rate"]) if fallback and fallback.get("rate") else None
        total = 0.0
        for amount, currency, _fx_rate, _fx_date, _fx_source in rows:
            if (currency or "ARS") == "USD":
                total += abs(float(amount))
            elif (currency or "ARS") == "ARS" and rate:
                total += abs(float(amount)) / rate
        return round(total, 2)

    needs_fallback = any(
        (currency or "ARS") != "ARS" and fx_rate is None
        for _amount, currency, fx_rate, _fx_date, _fx_source in rows
    )
    fallback = resolve_fallback_rate(db) if needs_fallback else None
    return spending_breakdown_from_rows(
        (
            (abs(float(amount)), currency, fx_rate, fx_date, fx_source)
            for amount, currency, fx_rate, fx_date, fx_source in rows
        ),
        fallback=fallback,
    ).converted_total


def spending_for_category(
    category_id: int,
    year: int,
    month: int,
    uid_list: list[int],
    db: Session,
    currency: str = "ARS",
) -> float:
    """Get total spending for a category in a given month (including children)."""
    cat_ids = [category_id]
    children = db.query(Category).filter(Category.parent_id == category_id).all()
    cat_ids.extend([int(c.id) for c in children])

    start = date(year, month, 1)
    end = date(year, month, monthrange(year, month)[1])

    rows = (
        db.query(
            Expense.amount,
            Expense.currency,
            Expense.fx_rate,
            Expense.fx_rate_date,
            Expense.fx_rate_source,
        )
        .filter(
            Expense.user_id.in_(uid_list),
            Expense.category_id.in_(cat_ids),
            Expense.date >= start,
            Expense.date <= end,
            Expense.is_income == False,
        )
        .all()
    )
    return converted_spending(rows, db, currency)


def has_any_expenses(category_id: int, uid_list: list[int], db: Session) -> bool:
    """Check if a category has ever had any expenses (any month)."""
    count = (
        db.query(Expense)
        .filter(
            Expense.user_id.in_(uid_list),
            Expense.category_id == category_id,
            Expense.is_income == False,
        )
        .count()
    )
    return count > 0


def spending_for_group(
    group_name: str,
    year: int,
    month: int,
    uid_list: list[int],
    db: Session,
    currency: str = "ARS",
) -> float:
    """Get total spending for a macro group in a given month."""
    cat_ids = [c.id for c in db.query(Category).filter(Category.budget_group == group_name).all()]

    start = date(year, month, 1)
    end = date(year, month, monthrange(year, month)[1])

    rows = (
        db.query(
            Expense.amount,
            Expense.currency,
            Expense.fx_rate,
            Expense.fx_rate_date,
            Expense.fx_rate_source,
        )
        .filter(
            Expense.user_id.in_(uid_list),
            Expense.category_id.in_(cat_ids),
            Expense.date >= start,
            Expense.date <= end,
            Expense.is_income == False,
        )
        .all()
    )
    return converted_spending(rows, db, currency)


def avg_monthly_spending(
    category_id: int, uid_list: list[int], db: Session, currency: str = "ARS"
) -> float:
    """Get average monthly spending for a category over the last 3 months."""
    today = date.today()
    cat_ids = [category_id]
    children = db.query(Category).filter(Category.parent_id == category_id).all()
    cat_ids.extend([int(c.id) for c in children])

    monthly_totals: list[float] = []
    for i in range(3):
        month_date = today.replace(day=1) - timedelta(days=30 * i)
        start = month_date.replace(day=1)
        end = start.replace(day=monthrange(start.year, start.month)[1])

        rows = (
            db.query(
                Expense.amount,
                Expense.currency,
                Expense.fx_rate,
                Expense.fx_rate_date,
                Expense.fx_rate_source,
            )
            .filter(
                Expense.user_id.in_(uid_list),
                Expense.category_id.in_(cat_ids),
                Expense.date >= start,
                Expense.date <= end,
                Expense.is_income == False,
            )
            .all()
        )
        monthly_totals.append(converted_spending(rows, db, currency))

    return sum(monthly_totals) / len(monthly_totals) if monthly_totals else 0


def months_with_spending(category_id: int, uid_list: list[int], db: Session) -> int:
    """Count how many of the last 3 months have spending (evidence for averages)."""
    today = date.today()
    cat_ids = [category_id]
    children = db.query(Category).filter(Category.parent_id == category_id).all()
    cat_ids.extend([int(c.id) for c in children])

    months = 0
    for i in range(3):
        month_date = today.replace(day=1) - timedelta(days=30 * i)
        start = month_date.replace(day=1)
        end = start.replace(day=monthrange(start.year, start.month)[1])

        exists = (
            db.query(Expense.id)
            .filter(
                Expense.user_id.in_(uid_list),
                Expense.category_id.in_(cat_ids),
                Expense.date >= start,
                Expense.date <= end,
                Expense.is_income == False,
            )
            .first()
        )
        if exists is not None:
            months += 1
    return months
