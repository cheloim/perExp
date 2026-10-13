"""Tests for budget evidence data (months_with_data).

Supports the /budget redesign: averages shown with an evidence badge
instead of bare suggestions.
"""

from datetime import date, timedelta


def _make_user(db, email):
    from app.models import User
    from app.services.auth import get_password_hash

    user = User(
        email=email,
        full_name="Evidence User",
        hashed_password=get_password_hash("testpassword"),
        email_verified=True,
    )
    db.add(user)
    db.flush()
    return user


def _make_category(db, user, name):
    from app.models import Category

    cat = Category(name=name, user_id=user.id, budget_group="necesidades")
    db.add(cat)
    db.flush()
    return cat


def _make_expense(db, user, amount, category_id, date_):
    from app.models import Expense
    from app.services.encryption import compute_hmac

    desc = f"evidence {amount} {date_.isoformat()}"
    expense = Expense(
        date=date_,
        description=desc,
        description_hmac=compute_hmac(desc),
        amount=amount,
        category_id=category_id,
        user_id=user.id,
        is_income=False,
    )
    db.add(expense)
    db.flush()
    return expense


def _last_months(n):
    today = date.today()
    out = []
    for i in range(n):
        d = (today.replace(day=1) - timedelta(days=30 * i)).replace(day=10)
        out.append(d)
    return out


class TestMonthsWithSpending:
    def test_counts_months_with_expenses(self, db):
        from app.routers.budgets import _get_months_with_spending

        user = _make_user(db, "evidence@test.com")
        cat = _make_category(db, user, "Supermercado")
        months = _last_months(3)
        _make_expense(db, user, 10000, cat.id, months[1])
        _make_expense(db, user, 12000, cat.id, months[2])

        assert _get_months_with_spending(cat.id, [user.id], db) == 2

    def test_zero_without_expenses(self, db):
        from app.routers.budgets import _get_months_with_spending

        user = _make_user(db, "empty@test.com")
        cat = _make_category(db, user, "Ocio")

        assert _get_months_with_spending(cat.id, [user.id], db) == 0


class TestSummaryIncludesEvidence:
    def test_summary_items_carry_months_with_data(self, db):
        from app.routers.budgets import budget_summary

        user = _make_user(db, "summary@test.com")
        cat = _make_category(db, user, "Supermercado")
        for d in _last_months(3):
            _make_expense(db, user, 10000, cat.id, d)

        summary = budget_summary(month=None, db=db, current_user=user)

        flat = [c for p in summary.categories for c in [p, *p.children]]
        match = [c for c in flat if c.category_name == "Supermercado"]
        assert len(match) == 1
        assert match[0].months_with_data == 3

    def test_suggest_dicts_carry_months_with_data(self, db):
        from app.routers.budgets import suggest_budgets

        user = _make_user(db, "suggest@test.com")
        cat = _make_category(db, user, "Supermercado")
        months = _last_months(3)
        _make_expense(db, user, 10000, cat.id, months[0])

        result = suggest_budgets(db=db, current_user=user)

        match = [s for s in result["suggestions"] if s["category_id"] == cat.id]
        assert len(match) == 1
        assert match[0]["months_with_data"] == 1
