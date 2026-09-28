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


def check_budget_threshold_on_expense(
    db: Session, user_id: int, category_id: int, expense_amount: float
) -> None:
    """After saving an expense, check if budget threshold was crossed and notify.

    Non-blocking: catches all exceptions to never break expense creation.
    """
    try:
        _check_budget_threshold(db, user_id, category_id)
    except Exception as e:
        import logging

        logging.getLogger(__name__).warning(f"Budget threshold check failed: {e}")


def _check_budget_threshold(db: Session, user_id: int, category_id: int) -> None:
    from app.models import Budget, BudgetGroup, Category, Notification, Setting
    from app.services.notify import notify_user

    # Check if alerts enabled for user
    alert_setting = (
        db.query(Setting).filter(Setting.key == f"{user_id}:budget_alerts_enabled").first()
    )
    if alert_setting and alert_setting.value.lower() in ("false", "0", "no"):
        return

    today = date.today()
    year, month = today.year, today.month
    month_key = f"{year}-{month:02d}"
    uid_list = get_group_user_ids(user_id, db)

    cat = db.query(Category).filter(Category.id == category_id).first()
    if not cat:
        return

    # ── Individual category budget ──
    budget = (
        db.query(Budget)
        .filter(
            Budget.user_id == user_id, Budget.category_id == category_id, Budget.is_active == True
        )  # noqa: E712
        .first()
    )

    if budget and budget.amount > 0:
        spent = get_spending_for_category(category_id, year, month, uid_list, db)
        pct = spent / budget.amount

        if pct >= budget.alert_threshold:
            existing = (
                db.query(Notification)
                .filter(
                    Notification.user_id == user_id,
                    Notification.type == "budget_warning",
                    Notification.data.contains(f'"category_id": {category_id}'),
                    Notification.data.contains(f'"month": "{month_key}"'),
                    Notification.read == False,  # noqa: E712
                )
                .first()
            )

            if not existing:
                is_exceeded = pct >= 1.0
                status = "exceeded" if is_exceeded else "warning"
                notify_user(
                    db,
                    user_id,
                    "budget_warning",
                    f"{'🔴 Excedido' if is_exceeded else '🟡 Alerta'}: {cat.name}",
                    f"Presupuesto ${budget.amount:,.0f} | Gastado ${spent:,.0f} ({pct:.0%})",
                    {
                        "category_id": category_id,
                        "category_name": cat.name,
                        "month": month_key,
                        "budget_amount": budget.amount,
                        "spent_amount": spent,
                        "percentage": pct,
                        "status": status,
                    },
                )

    # ── Macro group budget ──
    if not cat.budget_group:
        return

    group = (
        db.query(BudgetGroup)
        .filter(
            BudgetGroup.user_id == user_id,
            BudgetGroup.name == cat.budget_group,
            BudgetGroup.is_active == True,  # noqa: E712
        )
        .first()
    )

    if not group or group.amount <= 0:
        return

    group_spent = get_spending_for_group(cat.budget_group, year, month, uid_list, db)
    pct = group_spent / group.amount

    if pct < 0.80:
        return

    existing = (
        db.query(Notification)
        .filter(
            Notification.user_id == user_id,
            Notification.type == "budget_warning",
            Notification.data.contains(f'"group_name": "{cat.budget_group}"'),
            Notification.data.contains(f'"month": "{month_key}"'),
            Notification.read == False,  # noqa: E712
        )
        .first()
    )

    if existing:
        return

    display_names = {"necesidades": "Necesidades", "gustos": "Gustos", "ahorro": "Ahorro"}
    is_exceeded = pct >= 1.0
    status = "exceeded" if is_exceeded else "warning"
    notify_user(
        db,
        user_id,
        "budget_warning",
        f"{'🔴 Excedido' if is_exceeded else '🟡 Alerta'}: {display_names.get(cat.budget_group, cat.budget_group)}",
        f"Presupuesto ${group.amount:,.0f} | Gastado ${group_spent:,.0f} ({pct:.0%})",
        {
            "group_name": cat.budget_group,
            "month": month_key,
            "budget_amount": group.amount,
            "spent_amount": group_spent,
            "percentage": pct,
            "status": status,
        },
    )
