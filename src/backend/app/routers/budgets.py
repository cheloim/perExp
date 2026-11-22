"""Budgets router — HTTP layer for budgets, groups, events and suggestions.

The calculations and use cases live in ``app.services.budget_*`` (#569); this
module only declares the endpoints, keeps the response models and delegates.
"""

import os

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User
from app.schemas import (
    BudgetCreate,
    BudgetEventCreate,
    BudgetEventResponse,
    BudgetEventUpdate,
    BudgetGroupCreate,
    BudgetGroupResponse,
    BudgetGroupUpdate,
    BudgetResponse,
    BudgetSummaryResponse,
    BudgetUpdate,
)
from app.services import (
    budget_assignment,
    budget_crud,
    budget_currency,
    budget_events,
    budget_groups,
    budget_levels,
    budget_spending,
    budget_suggestions,
)
from app.services import budget_summary as budget_summary_service
from app.services.auth import get_current_user

router = APIRouter(prefix="/budgets", tags=["budgets"])

# Backwards-compatible aliases: tests and other modules used to import these
# helpers from the router. New code should use the service modules directly.
_converted_spending = budget_spending.converted_spending
_get_group_user_ids = budget_spending.group_user_ids
_assert_single_currency = budget_currency.assert_single_budget_currency
_assert_single_group_currency = budget_currency.assert_single_group_currency
_has_any_expenses = budget_spending.has_any_expenses
_get_spending_for_category = budget_spending.spending_for_category
_get_spending_for_group = budget_spending.spending_for_group
_get_avg_monthly_spending = budget_spending.avg_monthly_spending
_get_months_with_spending = budget_spending.months_with_spending
_normalize_levels = budget_levels.normalize_levels
_levels_to_db = budget_levels.levels_to_db
_levels_from_db = budget_levels.levels_from_db
auto_assign_budget_group = budget_assignment.auto_assign_budget_group

# ─── Budget CRUD ──────────────────────────────────────────────────


