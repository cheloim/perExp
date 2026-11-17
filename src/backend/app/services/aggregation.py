"""Single definition of spending and the per-currency aggregation contract (#508/#509).

Dashboard, Gastos and the assistant must agree on what a "gasto" is. The rule
is explicit here: an expense is a positive amount with ``is_income == False``.
Income is counted separately.

A total is never a mix of nominal ARS and USD. Callers get:

* ``totals``: one bucket per currency, in the original currency.
* ``converted_total``: ARS, using each expense's ``fx_rate`` snapshot.
* ``rate``, ``rate_date`` and ``rate_source``: the single rate used, or
  ``None``/``"mixed"`` when the rows carry different snapshots.
* ``missing_fx``: non-ARS rows without a snapshot and without a fallback.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date
from typing import Any

from sqlalchemy import case, func
from sqlalchemy.orm import Session

from app.models import Expense

Row = tuple[Any, ...]


@dataclass(frozen=True)
class SpendingBreakdown:
    totals: dict[str, float]
    converted_total: float
    rate: float | None
    rate_date: date | None
    rate_source: str | None
    missing_fx: int
    fallback_used: bool


def spending_condition():
    """SQLAlchemy predicate for the single definition of spending."""
    return Expense.is_income.is_(False)


def _as_date(value: object) -> date | None:
    if isinstance(value, date):
        return value
    if value:
        try:
            return date.fromisoformat(str(value)[:10])
        except ValueError:
            return None
    return None


def fallback_rate(db: Session | None = None) -> dict | None:
    """Most recent persisted BNA rate, or None.

    Reads ``fx_rates`` instead of the network so a read endpoint stays
    deterministic and testable. The tables are seeded by the FX refresh job.
    """
    if db is not None:
        from app.models import FxRate

        row = db.query(FxRate).order_by(FxRate.date.desc(), FxRate.id.desc()).first()
        if row is None:
            return None
        return {
            "rate": row.rate,
            "date": row.date.isoformat(),
            "source": row.source,
        }

    from app.services import fx

    try:
        return fx.get_usd_rate("budget")
    except fx.FxUnavailableError:
        return None


def spending_breakdown_from_rows(
    rows: Iterable[Row], fallback: dict | None = None
) -> SpendingBreakdown:
    """Build the per-currency buckets and the converted ARS total.

    ``rows`` are ``(amount, currency, fx_rate, fx_rate_date, fx_rate_source)``.
    Non-ARS rows use their historical snapshot; only when it is missing do we
    fall back to the caller-provided rate. A missing rate is counted, never
    silently treated as ARS.
    """
    totals: dict[str, float] = {}
    converted = 0.0
    rates: set[tuple[float, str | None, str | None]] = set()
    missing = 0
    used_fallback = False

    for amount, currency, fx_rate, fx_date, fx_source in rows:
        currency = currency or "ARS"
        totals[currency] = totals.get(currency, 0.0) + float(amount)
        if currency == "ARS":
            converted += float(amount)
            continue

        rate = fx_rate
        rate_date = _as_date(fx_date)
        rate_source = fx_source
        if rate is None and fallback and fallback.get("rate"):
            rate = float(fallback["rate"])
            rate_date = _as_date(fallback.get("date"))
            rate_source = str(fallback.get("source") or "BNA")
            used_fallback = True
        if rate is None:
            missing += 1
            continue

        converted += float(amount) * float(rate)
        rates.add(
            (
                round(float(rate), 6),
                rate_date.isoformat() if rate_date else None,
                rate_source,
            )
        )

    if len(rates) == 1:
        only = next(iter(rates))
        selected_rate: float | None = only[0]
        selected_date = _as_date(only[1])
        selected_source: str | None = only[2]
    elif len(rates) > 1:
        selected_rate = None
        selected_date = None
        selected_source = "mixed"
    else:
        selected_rate = None
        selected_date = None
        selected_source = None

    return SpendingBreakdown(
        totals=totals,
        converted_total=round(converted, 2),
        rate=selected_rate,
        rate_date=selected_date,
        rate_source=selected_source,
        missing_fx=missing,
        fallback_used=used_fallback,
    )


def spending_breakdown_from_expenses(
    expenses: Iterable[Expense], fallback: dict | None = None
) -> SpendingBreakdown:
    return spending_breakdown_from_rows(
        (
            (
                expense.amount,
                expense.currency,
                expense.fx_rate,
                expense.fx_rate_date,
                expense.fx_rate_source,
            )
            for expense in expenses
        ),
        fallback=fallback,
    )


def spending_breakdown(
    db: Session,
    user_ids: list[int],
    start: date | None = None,
    end: date | None = None,
    fallback: dict | None = None,
) -> SpendingBreakdown:
    """Spending grouped by currency for a user scope and date range."""
    query = db.query(
        Expense.amount,
        Expense.currency,
        Expense.fx_rate,
        Expense.fx_rate_date,
        Expense.fx_rate_source,
    ).filter(Expense.user_id.in_(user_ids), spending_condition())
    if start is not None:
        query = query.filter(Expense.date >= start)
    if end is not None:
        query = query.filter(Expense.date <= end)
    return spending_breakdown_from_rows(query.all(), fallback=fallback)


def spending_totals(
    db: Session,
    user_ids: list[int],
    start: date | None = None,
    end: date | None = None,
) -> dict[str, float]:
    """Spending grouped by currency; never a mixed total."""
    return spending_breakdown(db, user_ids, start, end).totals


def income_totals(
    db: Session,
    user_ids: list[int],
    start: date | None = None,
    end: date | None = None,
) -> dict[str, float]:
    """Income grouped by currency."""
    query = db.query(
        Expense.currency,
        func.coalesce(func.sum(Expense.amount), 0.0),
    ).filter(Expense.user_id.in_(user_ids), Expense.is_income.is_(True))
    if start is not None:
        query = query.filter(Expense.date >= start)
    if end is not None:
        query = query.filter(Expense.date <= end)
    rows = query.group_by(Expense.currency).all()
    return {(currency or "ARS"): float(total) for currency, total in rows}


def ars_amount_expression(db: Session, user_ids: list[int]):
    """SQL expression that converts spending rows to ARS.

    Uses the expense snapshot; only rows without one take the persisted BNA
    fallback. If neither exists the row contributes 0, never a nominal USD.
    """
    needs_fallback = (
        db.query(Expense.id)
        .filter(
            Expense.user_id.in_(user_ids),
            spending_condition(),
            Expense.currency != "ARS",
            Expense.fx_rate.is_(None),
        )
        .first()
    )
    fallback = fallback_rate(db) if needs_fallback else None
    rate = func.coalesce(Expense.fx_rate, float(fallback["rate"]) if fallback else 0.0)
    return case(
        (func.coalesce(Expense.currency, "ARS") == "ARS", Expense.amount),
        else_=Expense.amount * rate,
    )


def to_ars(expense: Expense, fallback: dict | None = None) -> float:
    """Convert one expense to ARS with its snapshot, or the fallback rate."""
    if (expense.currency or "ARS") == "ARS":
        return expense.amount
    rate = expense.fx_rate or (fallback or {}).get("rate")
    return expense.amount * float(rate) if rate else 0.0
