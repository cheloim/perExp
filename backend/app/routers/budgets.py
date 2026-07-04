"""Budgets router - CRUD + summary endpoint."""

from calendar import monthrange
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import extract
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Budget, Category, Expense, User
from app.schemas import (
    BudgetCreate,
    BudgetResponse,
    BudgetSummaryItem,
    BudgetSummaryResponse,
    BudgetUpdate,
)
from app.services.auth import get_current_user

router = APIRouter(prefix="/budgets", tags=["budgets"])


def _get_group_user_ids(user_id: int, db: Session) -> list[int]:
    """Get all user IDs in the same family group."""
    from app.models import GroupMember

    member = db.query(GroupMember).filter(GroupMember.user_id == user_id).first()
    if not member:
        return [user_id]
    return [
        m.user_id
        for m in db.query(GroupMember).filter(GroupMember.group_id == member.group_id).all()
    ]


def _get_spending_for_category(
    category_id: int, year: int, month: int, uid_list: list[int], db: Session
) -> float:
    """Get total spending for a category in a given month (including children)."""
    # Get all category IDs (parent + children)
    cat_ids = [category_id]
    children = db.query(Category).filter(Category.parent_id == category_id).all()
    cat_ids.extend([c.id for c in children])

    start = date(year, month, 1)
    end = date(year, month, monthrange(year, month)[1])

    total = (
        db.query(Expense)
        .filter(
            Expense.user_id.in_(uid_list),
            Expense.category_id.in_(cat_ids),
            Expense.date >= start,
            Expense.date <= end,
            Expense.is_income == False,
        )
        .with_entities(Expense.amount)
        .all()
    )
    return sum(abs(t[0]) for t in total)


def _build_category_summary(
    category: Category,
    budgets_map: dict,
    year: int,
    month: int,
    uid_list: list[int],
    db: Session,
) -> BudgetSummaryItem | None:
    """Build summary for a category and its children."""
    budget = budgets_map.get(category.id)
    if not budget:
        return None

    spent = _get_spending_for_category(category.id, year, month, uid_list, db)
    percentage = spent / budget.amount if budget.amount > 0 else 0

    if percentage >= 1.0:
        status = "exceeded"
    elif percentage >= budget.alert_threshold:
        status = "warning"
    else:
        status = "ok"

    children_items = []
    for child in category.children:
        child_budget = budgets_map.get(child.id)
        if child_budget:
            child_spent = _get_spending_for_category(child.id, year, month, uid_list, db)
            child_pct = child_spent / child_budget.amount if child_budget.amount > 0 else 0
            child_status = (
                "exceeded" if child_pct >= 1.0 else "warning" if child_pct >= child_budget.alert_threshold else "ok"
            )
            children_items.append(
                BudgetSummaryItem(
                    category_id=child.id,
                    category_name=child.name,
                    category_color=child.color,
                    budget_amount=child_budget.amount,
                    spent_amount=round(child_spent, 2),
                    percentage=round(child_pct, 4),
                    status=child_status,
                )
            )

    return BudgetSummaryItem(
        category_id=category.id,
        category_name=category.name,
        category_color=category.color,
        budget_amount=budget.amount,
        spent_amount=round(spent, 2),
        percentage=round(percentage, 4),
        status=status,
        children=children_items,
    )


# ─── CRUD Endpoints ────────────────────────────────────────────────