@router.get(
    "",
    response_model=list[BudgetResponse],
    summary="List all budgets",
    description="Return all active budgets for the authenticated user with category details.",
)
def list_budgets(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all budgets for the current user."""
    return budget_crud.list_budgets(db, current_user.id)


@router.post(
    "",
    response_model=BudgetResponse,
    summary="Create or update a budget",
    description="Create a new budget for a category, or reactivate/update an existing one.",
)
def create_budget(
    data: BudgetCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a budget for a category."""
    return budget_crud.create_budget(db, current_user.id, data)


@router.put(
    "/{budget_id}",
    response_model=BudgetResponse,
    summary="Update a budget",
    description="Update amount, alert threshold, rollover, or active status of an existing budget.",
)
def update_budget(
    budget_id: int,
    data: BudgetUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update a budget."""
    return budget_crud.update_budget(db, budget_id, current_user.id, data)


@router.delete(
    "/{budget_id}",
    summary="Delete a budget",
    description="Permanently remove a budget by its ID.",
)
def delete_budget(
    budget_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a budget."""
    return budget_crud.delete_budget(db, budget_id, current_user.id)


# ─── Summary Endpoint ──────────────────────────────────────────────


@router.get(
    "/summary",
    response_model=BudgetSummaryResponse,
    summary="Get budget summary",
    description="Return budget vs actual spending summary for a given month, grouped by category.",
)
def budget_summary(
    month: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get budget vs actual spending summary for a month."""
    return budget_summary_service.build_summary(db, current_user.id, month)


# ─── Auto-Suggestion ──────────────────────────────────────────────


@router.get(
    "/suggest",
    summary="Suggest budgets from spending",
    description="Analyze the last 3 months of spending and suggest budget amounts per category.",
)
def suggest_budgets(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Analyze last 3 months and suggest budgets based on spending patterns."""
    return budget_suggestions.build_suggestions(db, current_user.id)


# ─── Budget Groups (50/30/20) ─────────────────────────────────────


@router.get(
    "/groups",
    response_model=list[BudgetGroupResponse],
    summary="List budget groups",
    description="Return all active budget groups (50/30/20 or 60/40) with committed and spent amounts.",
)
def list_budget_groups(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all budget groups for the current user with computed fields."""
    return budget_groups.list_groups(db, current_user.id)


@router.post(
    "/groups",
    response_model=BudgetGroupResponse,
    summary="Create a budget group",
    description="Create a new budget group (necesidades, gustos, or ahorro) with a percentage and amount.",
)
def create_budget_group(
    data: BudgetGroupCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a budget group (50/30/20)."""
    return budget_groups.create_group(db, current_user.id, data)


@router.put(
    "/groups/{group_id}",
    response_model=BudgetGroupResponse,
    summary="Update a budget group",
    description="Update percentage, amount, or active status of an existing budget group.",
)
def update_budget_group(
    group_id: int,
    data: BudgetGroupUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update a budget group."""
    return budget_groups.update_group(db, group_id, current_user.id, data)


@router.post(
    "/groups/init",
    summary="Initialize default budget groups",
    description="Create default budget groups (60/40 or 50/30/20) based on the provided monthly income.",
)
def init_default_groups(
    monthly_income: float,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Initialize default budget groups based on monthly income.

    When BUDGET_AHORRO_ENABLED=false (default): creates 2 groups (60/40)
    When BUDGET_AHORRO_ENABLED=true: creates 3 groups (50/30/20)
    """
    return budget_groups.init_default_groups(db, current_user.id, monthly_income)


# ─── Budget Events ────────────────────────────────────────────────


@router.get(
    "/events",
    response_model=list[BudgetEventResponse],
    summary="List budget events",
    description="Return all active budget events (vacations, trips, etc.) for the current user.",
)
def list_budget_events(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all budget events for the current user."""
    return budget_events.list_events(db, current_user.id)


@router.post(
    "/events",
    response_model=BudgetEventResponse,
    summary="Create a budget event",
    description="Create a new budget event with a date range, total amount, and associated categories.",
)
def create_budget_event(
    data: BudgetEventCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a budget event (vacations, etc.)."""
    return budget_events.create_event(db, current_user.id, data)


@router.put(
    "/events/{event_id}",
    response_model=BudgetEventResponse,
    summary="Update a budget event",
    description="Update name, total amount, or active status of an existing budget event.",
)
def update_budget_event(
    event_id: int,
    data: BudgetEventUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update a budget event."""
    return budget_events.update_event(db, event_id, current_user.id, data)


@router.delete(
    "/events/{event_id}",
    summary="Delete a budget event",
    description="Permanently remove a budget event by its ID.",
)
def delete_budget_event(
    event_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a budget event."""
    return budget_events.delete_event(db, event_id, current_user.id)


# ─── Category Group Assignment ──────────────────────────────────


@router.put(
    "/category-group/{category_id}",
    summary="Assign category to budget group",
    description="Assign a category to a macro group: necesidades, gustos, or ahorro.",
)
def update_category_group(
    category_id: int,
    group_name: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Assign a category to a macro group (necesidades/gustos/ahorro)."""
    return budget_assignment.assign_category_group(db, category_id, current_user.id, group_name)


# ─── Auto-assign categories to groups ───────────────────────────


@router.post(
    "/auto-assign-groups",
    summary="Auto-assign categories to groups",
    description="Automatically assign all user categories to macro groups based on name keywords.",
)
def auto_assign_all_categories(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Auto-assign all user categories to macro groups based on name keywords."""
    return budget_assignment.auto_assign_all_categories(db, current_user.id)


# ─── Budget Config ──────────────────────────────────────────────


@router.get(
    "/config",
    summary="Get budget configuration",
    description="Return budget feature flags such as whether the ahorro group is enabled.",
)
def get_budget_config():
    """Return budget configuration flags."""
    ahorro_enabled = os.getenv("BUDGET_AHORRO_ENABLED", "false").lower() == "true"
    return {"ahorro_enabled": ahorro_enabled}


# ─── Link Expenses to Event ─────────────────────────────────────


@router.post(
    "/events/{event_id}/link-expenses",
    summary="Link expenses to event",
    description="Link a list of expenses to a budget event and update its spent amount.",
)
def link_expenses_to_event(
    event_id: int,
    expense_ids: list[int],
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Link expenses to a budget event and update the event's spent amount."""
    return budget_events.link_expenses(db, event_id, current_user.id, expense_ids)


@router.get(
    "/events/{event_id}/expenses",
    summary="Get event expenses",
    description="Return all expenses in an event's date range, indicating which are linked to it.",
)
def get_event_expenses(
    event_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get expenses linked to a budget event, plus unlinked expenses in the date range."""
    return budget_events.event_expenses(db, event_id, current_user.id)
