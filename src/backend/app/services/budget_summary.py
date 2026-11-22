"""Budget vs actual summary use case (#569)."""

from datetime import date

from sqlalchemy.orm import Session

from app.models import Budget, Category, Expense
from app.schemas import BudgetSummaryItem, BudgetSummaryResponse
from app.services.aggregation import fallback_rate as resolve_fallback_rate
from app.services.budget_spending import (
    avg_monthly_spending,
    converted_spending,
    group_user_ids,
    has_any_expenses,
    months_with_spending,
    spending_for_category,
)


def build_summary(db: Session, user_id: int, month: str | None = None) -> BudgetSummaryResponse:
    """Get budget vs actual spending summary for a month."""
    if month:
        try:
            y, m = int(month[:4]), int(month[5:7])
        except (ValueError, IndexError):
            y, m = date.today().year, date.today().month
    else:
        y, m = date.today().year, date.today().month

    uid_list = group_user_ids(user_id, db)

    budgets = db.query(Budget).filter(Budget.user_id == user_id, Budget.is_active == True).all()
    budgets_map = {b.category_id: b for b in budgets}
    currency = budgets[0].currency if budgets else "ARS"
    fx = resolve_fallback_rate(db) if currency == "USD" else None

    # Get ALL categories for the user
    all_cats = db.query(Category).filter(Category.user_id == user_id).all()

    # Build parent-child map
    parent_map = {}  # parent_id -> list of children
    for cat in all_cats:
        if cat.parent_id:
            parent_map.setdefault(cat.parent_id, []).append(cat)

    # Get only parent categories (no parent_id)
    parent_cats = [cat for cat in all_cats if not cat.parent_id]

    categories_summary = []
    total_budget = 0.0
    total_spent = 0.0
    processed_ids = set()

    # Process only parent categories
    for cat in parent_cats:
        if cat.id in processed_ids:
            continue

        # Get children from the map
        children = parent_map.get(cat.id, [])

        # Build summary for this parent category
        budget = budgets_map.get(cat.id)
        budget_amount = budget.amount if budget else 0
        spent = spending_for_category(cat.id, y, m, uid_list, db, currency)

        # Process ALL children (include if they have budget OR have ever had expenses)
        children_items = []
        for child in children:
            if child.id in processed_ids:
                continue

            child_budget = budgets_map.get(child.id)
            child_budget_amount = child_budget.amount if child_budget else 0
            child_spent = spending_for_category(child.id, y, m, uid_list, db, currency)
            child_has_expenses = has_any_expenses(child.id, uid_list, db)

            # Include child if it has budget OR has ever had expenses
            if child_budget_amount > 0 or child_has_expenses:
                child_pct = child_spent / child_budget_amount if child_budget_amount > 0 else 0
                child_status = (
                    "no_budget"
                    if child_budget_amount == 0
                    else "exceeded"
                    if child_pct >= 1.0
                    else "warning"
                    if child_pct >= (child_budget.alert_threshold if child_budget else 0.8)
                    else "ok"
                )
                children_items.append(
                    BudgetSummaryItem(
                        category_id=child.id,
                        category_name=child.name,
                        category_color=child.color,
                        budget_group=child.budget_group or "necesidades",
                        currency=currency,
                        budget_amount=child_budget_amount,
                        spent_amount=round(child_spent, 2),
                        avg_monthly=round(
                            avg_monthly_spending(child.id, uid_list, db, currency), 2
                        ),
                        months_with_data=months_with_spending(child.id, uid_list, db),
                        percentage=round(child_pct, 4),
                        status=child_status,
                        has_budget=child_budget is not None,
                    )
                )
                processed_ids.add(child.id)

        # Always include parent (to show its children)
        percentage = spent / budget_amount if budget_amount > 0 else 0
        if budget_amount == 0:
            status = "no_budget"
        elif percentage >= 1.0:
            status = "exceeded"
        elif percentage >= (budget.alert_threshold if budget else 0.8):
            status = "warning"
        else:
            status = "ok"

        item = BudgetSummaryItem(
            category_id=cat.id,
            category_name=cat.name,
            category_color=cat.color,
            budget_group=cat.budget_group or "necesidades",
            currency=currency,
            budget_amount=budget_amount,
            spent_amount=round(spent, 2),
            avg_monthly=round(avg_monthly_spending(cat.id, uid_list, db, currency), 2),
            months_with_data=months_with_spending(cat.id, uid_list, db),
            percentage=round(percentage, 4),
            status=status,
            has_budget=budget is not None,
            children=children_items,
        )
        categories_summary.append(item)
        total_budget += budget_amount
        total_spent += spent
        processed_ids.add(cat.id)

    total_percentage = total_spent / total_budget if total_budget > 0 else 0

    # 6-month spending trend (single range query, grouped in Python)
    today = date.today()
    base_idx = today.year * 12 + today.month - 1
    trend_months = []
    for i in range(5, -1, -1):
        idx = base_idx - i
        trend_months.append((idx // 12, idx % 12 + 1))
    trend_start = date(trend_months[0][0], trend_months[0][1], 1)
    recent = (
        db.query(Expense)
        .filter(
            Expense.user_id.in_(uid_list),
            Expense.date >= trend_start,
            Expense.date <= today,
            Expense.is_income == False,
        )
        .with_entities(
            Expense.date,
            Expense.amount,
            Expense.currency,
            Expense.fx_rate,
            Expense.fx_rate_date,
            Expense.fx_rate_source,
        )
        .all()
    )
    trend_rows: dict[tuple[int, int], list] = {}
    for exp_date, amount, row_currency, fx_rate, fx_date, fx_source in recent:
        key = (exp_date.year, exp_date.month)
        trend_rows.setdefault(key, []).append((amount, row_currency, fx_rate, fx_date, fx_source))
    trend_totals: dict[tuple[int, int], float] = {
        key: converted_spending(rows, db, currency) for key, rows in trend_rows.items()
    }
    trend_6m = [
        {"month": f"{yy}-{mm:02d}", "total": round(trend_totals.get((yy, mm), 0.0), 2)}
        for yy, mm in trend_months
    ]

    return BudgetSummaryResponse(
        month=f"{y}-{m:02d}",
        currency=currency,
        fx_rate=float(fx["rate"]) if fx and fx.get("rate") else None,
        fx_rate_date=str(fx.get("date")) if fx and fx.get("date") else None,
        fx_rate_source=str(fx.get("source")) if fx and fx.get("source") else None,
        total_budget=round(total_budget, 2),
        total_spent=round(total_spent, 2),
        total_percentage=round(total_percentage, 4),
        categories=categories_summary,
        trend_6m=trend_6m,
    )
