"""Installment math and scheduling shared by the API, bots, and capture flows."""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from decimal import ROUND_DOWN, Decimal, InvalidOperation

from sqlalchemy.orm import Session

from app.models import Expense, ScheduledExpense
from app.services.date_utils import add_months
from app.services.encryption import compute_hmac

MAX_INSTALLMENTS = 60


def split_installments(
    total: float,
    installment_total: int,
    start: int = 1,
) -> list[tuple[int, float]]:
    """Split a purchase total into equal installments.

    The last installment absorbs the rounding difference so the whole series
    adds up to ``total`` exactly. ``start`` returns the current installment and
    every later one, which is what a manual "cuota 3 de 12" entry needs.
    """
    if installment_total < 2 or installment_total > MAX_INSTALLMENTS:
        raise ValueError("El total de cuotas debe estar entre 2 y 60.")
    if start < 1 or start > installment_total:
        raise ValueError("La cuota actual debe estar entre 1 y el total de cuotas.")
    try:
        total_d = Decimal(str(total)).quantize(Decimal("0.01"))
    except (InvalidOperation, ValueError) as exc:
        raise ValueError("El monto total no es válido.") from exc
    if total_d <= 0:
        raise ValueError("El monto total debe ser mayor a cero.")

    base = (total_d / installment_total).quantize(Decimal("0.01"), rounding=ROUND_DOWN)
    if base <= 0:
        raise ValueError("El monto es demasiado bajo para esa cantidad de cuotas.")

    amounts = [base] * installment_total
    amounts[-1] = (total_d - base * (installment_total - 1)).quantize(Decimal("0.01"))
    return [(number, float(amounts[number - 1])) for number in range(start, installment_total + 1)]


def create_future_installments(
    db: Session,
    *,
    expense: Expense,
    installment_total: int,
    amounts: Iterable[tuple[int, float]],
) -> list[ScheduledExpense]:
    """Create the pending installments that follow ``expense``.

    The caller owns the transaction. Every row points at the current expense so
    the existing undo handlers can remove the whole series together.
    """
    current_number = expense.installment_number or 1
    group_id = expense.installment_group_id or str(uuid.uuid4())
    if not expense.installment_group_id:
        expense.installment_group_id = group_id
    if not expense.description_hmac:
        expense.description_hmac = compute_hmac(expense.description)

    created: list[ScheduledExpense] = []
    for number, amount in amounts:
        if number <= current_number or number > installment_total:
            continue
        scheduled = ScheduledExpense(
            installment_group_id=group_id,
            installment_number=number,
            installment_total=installment_total,
            scheduled_date=add_months(expense.date, number - current_number),
            amount=abs(amount),
            currency=expense.currency or "ARS",
            description=expense.description,
            description_hmac=expense.description_hmac,
            card_id=expense.card_id,
            account_id=expense.account_id,
            category_id=expense.category_id,
            status="PENDING",
            user_id=expense.user_id,
            expense_id=expense.id,
            transaction_id=expense.transaction_id,
        )
        db.add(scheduled)
        created.append(scheduled)
    return created
