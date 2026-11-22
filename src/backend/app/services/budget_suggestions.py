"""Budget auto-suggestion use case (#569)."""

from calendar import monthrange
from datetime import date, timedelta

from sqlalchemy.orm import Session

from app.models import Budget, Category, Expense
from app.services.budget_spending import converted_spending, group_user_ids


def build_suggestions(db: Session, user_id: int) -> dict:
    """Analyze last 3 months and suggest budgets based on spending patterns."""
    today = date.today()
    uid_list = group_user_ids(user_id, db)

    categories = db.query(Category).filter(Category.user_id == user_id).all()
    existing_currency = (
        db.query(Budget.currency)
        .filter(Budget.user_id == user_id, Budget.is_active == True)
        .scalar()
    )
    currency = existing_currency or "ARS"
    suggestions = []

    for cat in categories:
        # Skip parent categories
        if db.query(Category).filter(Category.parent_id == cat.id).first():
            continue

        # Get average monthly spending for this category
        cat_ids = [int(cat.id)]
        children = db.query(Category).filter(Category.parent_id == cat.id).all()
        cat_ids.extend([int(c.id) for c in children])

        monthly_totals: list[float] = []
        for i in range(3):
            month_date = today.replace(day=1) - timedelta(days=30 * i)
            start = month_date.replace(day=1)
            end = start.replace(day=monthrange(start.year, start.month)[1])

            rows = (
                db.query(
                    Expense.amount,
                    Expense.currency,
                    Expense.fx_rate,
                    Expense.fx_rate_date,
                    Expense.fx_rate_source,
                )
                .filter(
                    Expense.user_id.in_(uid_list),
                    Expense.category_id.in_(cat_ids),
                    Expense.date >= start,
                    Expense.date <= end,
                    Expense.is_income == False,
                )
                .all()
            )
            monthly_totals.append(converted_spending(rows, db, currency))

        avg_monthly = sum(monthly_totals) / len(monthly_totals) if monthly_totals else 0

        if avg_monthly > 0:
            # Suggest 90% of average (10% reduction for savings)
            suggested = round(avg_monthly * 0.9, -2)  # Round to nearest 100
            if suggested <= 0:
                # Tiny averages round down to $0, which creates useless
                # invisible budgets — skip instead of suggesting nothing.
                continue

            # Check if budget already exists
            existing = (
                db.query(Budget)
                .filter(Budget.user_id == user_id, Budget.category_id == cat.id)
                .first()
            )

            suggestions.append(
                {
                    "category_id": cat.id,
                    "category_name": cat.name,
                    "category_color": cat.color,
                    "avg_monthly": round(avg_monthly, 2),
                    "months_with_data": sum(1 for t in monthly_totals if t > 0),
                    "suggested": suggested,
                    "currency": currency,
                    "has_budget": existing is not None,
                    "current_budget": existing.amount if existing else None,
                }
            )

    # Sort by average spending descending
    suggestions.sort(key=lambda x: x["avg_monthly"], reverse=True)

    return {"suggestions": suggestions[:15]}  # Top 15 categories