@router.get("", response_model=list[BudgetResponse])
def list_budgets(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all budgets for the current user."""
    budgets = db.query(Budget).filter(Budget.user_id == current_user.id, Budget.is_active == True).all()

    result = []
    for b in budgets:
        cat = db.query(Category).filter(Category.id == b.category_id).first()
        result.append(
            BudgetResponse(
                id=b.id,
                category_id=b.category_id,
                category_name=cat.name if cat else "",
                category_color=cat.color if cat else "",
                amount=b.amount,
                alert_threshold=b.alert_threshold,
                is_active=b.is_active,
            )
        )
    return result


@router.post("", response_model=BudgetResponse)
def create_budget(
    data: BudgetCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a budget for a category."""
    # Verify category exists
    cat = db.query(Category).filter(Category.id == data.category_id).first()
    if not cat:
        raise HTTPException(404, "Category not found")

    # Check if budget already exists for this category
    existing = (
        db.query(Budget)
        .filter(Budget.user_id == current_user.id, Budget.category_id == data.category_id)
        .first()
    )
    if existing:
        # Update existing
        existing.amount = data.amount
        existing.alert_threshold = data.alert_threshold
        existing.is_active = True
        db.commit()
        db.refresh(existing)
        return BudgetResponse(
            id=existing.id,
            category_id=existing.category_id,
            category_name=cat.name,
            category_color=cat.color,
            amount=existing.amount,
            alert_threshold=existing.alert_threshold,
            is_active=existing.is_active,
        )

    budget = Budget(
        user_id=current_user.id,
        category_id=data.category_id,
        amount=data.amount,
        alert_threshold=data.alert_threshold,
    )
    db.add(budget)
    db.commit()
    db.refresh(budget)

    return BudgetResponse(
        id=budget.id,
        category_id=budget.category_id,
        category_name=cat.name,
        category_color=cat.color,
        amount=budget.amount,
        alert_threshold=budget.alert_threshold,
        is_active=budget.is_active,
    )


@router.put("/{budget_id}", response_model=BudgetResponse)
def update_budget(
    budget_id: int,
    data: BudgetUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update a budget."""
    budget = (
        db.query(Budget)
        .filter(Budget.id == budget_id, Budget.user_id == current_user.id)
        .first()
    )
    if not budget:
        raise HTTPException(404, "Budget not found")

    if data.amount is not None:
        budget.amount = data.amount
    if data.alert_threshold is not None:
        budget.alert_threshold = data.alert_threshold
    if data.is_active is not None:
        budget.is_active = data.is_active

    db.commit()
    db.refresh(budget)

    cat = db.query(Category).filter(Category.id == budget.category_id).first()
    return BudgetResponse(
        id=budget.id,
        category_id=budget.category_id,
        category_name=cat.name if cat else "",
        category_color=cat.color if cat else "",
        amount=budget.amount,
        alert_threshold=budget.alert_threshold,
        is_active=budget.is_active,
    )


@router.delete("/{budget_id}")
def delete_budget(
    budget_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a budget."""
    budget = (
        db.query(Budget)
        .filter(Budget.id == budget_id, Budget.user_id == current_user.id)
        .first()
    )
    if not budget:
        raise HTTPException(404, "Budget not found")

    db.delete(budget)
    db.commit()
    return {"ok": True}


# ─── Summary Endpoint ──────────────────────────────────────────────


@router.get("/summary", response_model=BudgetSummaryResponse)
def budget_summary(
    month: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get budget vs actual spending summary for a month."""
    if month:
        try:
            y, m = int(month[:4]), int(month[5:7])
        except (ValueError, IndexError):
            y, m = date.today().year, date.today().month
    else:
        y, m = date.today().year, date.today().month

    uid_list = _get_group_user_ids(current_user.id, db)

    # Get all active budgets
    budgets = (
        db.query(Budget)
        .filter(Budget.user_id == current_user.id, Budget.is_active == True)
        .all()
    )
    budgets_map = {b.category_id: b for b in budgets}

    # Get parent categories that have budgets
    parent_ids = set()
    for cat_id in budgets_map:
        cat = db.query(Category).filter(Category.id == cat_id).first()
        if cat and cat.parent_id:
            parent_ids.add(cat.parent_id)

    # Build summary for parent categories (that aggregate children)
    categories_summary = []
    total_budget = 0.0
    total_spent = 0.0

    # First, process parent categories that have budgets
    parent_cats = db.query(Category).filter(Category.id.in_(parent_ids)).all()
    for parent in parent_cats:
        item = _build_category_summary(parent, budgets_map, y, m, uid_list, db)
        if item:
            categories_summary.append(item)
            total_budget += item.budget_amount
            total_spent += item.spent_amount

    # Then, process categories without parents (standalone budgets)
    for cat_id, budget in budgets_map.items():
        cat = db.query(Category).filter(Category.id == cat_id).first()
        if not cat:
            continue
        # Skip if this category is a child (already included in parent)
        if cat.parent_id and cat.parent_id in budgets_map:
            continue
        # Skip if this category is a parent (already processed)
        if cat_id in parent_ids:
            continue

        item = _build_category_summary(cat, budgets_map, y, m, uid_list, db)
        if item:
            categories_summary.append(item)
            total_budget += item.budget_amount
            total_spent += item.spent_amount

    total_percentage = total_spent / total_budget if total_budget > 0 else 0

    return BudgetSummaryResponse(
        month=f"{y}-{m:02d}",
        total_budget=round(total_budget, 2),
        total_spent=round(total_spent, 2),
        total_percentage=round(total_percentage, 4),
        categories=categories_summary,
    )
