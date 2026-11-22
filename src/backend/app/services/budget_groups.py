"""Budget group use cases (50/30/20 and 60/40) (#569)."""

import os
from datetime import date

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import Budget, BudgetGroup, Category
from app.schemas import (
    BudgetGroupCategory,
    BudgetGroupCreate,
    BudgetGroupResponse,
    BudgetGroupUpdate,
)
from app.services.budget_currency import (
    assert_group_matches_budget_currency,
    assert_single_group_currency,
)
from app.services.budget_levels import levels_from_db, levels_to_db, normalize_levels
from app.services.budget_spending import (
    group_user_ids,
    spending_for_category,
    spending_for_group,
)

# Feature flag: Ahorro (savings) group — disabled until Income module is ready
BUDGET_AHORRO_ENABLED = os.getenv("BUDGET_AHORRO_ENABLED", "false").lower() == "true"


def _category_items(
    db: Session,
    user_id: int,
    categories: list[Category],
    year: int,
    month: int,
    uid_list: list[int],
    currency: str,
) -> tuple[list[BudgetGroupCategory], float]:
    """Build the per-category rows and the committed amount for a group."""
    committed = 0.0
    cat_items = []
    for cat in categories:
        budget = (
            db.query(Budget)
            .filter(
                Budget.user_id == user_id,
                Budget.category_id == cat.id,
                Budget.is_active == True,
            )
            .first()
        )

        budget_amount = budget.amount if budget else 0
        committed += budget_amount

        # Get spending for this category
        spent = spending_for_category(cat.id, year, month, uid_list, db, currency)
        pct = spent / budget_amount if budget_amount > 0 else 0
        status = (
            "exceeded"
            if pct >= 1.0
            else "warning"
            if pct >= (budget.alert_threshold if budget else 0.8)
            else "ok"
        )

        cat_items.append(
            BudgetGroupCategory(
                category_id=cat.id,
                category_name=cat.name,
                category_color=cat.color,
                budget_amount=budget_amount,
                spent_amount=round(spent, 2),
                percentage=round(pct, 4),
                status=status,
            )
        )
    return cat_items, committed


def group_response(
    db: Session,
    user_id: int,
    group: BudgetGroup,
    uid_list: list[int] | None = None,
    today: date | None = None,
) -> BudgetGroupResponse:
    """Computed response for one group (categories, committed, spent, available)."""
    today = today or date.today()
    uid_list = uid_list if uid_list is not None else group_user_ids(user_id, db)

    categories = (
        db.query(Category)
        .filter(Category.budget_group == group.name, Category.user_id == user_id)
        .all()
    )
    cat_items, committed = _category_items(
        db, user_id, categories, today.year, today.month, uid_list, group.currency
    )

    # Get actual spending for the group
    spent = spending_for_group(group.name, today.year, today.month, uid_list, db, group.currency)

    return BudgetGroupResponse(
        id=group.id,
        name=group.name,
        display_name=group.display_name,
        percentage=group.percentage,
        amount=group.amount,
        currency=group.currency,
        spent=round(spent, 2),
        committed=round(committed, 2),
        available=round(group.amount - committed, 2),
        alert_thresholds=levels_from_db(group.alert_thresholds, 0.80),
        categories=cat_items,
        is_active=group.is_active,
    )


def list_groups(db: Session, user_id: int) -> list[BudgetGroupResponse]:
    """List all active budget groups with computed fields."""
    today = date.today()
    uid_list = group_user_ids(user_id, db)

    groups = (
        db.query(BudgetGroup)
        .filter(BudgetGroup.user_id == user_id, BudgetGroup.is_active == True)
        .all()
    )

    # Filter out Ahorro group if feature flag is off
    if not BUDGET_AHORRO_ENABLED:
        groups = [g for g in groups if g.name != "ahorro"]

    return [group_response(db, user_id, group, uid_list, today) for group in groups]


def create_group(db: Session, user_id: int, data: BudgetGroupCreate) -> BudgetGroupResponse:
    """Create a budget group (50/30/20)."""
    existing = (
        db.query(BudgetGroup)
        .filter(BudgetGroup.user_id == user_id, BudgetGroup.name == data.name)
        .first()
    )
    if existing:
        raise HTTPException(400, "Budget group already exists")

    assert_single_group_currency(db, user_id, data.currency)
    assert_group_matches_budget_currency(db, user_id, data.currency)

    group = BudgetGroup(
        user_id=user_id,
        name=data.name,
        display_name=data.display_name,
        percentage=data.percentage,
        amount=data.amount,
        currency=data.currency,
    )
    db.add(group)
    db.commit()
    db.refresh(group)
    return BudgetGroupResponse(
        id=group.id,
        name=group.name,
        display_name=group.display_name,
        percentage=group.percentage,
        amount=group.amount,
        currency=group.currency,
        spent=0,
        committed=0,
        available=group.amount,
        alert_thresholds=levels_from_db(group.alert_thresholds, 0.80),
        categories=[],
        is_active=group.is_active,
    )


def update_group(
    db: Session, group_id: int, user_id: int, data: BudgetGroupUpdate
) -> BudgetGroupResponse:
    """Update a budget group."""
    group = (
        db.query(BudgetGroup)
        .filter(BudgetGroup.id == group_id, BudgetGroup.user_id == user_id)
        .first()
    )
    if not group:
        raise HTTPException(404, "Budget group not found")

    if data.percentage is not None:
        group.percentage = data.percentage
    if data.amount is not None:
        group.amount = data.amount
    if data.currency is not None and data.currency != group.currency:
        assert_single_group_currency(db, user_id, data.currency, group.id)
        assert_group_matches_budget_currency(db, user_id, data.currency)
        group.currency = data.currency
    group_levels = normalize_levels(data.alert_thresholds)
    if group_levels is not None:
        group.alert_thresholds = levels_to_db(group_levels)
    if data.is_active is not None:
        group.is_active = data.is_active

    db.commit()
    db.refresh(group)

    return group_response(db, user_id, group)


def init_default_groups(db: Session, user_id: int, monthly_income: float) -> list[BudgetGroup]:
    """Initialize default budget groups based on monthly income.

    When BUDGET_AHORRO_ENABLED=false (default): creates 2 groups (60/40)
    When BUDGET_AHORRO_ENABLED=true: creates 3 groups (50/30/20)
    """
    existing = db.query(BudgetGroup).filter(BudgetGroup.user_id == user_id).first()
    if existing:
        raise HTTPException(400, "Budget groups already initialized")

    if BUDGET_AHORRO_ENABLED:
        default_groups = [
            {"name": "necesidades", "display_name": "Necesidades", "percentage": 50},
            {"name": "gustos", "display_name": "Gustos", "percentage": 30},
            {"name": "ahorro", "display_name": "Ahorro/Inversión", "percentage": 20},
        ]
    else:
        default_groups = [
            {"name": "necesidades", "display_name": "Necesidades", "percentage": 60},
            {"name": "gustos", "display_name": "Gustos", "percentage": 40},
        ]

    groups = []
    for g in default_groups:
        group = BudgetGroup(
            user_id=user_id,
            name=g["name"],
            display_name=g["display_name"],
            percentage=g["percentage"],
            amount=round(monthly_income * float(g["percentage"]) / 100, 2),
        )
        db.add(group)
        groups.append(group)

    db.commit()
    for g in groups:
        db.refresh(g)

    return groups
