"""Shared budget spending calculation helpers."""

from calendar import monthrange
from datetime import date

from sqlalchemy.orm import Session


def get_group_user_ids(user_id: int, db: Session) -> list[int]:
    """Get all user IDs in the same family group."""
    from app.models import GroupMember

    member = db.query(GroupMember).filter(GroupMember.user_id == user_id).first()
    if not member:
        return [user_id]
    return [
        m.user_id
        for m in db.query(GroupMember).filter(GroupMember.group_id == member.group_id).all()
    ]


def get_spending_for_category(
    category_id: int, year: int, month: int, uid_list: list[int], db: Session
) -> float:
    """Get total spending for a category in a given month (including children)."""
    from app.models import Category, Expense

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


def get_spending_for_group(
    group_name: str, year: int, month: int, uid_list: list[int], db: Session
) -> float:
    """Get total spending for a macro group in a given month.

    Filters categories by both budget_group AND user_id to prevent cross-user contamination.
    """
    from app.models import Category, Expense

    cat_ids = [
        c.id
        for c in db.query(Category)
        .filter(
            Category.budget_group == group_name,
            Category.user_id.in_(uid_list),
        )
        .all()
    ]

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


def get_spending_for_event(
    event_categories: list[dict], start_date: date, end_date: date, uid_list: list[int], db: Session
) -> float:
    """Get total spending for a budget event's categories within its date range."""
    from app.models import Expense

    cat_ids = [c["category_id"] for c in event_categories if "category_id" in c]
    if not cat_ids:
        return 0.0

    total = (
        db.query(Expense)
        .filter(
            Expense.user_id.in_(uid_list),
            Expense.category_id.in_(cat_ids),
            Expense.date >= start_date,
            Expense.date <= end_date,
            Expense.is_income == False,
        )
        .with_entities(Expense.amount)
        .all()
    )
    return sum(abs(t[0]) for t in total)


def get_avg_monthly_spending(category_id: int, uid_list: list[int], db: Session) -> float:
    """Get average monthly spending for a category over the last 3 months."""
    from calendar import monthrange
    from datetime import timedelta

    from sqlalchemy import func

    from app.models import Category, Expense

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
