"""Scheduling and matching helpers for recurring expenses.

The recurring detector stores an expected next charge date. This module owns
the date arithmetic used to advance it and the fuzzy matching used to avoid
duplicating a real charge with a projected one.
"""

import logging
from datetime import date, timedelta

from sqlalchemy.orm import Session

from app.models import Expense
from app.services.date_utils import add_months
from app.services.encryption import compute_hmac

logger = logging.getLogger(__name__)

# A projected charge and the bank row that represents it can land a few days
# apart (weekends, posting delays). Keep the window small enough to avoid
# matching unrelated purchases at the same merchant.
DATE_WINDOW_DAYS = 7
AMOUNT_TOLERANCE = 0.20
MIN_AMOUNT_TOLERANCE = 100.0


def merchant_keys_match(a: str, b: str) -> bool:
    """Fuzzy match two normalized merchant keys.

    Matches on equality or token containment, so "MAKRO" also matches
    "MAKRO PILAR" without matching an unrelated "MAKRO CENTER" variant that
    shares no full token.
    """
    if a == b:
        return True
    tokens_a = set(a.split())
    tokens_b = set(b.split())
    return bool(tokens_a and tokens_b and (tokens_a <= tokens_b or tokens_b <= tokens_a))


def add_charge_period(value: date, frequency: str | None) -> date:
    """Return the next charge date for a recurring frequency."""
    normalized = (frequency or "monthly").lower()
    if normalized == "weekly":
        return value + timedelta(weeks=1)
    if normalized == "monthly":
        return add_months(value, 1)
    if normalized == "quarterly":
        return add_months(value, 3)
    if normalized == "yearly":
        return add_months(value, 12)
    return add_months(value, 1)


def advance_charge_date(value: date, frequency: str | None, today: date) -> date:
    """Advance a charge date until it is after ``today``."""
    next_date = add_charge_period(value, frequency)
    guard = 0
    while next_date <= today and guard < 240:
        next_date = add_charge_period(next_date, frequency)
        guard += 1
    if next_date <= today:
        # Corrupt or extremely old date: restart from today instead of looping.
        next_date = add_charge_period(today, frequency)
    return next_date


def _merchant_key(description: str) -> str:
    from app.services.categorization import _fuzzy_preference_key

    return _fuzzy_preference_key(description or "")


def find_matching_expense(
    db: Session,
    user_id: int,
    charge_date: date,
    amount: float,
    description: str,
    *,
    projection: bool | None = None,
    recurring_id: int | None = None,
) -> Expense | None:
    """Find the expense that represents ``charge_date`` for this recurring charge.

    ``projection=True`` looks for an auto-generated row that has not been
    reconciled yet. ``projection=False`` looks for a real expense. ``None``
    accepts both.
    """
    if amount <= 0:
        return None
    tolerance = max(abs(amount) * AMOUNT_TOLERANCE, MIN_AMOUNT_TOLERANCE)
    start = charge_date - timedelta(days=DATE_WINDOW_DAYS)
    end = charge_date + timedelta(days=DATE_WINDOW_DAYS)

    query = db.query(Expense).filter(
        Expense.user_id == user_id,
        Expense.date >= start,
        Expense.date <= end,
        Expense.amount >= amount - tolerance,
        Expense.amount <= amount + tolerance,
        Expense.is_income == False,
        Expense.installment_group_id.is_(None),
    )
    if projection is True:
        query = query.filter(Expense.is_recurring_projection == True)
    elif projection is False:
        query = query.filter(Expense.is_recurring_projection == False)

    key = _merchant_key(description)
    if not key:
        return None

    best: tuple[tuple[int, float], Expense] | None = None
    for expense in query.all():
        if projection is False and expense.recurring_expense_id not in (None, recurring_id):
            # Already belongs to a different recurring charge; don't steal it.
            continue
        if not merchant_keys_match(key, _merchant_key(expense.description or "")):
            continue
        score = (abs((expense.date - charge_date).days), abs(expense.amount - amount))
        if best is None or score < best[0]:
            best = (score, expense)

    return best[1] if best else None


def apply_imported_fields(
    projection: Expense,
    *,
    exp_date: date,
    description: str,
    amount: float,
    currency: str | None,
    transaction_id: str | None,
    category_id: int | None,
    card_id: int | None = None,
    account_id: int | None = None,
) -> Expense:
    """Overwrite a projection with the real statement row and clear the flag."""
    projection.date = exp_date
    projection.description = description
    projection.description_hmac = compute_hmac(description)
    projection.amount = amount
    if currency:
        projection.currency = currency
    projection.transaction_id = transaction_id
    if category_id is not None:
        projection.category_id = category_id
    if card_id is not None:
        projection.card_id = card_id
    if account_id is not None:
        projection.account_id = account_id
    projection.is_recurring_projection = False
    return projection
