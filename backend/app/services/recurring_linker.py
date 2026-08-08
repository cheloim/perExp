"""Link expenses to matching recurring expenses."""

import logging

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


def link_to_recurring(expense_id: int, description: str, user_id: int, db: Session):
    """Link expense to matching recurring expense if exists.

    Called after expense creation to automatically link to recurring pattern.
    Only links if expense is not already linked and a matching active recurring exists.

    Args:
        expense_id: The expense ID to link
        description: The expense description (used for matching)
        user_id: The user who owns the expense
        db: Database session
    """
    from app.models import Expense, RecurringExpense
    from app.services.categorization import _normalize_merchant_key

    expense = db.get(Expense, expense_id)
    if not expense or expense.recurring_expense_id:
        return

    merchant_key = _normalize_merchant_key(description)
    if not merchant_key:
        return

    recurring = (
        db.query(RecurringExpense)
        .filter(
            RecurringExpense.user_id == user_id,
            RecurringExpense.merchant_key == merchant_key,
            RecurringExpense.is_active == True,  # noqa: E712
        )
        .first()
    )

    if recurring:
        expense.recurring_expense_id = recurring.id
        db.flush()
        logger.debug(f"Linked expense {expense_id} to recurring {recurring.id} ({merchant_key})")
