"""Budgets router - CRUD + summary + groups + events + auto-suggestion."""

import json
import os
from calendar import monthrange
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Budget, BudgetEvent, BudgetGroup, Category, Expense, User
from app.schemas import (
    BudgetCreate,
    BudgetEventCreate,
    BudgetEventResponse,
    BudgetEventUpdate,
    BudgetGroupCategory,
    BudgetGroupCreate,
    BudgetGroupResponse,
    BudgetGroupUpdate,
    BudgetResponse,
    BudgetSummaryItem,
    BudgetSummaryResponse,
    BudgetUpdate,
)
from app.services.auth import get_current_user

router = APIRouter(prefix="/budgets", tags=["budgets"])

# Feature flag: Ahorro (savings) group — disabled until Income module is ready
BUDGET_AHORRO_ENABLED = os.getenv("BUDGET_AHORRO_ENABLED", "false").lower() == "true"


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


def _get_spending_for_group(
    group_name: str, year: int, month: int, uid_list: list[int], db: Session
) -> float:
    """Get total spending for a macro group in a given month."""
    cat_ids = [c.id for c in db.query(Category).filter(Category.budget_group == group_name).all()]

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


def _get_avg_monthly_spending(category_id: int, uid_list: list[int], db: Session) -> float:
    """Get average monthly spending for a category over the last 3 months."""
    today = date.today()
    cat_ids = [category_id]
    children = db.query(Category).filter(Category.parent_id == category_id).all()
    cat_ids.extend([c.id for c in children])

    monthly_totals = []
    for i in range(3):
        month_date = today.replace(day=1) - timedelta(days=30 * i)
        start = month_date.replace(day=1)
        end = start.replace(day=monthrange(start.year, start.month)[1])

        total = (
            db.query(Expense)
            .filter(
                Expense.user_id.in_(uid_list),
                Expense.category_id.in_(cat_ids),
                Expense.date >= start,
                Expense.date <= end,
                Expense.is_income == False,
            )
            .with_entities(func.sum(Expense.amount))
            .scalar()
            or 0
        )
        monthly_totals.append(abs(total))

    return sum(monthly_totals) / len(monthly_totals) if monthly_totals else 0


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
    budget_amount = budget.amount if budget else 0
    alert_threshold = budget.alert_threshold if budget else 0.8

    spent = _get_spending_for_category(category.id, year, month, uid_list, db)
    avg_monthly = _get_avg_monthly_spending(category.id, uid_list, db)

    # Skip if no spending and no budget
    if budget_amount == 0 and spent == 0:
        return None

    percentage = spent / budget_amount if budget_amount > 0 else 0

    if budget_amount == 0:
        status = "no_budget"
    elif percentage >= 1.0:
        status = "exceeded"
    elif percentage >= alert_threshold:
        status = "warning"
    else:
        status = "ok"

    children_items = []
    for child in category.children:
        child_budget = budgets_map.get(child.id)
        child_budget_amount = child_budget.amount if child_budget else 0
        child_spent = _get_spending_for_category(child.id, year, month, uid_list, db)

        if child_budget_amount == 0 and child_spent == 0:
            continue

        child_pct = child_spent / child_budget_amount if child_budget_amount > 0 else 0
        child_status = (
            "no_budget" if child_budget_amount == 0
            else "exceeded" if child_pct >= 1.0
            else "warning" if child_pct >= (child_budget.alert_threshold if child_budget else 0.8)
            else "ok"
        )
        children_items.append(
            BudgetSummaryItem(
                category_id=child.id,
                category_name=child.name,
                category_color=child.color,
                budget_group=child.budget_group or "necesidades",
                budget_amount=child_budget_amount,
                spent_amount=round(child_spent, 2),
                avg_monthly=round(_get_avg_monthly_spending(child.id, uid_list, db), 2),
                percentage=round(child_pct, 4),
                status=child_status,
                has_budget=child_budget is not None,
            )
        )

    return BudgetSummaryItem(
        category_id=category.id,
        category_name=category.name,
        category_color=category.color,
        budget_group=category.budget_group or "necesidades",
        budget_amount=budget_amount,
        spent_amount=round(spent, 2),
        avg_monthly=round(avg_monthly, 2),
        percentage=round(percentage, 4),
        status=status,
        has_budget=budget is not None,
        children=children_items,
    )


# ─── Budget CRUD ──────────────────────────────────────────────────


