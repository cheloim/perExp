"""Currency invariants shared by budgets and their macro groups (#569).

Budgets and groups are single-currency: switching one to another currency is
only allowed when no other active row disagrees. The messages are part of the
API contract.
"""

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import Budget, BudgetGroup


def assert_single_budget_currency(
    db: Session, user_id: int, currency: str, exclude_budget_id: int | None = None
) -> None:
    query = db.query(Budget.currency).filter(Budget.user_id == user_id, Budget.is_active == True)
    if exclude_budget_id is not None:
        query = query.filter(Budget.id != exclude_budget_id)
    other = query.first()
    if other and other[0] != currency:
        raise HTTPException(
            400,
            "Todos los presupuestos deben usar la misma moneda. "
            "Cambiá los existentes antes de usar otra.",
        )
    group_currency = (
        db.query(BudgetGroup.currency)
        .filter(BudgetGroup.user_id == user_id, BudgetGroup.is_active == True)
        .scalar()
    )
    if group_currency and group_currency != currency:
        raise HTTPException(400, "Los presupuestos y los grupos deben usar la misma moneda")


def assert_single_group_currency(
    db: Session, user_id: int, currency: str, exclude_group_id: int | None = None
) -> None:
    query = db.query(BudgetGroup.currency).filter(
        BudgetGroup.user_id == user_id, BudgetGroup.is_active == True
    )
    if exclude_group_id is not None:
        query = query.filter(BudgetGroup.id != exclude_group_id)
    other = query.first()
    if other and other[0] != currency:
        raise HTTPException(
            400,
            "Todos los grupos de presupuesto deben usar la misma moneda.",
        )


def assert_group_matches_budget_currency(db: Session, user_id: int, currency: str) -> None:
    budget_currency = (
        db.query(Budget.currency)
        .filter(Budget.user_id == user_id, Budget.is_active == True)
        .scalar()
    )
    if budget_currency and budget_currency != currency:
        raise HTTPException(400, "El grupo y los presupuestos deben usar la misma moneda")
