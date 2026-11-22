"""Budget CRUD use cases (#569)."""

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import Budget, Category
from app.schemas import BudgetCreate, BudgetResponse, BudgetUpdate
from app.services.budget_currency import assert_single_budget_currency
from app.services.budget_levels import levels_from_db, levels_to_db, normalize_levels


def budget_response(budget: Budget, category: Category | None) -> BudgetResponse:
    return BudgetResponse(
        id=budget.id,
        category_id=budget.category_id,
        category_name=category.name if category else "",
        category_color=category.color if category else "",
        amount=budget.amount,
        currency=budget.currency,
        alert_threshold=budget.alert_threshold,
        alert_thresholds=levels_from_db(budget.alert_thresholds, budget.alert_threshold),
        rollover=budget.rollover,
        is_active=budget.is_active,
    )


def list_budgets(db: Session, user_id: int) -> list[BudgetResponse]:
    """List all active budgets for the user with category details."""
    budgets = db.query(Budget).filter(Budget.user_id == user_id, Budget.is_active == True).all()

    # Pre-fetch categories to avoid N+1
    cat_ids = {b.category_id for b in budgets}
    categories = {c.id: c for c in db.query(Category).filter(Category.id.in_(cat_ids)).all()}

    return [budget_response(b, categories.get(b.category_id)) for b in budgets]


def create_budget(db: Session, user_id: int, data: BudgetCreate) -> BudgetResponse:
    """Create a budget for a category, or reactivate/update an existing one."""
    cat = db.query(Category).filter(Category.id == data.category_id).first()
    if not cat:
        raise HTTPException(404, "Category not found")

    existing = (
        db.query(Budget)
        .filter(Budget.user_id == user_id, Budget.category_id == data.category_id)
        .first()
    )
    assert_single_budget_currency(db, user_id, data.currency, existing.id if existing else None)
    if existing:
        existing.amount = data.amount
        existing.currency = data.currency
        existing.alert_threshold = data.alert_threshold
        levels = normalize_levels(data.alert_thresholds)
        if levels is not None:
            existing.alert_thresholds = levels_to_db(levels)
            existing.alert_threshold = levels[0]
        existing.rollover = data.rollover
        existing.is_active = True
        db.commit()
        db.refresh(existing)
        return budget_response(existing, cat)

    levels = normalize_levels(data.alert_thresholds)
    budget = Budget(
        user_id=user_id,
        category_id=data.category_id,
        amount=data.amount,
        currency=data.currency,
        alert_threshold=levels[0] if levels is not None else data.alert_threshold,
        alert_thresholds=levels_to_db(levels),
        rollover=data.rollover,
    )
    db.add(budget)
    db.commit()
    db.refresh(budget)

    return budget_response(budget, cat)


def update_budget(db: Session, budget_id: int, user_id: int, data: BudgetUpdate) -> BudgetResponse:
    """Update a budget."""
    budget = db.query(Budget).filter(Budget.id == budget_id, Budget.user_id == user_id).first()
    if not budget:
        raise HTTPException(404, "Budget not found")

    if data.amount is not None:
        budget.amount = data.amount
    if data.currency is not None and data.currency != budget.currency:
        assert_single_budget_currency(db, user_id, data.currency, budget.id)
        budget.currency = data.currency
    if data.alert_threshold is not None:
        budget.alert_threshold = data.alert_threshold
    levels = normalize_levels(data.alert_thresholds)
    if levels is not None:
        budget.alert_thresholds = levels_to_db(levels)
        budget.alert_threshold = levels[0]
    if data.rollover is not None:
        budget.rollover = data.rollover
    if data.is_active is not None:
        budget.is_active = data.is_active

    db.commit()
    db.refresh(budget)

    cat = db.query(Category).filter(Category.id == budget.category_id).first()
    return budget_response(budget, cat)


def delete_budget(db: Session, budget_id: int, user_id: int) -> dict:
    """Delete a budget."""
    budget = db.query(Budget).filter(Budget.id == budget_id, Budget.user_id == user_id).first()
    if not budget:
        raise HTTPException(404, "Budget not found")

    db.delete(budget)
    db.commit()
    return {"ok": True}
