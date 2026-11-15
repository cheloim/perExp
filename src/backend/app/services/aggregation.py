"""Single definition of spending for backend reads (#509).

Dashboard, Gastos and the assistant must agree on what a "gasto" is. The rule
is explicit here: an expense is a positive amount with ``is_income == False``.
Income is counted separately. Callers that aggregate by currency use the
helpers below instead of an ad-hoc ``sum(Expense.amount)``.
"""

from __future__ import annotations

from datetime import date

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import Expense


def spending_condition():
    """SQLAlchemy predicate for the single definition of spending."""
    return Expense.is_income.is_(False)


def _totals(
    db: Session,
    user_ids: list[int],
    start: date | None,
    end: date | None,
    condition,
) -> dict[str, float]:
    query = db.query(
        Expense.currency,
        func.coalesce(func.sum(Expense.amount), 0.0),
    ).filter(Expense.user_id.in_(user_ids), condition)
    if start is not None:
        query = query.filter(Expense.date >= start)
    if end is not None:
        query = query.filter(Expense.date <= end)
    rows = query.group_by(Expense.currency).all()
    return {(currency or "ARS"): float(total) for currency, total in rows}


def spending_totals(
    db: Session,
    user_ids: list[int],
    start: date | None = None,
    end: date | None = None,
) -> dict[str, float]:
    """Spending grouped by currency; never a mixed total."""
    return _totals(db, user_ids, start, end, spending_condition())


def income_totals(
    db: Session,
    user_ids: list[int],
    start: date | None = None,
    end: date | None = None,
) -> dict[str, float]:
    """Income grouped by currency."""
    return _totals(db, user_ids, start, end, Expense.is_income.is_(True))