@router.get("", response_model=list[BudgetResponse])
def list_budgets(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all budgets for the current user."""
    budgets = (
        db.query(Budget).filter(Budget.user_id == current_user.id, Budget.is_active == True).all()
    )

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
                rollover=b.rollover,
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
    cat = db.query(Category).filter(Category.id == data.category_id).first()
    if not cat:
        raise HTTPException(404, "Category not found")

    existing = (
        db.query(Budget)
        .filter(Budget.user_id == current_user.id, Budget.category_id == data.category_id)
        .first()
    )
    if existing:
        existing.amount = data.amount
        existing.alert_threshold = data.alert_threshold
        existing.rollover = data.rollover
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
            rollover=existing.rollover,
            is_active=existing.is_active,
        )

    budget = Budget(
        user_id=current_user.id,
        category_id=data.category_id,
        amount=data.amount,
        alert_threshold=data.alert_threshold,
        rollover=data.rollover,
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
        rollover=budget.rollover,
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
        db.query(Budget).filter(Budget.id == budget_id, Budget.user_id == current_user.id).first()
    )
    if not budget:
        raise HTTPException(404, "Budget not found")

    if data.amount is not None:
        budget.amount = data.amount
    if data.alert_threshold is not None:
        budget.alert_threshold = data.alert_threshold
    if data.rollover is not None:
        budget.rollover = data.rollover
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
        rollover=budget.rollover,
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
        db.query(Budget).filter(Budget.id == budget_id, Budget.user_id == current_user.id).first()
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

    budgets = (
        db.query(Budget).filter(Budget.user_id == current_user.id, Budget.is_active == True).all()
    )
    budgets_map = {b.category_id: b for b in budgets}

    categories_summary = []
    total_budget = 0.0
    total_spent = 0.0

    for cat_id, budget in budgets_map.items():
        cat = db.query(Category).filter(Category.id == cat_id).first()
        if not cat:
            continue
        if cat.parent_id and cat.parent_id in budgets_map:
            continue

        item = _build_category_summary(cat, budgets_map, y, m, uid_list, db)
        if item:
            categories_summary.append(item)
            total_budget += item.budget_amount
            total_spent += item.spent_amount

    # Also add categories with spending but no budget (skip parents whose children are already in summary)
    processed_ids = {item.category_id for item in categories_summary}
    for item in categories_summary:
        for child in item.children:
            processed_ids.add(child.category_id)

    all_cats = db.query(Category).filter(
        Category.user_id == current_user.id,
    ).all()

    # Build set of parent IDs whose children are already in the summary
    parent_ids_in_summary = set()
    processed_cat_ids = {item.category_id for item in categories_summary}
    for cat in all_cats:
        if cat.parent_id and cat.id in processed_cat_ids:
            parent_ids_in_summary.add(cat.parent_id)

    for cat in all_cats:
        if cat.id in processed_ids:
            continue
        # Skip parent categories whose children are already in the summary
        if cat.id in parent_ids_in_summary:
            continue
        if cat.id in parent_ids_in_summary:
            continue

        spent = _get_spending_for_category(cat.id, y, m, uid_list, db)
        if spent > 0:  # Only show categories with actual spending
            item = _build_category_summary(cat, budgets_map, y, m, uid_list, db)
            if item:
                categories_summary.append(item)
                total_spent += item.spent_amount

    total_percentage = total_spent / total_budget if total_budget > 0 else 0

    return BudgetSummaryResponse(
        month=f"{y}-{m:02d}",
        total_budget=round(total_budget, 2),
        total_spent=round(total_spent, 2),
        total_percentage=round(total_percentage, 4),
        categories=categories_summary,
    )


# ─── Auto-Suggestion ──────────────────────────────────────────────


@router.get("/suggest")
def suggest_budgets(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Analyze last 3 months and suggest budgets based on spending patterns."""
    today = date.today()
    uid_list = _get_group_user_ids(current_user.id, db)

    categories = db.query(Category).filter(Category.user_id == current_user.id).all()
    suggestions = []

    for cat in categories:
        # Skip parent categories
        if db.query(Category).filter(Category.parent_id == cat.id).first():
            continue

        # Get average monthly spending for this category
        cat_ids = [cat.id]
        children = db.query(Category).filter(Category.parent_id == cat.id).all()
        cat_ids.extend([c.id for c in children])

        monthly_totals = []
        for i in range(3):
            month_date = today.replace(day=1) - timedelta(days=30 * i)
            start = month_date.replace(day=1)
            end = start.replace(day=monthrange(start.year, start.month)[1])

            total = (
                db.query(Expense)
                .filter(
                    Expense.user_id.in_(uid_list),
                    Expense.category_id.in_(cat_ids),
                    Expense.date >= start,
                    Expense.date <= end,
                    Expense.is_income == False,
                )
                .with_entities(func.sum(Expense.amount))
                .scalar()
                or 0
            )
            monthly_totals.append(abs(total))

        avg_monthly = sum(monthly_totals) / len(monthly_totals) if monthly_totals else 0

        if avg_monthly > 0:
            # Suggest 90% of average (10% reduction for savings)
            suggested = round(avg_monthly * 0.9, -2)  # Round to nearest 100

            # Check if budget already exists
            existing = (
                db.query(Budget)
                .filter(Budget.user_id == current_user.id, Budget.category_id == cat.id)
                .first()
            )

            suggestions.append(
                {
                    "category_id": cat.id,
                    "category_name": cat.name,
                    "category_color": cat.color,
                    "avg_monthly": round(avg_monthly, 2),
                    "suggested": suggested,
                    "has_budget": existing is not None,
                    "current_budget": existing.amount if existing else None,
                }
            )

    # Sort by average spending descending
    suggestions.sort(key=lambda x: x["avg_monthly"], reverse=True)

    return {"suggestions": suggestions[:15]}  # Top 15 categories


# ─── Budget Groups (50/30/20) ─────────────────────────────────────


@router.get("/groups", response_model=list[BudgetGroupResponse])
def list_budget_groups(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all budget groups for the current user with computed fields."""
    from calendar import monthrange

    today = date.today()
    uid_list = _get_group_user_ids(current_user.id, db)

    groups = (
        db.query(BudgetGroup)
        .filter(BudgetGroup.user_id == current_user.id, BudgetGroup.is_active == True)
        .all()
    )

    # Filter out Ahorro group if feature flag is off
    if not BUDGET_AHORRO_ENABLED:
        groups = [g for g in groups if g.name != "ahorro"]

    result = []
    for group in groups:
        # Get categories in this group
        categories = (
            db.query(Category)
            .filter(Category.budget_group == group.name, Category.user_id == current_user.id)
            .all()
        )

        # Calculate committed (sum of individual budgets)
        committed = 0.0
        cat_items = []
        for cat in categories:
            budget = db.query(Budget).filter(
                Budget.user_id == current_user.id,
                Budget.category_id == cat.id,
                Budget.is_active == True,
            ).first()

            budget_amount = budget.amount if budget else 0
            committed += budget_amount

            # Get spending for this category
            spent = _get_spending_for_category(cat.id, today.year, today.month, uid_list, db)
            pct = spent / budget_amount if budget_amount > 0 else 0
            status = (
                "exceeded" if pct >= 1.0
                else "warning" if pct >= (budget.alert_threshold if budget else 0.8)
                else "ok"
            )

            cat_items.append(BudgetGroupCategory(
                category_id=cat.id,
                category_name=cat.name,
                category_color=cat.color,
                budget_amount=budget_amount,
                spent_amount=round(spent, 2),
                percentage=round(pct, 4),
                status=status,
            ))

        # Get actual spending for the group
        spent = _get_spending_for_group(group.name, today.year, today.month, uid_list, db)

        result.append(BudgetGroupResponse(
            id=group.id,
            name=group.name,
            display_name=group.display_name,
            percentage=group.percentage,
            amount=group.amount,
            spent=round(spent, 2),
            committed=round(committed, 2),
            available=round(group.amount - committed, 2),
            categories=cat_items,
            is_active=group.is_active,
        ))

    return result


@router.post("/groups", response_model=BudgetGroupResponse)
def create_budget_group(
    data: BudgetGroupCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a budget group (50/30/20)."""
    existing = (
        db.query(BudgetGroup)
        .filter(BudgetGroup.user_id == current_user.id, BudgetGroup.name == data.name)
        .first()
    )
    if existing:
        raise HTTPException(400, "Budget group already exists")

    group = BudgetGroup(
        user_id=current_user.id,
        name=data.name,
        display_name=data.display_name,
        percentage=data.percentage,
        amount=data.amount,
    )
    db.add(group)
    db.commit()
    db.refresh(group)
    return group


@router.put("/groups/{group_id}", response_model=BudgetGroupResponse)
def update_budget_group(
    group_id: int,
    data: BudgetGroupUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update a budget group."""
    group = (
        db.query(BudgetGroup)
        .filter(BudgetGroup.id == group_id, BudgetGroup.user_id == current_user.id)
        .first()
    )
    if not group:
        raise HTTPException(404, "Budget group not found")

    if data.percentage is not None:
        group.percentage = data.percentage
    if data.amount is not None:
        group.amount = data.amount
    if data.is_active is not None:
        group.is_active = data.is_active

    db.commit()
    db.refresh(group)

    # Build proper response with computed fields
    today = date.today()
    uid_list = _get_group_user_ids(current_user.id, db)

    categories = (
        db.query(Category)
        .filter(Category.budget_group == group.name, Category.user_id == current_user.id)
        .all()
    )

    committed = 0.0
    cat_items = []
    for cat in categories:
        budget = db.query(Budget).filter(
            Budget.user_id == current_user.id,
            Budget.category_id == cat.id,
            Budget.is_active == True,
        ).first()
        budget_amount = budget.amount if budget else 0
        committed += budget_amount

        spent = _get_spending_for_category(cat.id, today.year, today.month, uid_list, db)
        pct = spent / budget_amount if budget_amount > 0 else 0
        status = (
            "exceeded" if pct >= 1.0
            else "warning" if pct >= (budget.alert_threshold if budget else 0.8)
            else "ok"
        )
        cat_items.append(BudgetGroupCategory(
            category_id=cat.id,
            category_name=cat.name,
            category_color=cat.color,
            budget_amount=budget_amount,
            spent_amount=round(spent, 2),
            percentage=round(pct, 4),
            status=status,
        ))

    spent = _get_spending_for_group(group.name, today.year, today.month, uid_list, db)

    return BudgetGroupResponse(
        id=group.id,
        name=group.name,
        display_name=group.display_name,
        percentage=group.percentage,
        amount=group.amount,
        spent=round(spent, 2),
        committed=round(committed, 2),
        available=round(group.amount - committed, 2),
        categories=cat_items,
        is_active=group.is_active,
    )


@router.post("/groups/init")
def init_default_groups(
    monthly_income: float,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Initialize default budget groups based on monthly income.
    
    When BUDGET_AHORRO_ENABLED=false (default): creates 2 groups (60/40)
    When BUDGET_AHORRO_ENABLED=true: creates 3 groups (50/30/20)
    """
    existing = db.query(BudgetGroup).filter(BudgetGroup.user_id == current_user.id).first()
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
            user_id=current_user.id,
            name=g["name"],
            display_name=g["display_name"],
            percentage=g["percentage"],
            amount=round(monthly_income * g["percentage"] / 100, 2),
        )
        db.add(group)
        groups.append(group)

    db.commit()
    for g in groups:
        db.refresh(g)

    return groups


# ─── Budget Events ────────────────────────────────────────────────


@router.get("/events", response_model=list[BudgetEventResponse])
def list_budget_events(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all budget events for the current user."""
    events = (
        db.query(BudgetEvent)
        .filter(BudgetEvent.user_id == current_user.id, BudgetEvent.is_active == True)
        .all()
    )
    result = []
    for e in events:
        cats = json.loads(e.categories) if e.categories else []
        result.append(
            BudgetEventResponse(
                id=e.id,
                name=e.name,
                start_date=e.start_date.isoformat(),
                end_date=e.end_date.isoformat(),
                total_amount=e.total_amount,
                spent=e.spent,
                categories=cats,
                is_active=e.is_active,
            )
        )
    return result


@router.post("/events", response_model=BudgetEventResponse)
def create_budget_event(
    data: BudgetEventCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a budget event (vacations, etc.)."""
    try:
        start = date.fromisoformat(data.start_date)
        end = date.fromisoformat(data.end_date)
    except ValueError:
        raise HTTPException(400, "Invalid date format. Use YYYY-MM-DD")

    if end < start:
        raise HTTPException(400, "End date must be after start date")

    event = BudgetEvent(
        user_id=current_user.id,
        name=data.name,
        start_date=start,
        end_date=end,
        total_amount=data.total_amount,
        categories=json.dumps(data.categories),
    )
    db.add(event)
    db.commit()
    db.refresh(event)

    return BudgetEventResponse(
        id=event.id,
        name=event.name,
        start_date=event.start_date.isoformat(),
        end_date=event.end_date.isoformat(),
        total_amount=event.total_amount,
        spent=event.spent,
        categories=data.categories,
        is_active=event.is_active,
    )


@router.put("/events/{event_id}", response_model=BudgetEventResponse)
def update_budget_event(
    event_id: int,
    data: BudgetEventUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update a budget event."""
    event = (
        db.query(BudgetEvent)
        .filter(BudgetEvent.id == event_id, BudgetEvent.user_id == current_user.id)
        .first()
    )
    if not event:
        raise HTTPException(404, "Budget event not found")

    if data.name is not None:
        event.name = data.name
    if data.total_amount is not None:
        event.total_amount = data.total_amount
    if data.is_active is not None:
        event.is_active = data.is_active

    db.commit()
    db.refresh(event)

    cats = json.loads(event.categories) if event.categories else []
    return BudgetEventResponse(
        id=event.id,
        name=event.name,
        start_date=event.start_date.isoformat(),
        end_date=event.end_date.isoformat(),
        total_amount=event.total_amount,
        spent=event.spent,
        categories=cats,
        is_active=event.is_active,
    )


@router.delete("/events/{event_id}")
def delete_budget_event(
    event_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a budget event."""
    event = (
        db.query(BudgetEvent)
        .filter(BudgetEvent.id == event_id, BudgetEvent.user_id == current_user.id)
        .first()
    )
    if not event:
        raise HTTPException(404, "Budget event not found")

    db.delete(event)
    db.commit()
    return {"ok": True}


# ─── Category Group Assignment ──────────────────────────────────


@router.put("/category-group/{category_id}")
def update_category_group(
    category_id: int,
    group_name: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Assign a category to a macro group (necesidades/gustos/ahorro)."""
    if group_name not in ("necesidades", "gustos", "ahorro"):
        raise HTTPException(400, "Invalid group name. Must be: necesidades, gustos, ahorro")

    cat = (
        db.query(Category)
        .filter(Category.id == category_id, Category.user_id == current_user.id)
        .first()
    )
    if not cat:
        raise HTTPException(404, "Category not found")

    cat.budget_group = group_name
    db.commit()
    return {"ok": True, "category_id": category_id, "budget_group": group_name}


# ─── Auto-assign categories to groups ───────────────────────────

NECESIDADES_KEYWORDS = [
    "alimentación", "alimentos", "supermercado", "almacén", "verdulería",
    "transporte", "combustible", "nafta", "taxi", "uber", "subte", "colectivo",
    "salud", "farmacia", "médico", "médicos", "hospital", "obra social",
    "hogar", "alquiler", "expensas", "servicios", "luz", "gas", "agua",
    "internet", "celular", "teléfono", "impuestos", "seguros", "monotributo",
]

GUSTOS_KEYWORDS = [
    "entretenimiento", "cine", "teatro", "concierto", "streaming", "netflix",
    "spotify", "disney", "hbo", "ropa", "indumentaria", "calzado",
    "café", "cafetería", "bar", "restaurante", "resto", "comida",
    "gimnasio", "deporte", "fitness", "suscripciones", "revistas",
    "viajes", "hotel", "aerolínea", "turismo", "mascotas", "vacaciones",
]

AHORRO_KEYWORDS = [
    "inversiones", "inversión", "ahorro", "plazo fijo", "fci",
    "bonos", "acciones", "dólar", "crypto",
]


def auto_assign_budget_group(category_name: str) -> str:
    """Auto-assign a category to a macro group based on name keywords."""
    lower = category_name.lower()
    for kw in NECESIDADES_KEYWORDS:
        if kw in lower:
            return "necesidades"
    for kw in GUSTOS_KEYWORDS:
        if kw in lower:
            return "gustos"
    for kw in AHORRO_KEYWORDS:
        if kw in lower:
            return "ahorro"
    return "necesidades"  # default


@router.post("/auto-assign-groups")
def auto_assign_all_categories(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Auto-assign all user categories to macro groups based on name keywords."""
    categories = db.query(Category).filter(Category.user_id == current_user.id).all()
    updated = 0
    for cat in categories:
        new_group = auto_assign_budget_group(cat.name)
        if cat.budget_group != new_group:
            cat.budget_group = new_group
            updated += 1
    db.commit()
    return {"ok": True, "updated": updated, "total": len(categories)}
