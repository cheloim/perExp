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


def _make_budget(db, user, category_id, amount):
    from app.models import Budget

    budget = Budget(user_id=user.id, category_id=category_id, amount=amount)
    db.add(budget)
    db.flush()
    return budget


def _last_months(n):
    today = date.today()
    out = []
    for i in range(n):
        d = (today.replace(day=1) - timedelta(days=30 * i)).replace(day=10)
        # Early in the month, day 10 is still in the future and the trend
        # query (date <= today) would exclude it. Keep the fixture in the past.
        if d > today:
            d = today
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

    def test_tiny_average_yields_no_suggestion(self, db):
        from app.routers.budgets import suggest_budgets

        user = _make_user(db, "tiny@test.com")
        cat = _make_category(db, user, "Quiosco")
        months = _last_months(3)
        _make_expense(db, user, 30, cat.id, months[0])

        result = suggest_budgets(db=db, current_user=user)

        assert [s for s in result["suggestions"] if s["category_id"] == cat.id] == []


class TestUpdateBudget:
    def test_put_amount_only_returns_200(self, db):
        from app.routers.budgets import update_budget
        from app.schemas.budgets import BudgetUpdate

        user = _make_user(db, "put@test.com")
        cat = _make_category(db, user, "Supermercado")
        budget = _make_budget(db, user, cat.id, 50000)

        result = update_budget(budget.id, BudgetUpdate(amount=60000), db=db, current_user=user)

        assert result.amount == 60000
        assert result.is_active is True

    def test_put_with_is_active_persists(self, db):
        from app.routers.budgets import update_budget
        from app.schemas.budgets import BudgetUpdate

        user = _make_user(db, "putactive@test.com")
        cat = _make_category(db, user, "Supermercado")
        budget = _make_budget(db, user, cat.id, 50000)

        result = update_budget(
            budget.id, BudgetUpdate(amount=60000, is_active=False), db=db, current_user=user
        )

        assert result.amount == 60000
        assert result.is_active is False


class TestUpdateGroupAndEvent:
    def _make_group(self, db, user):
        from app.models import BudgetGroup

        group = BudgetGroup(
            user_id=user.id,
            name="necesidades",
            display_name="Necesidades",
            percentage=50,
            amount=200000,
        )
        db.add(group)
        db.flush()
        return group

    def _make_event(self, db, user):
        from datetime import date

        from app.models import BudgetEvent

        event = BudgetEvent(
            user_id=user.id,
            name="Vacaciones",
            start_date=date(2026, 1, 1),
            end_date=date(2026, 1, 15),
            total_amount=400000,
        )
        db.add(event)
        db.flush()
        return event

    def test_put_group_percentage_only(self, db):
        from app.routers.budgets import update_budget_group
        from app.schemas.budgets import BudgetGroupUpdate

        user = _make_user(db, "putgroup@test.com")
        group = self._make_group(db, user)

        result = update_budget_group(
            group.id, BudgetGroupUpdate(percentage=60), db=db, current_user=user
        )

        assert result.percentage == 60
        assert result.is_active is True

    def test_put_group_with_is_active(self, db):
        from app.routers.budgets import update_budget_group
        from app.schemas.budgets import BudgetGroupUpdate

        user = _make_user(db, "putgroupactive@test.com")
        group = self._make_group(db, user)

        result = update_budget_group(
            group.id, BudgetGroupUpdate(is_active=False), db=db, current_user=user
        )

        assert result.is_active is False

    def test_put_event_name_only(self, db):
        from app.routers.budgets import update_budget_event
        from app.schemas.budgets import BudgetEventUpdate

        user = _make_user(db, "putevent@test.com")
        event = self._make_event(db, user)

        result = update_budget_event(
            event.id, BudgetEventUpdate(name="Viaje"), db=db, current_user=user
        )

        assert result.name == "Viaje"
        assert result.is_active is True

    def test_put_event_with_is_active(self, db):
        from app.routers.budgets import update_budget_event
        from app.schemas.budgets import BudgetEventUpdate

        user = _make_user(db, "puteventactive@test.com")
        event = self._make_event(db, user)

        result = update_budget_event(
            event.id, BudgetEventUpdate(is_active=False), db=db, current_user=user
        )

        assert result.is_active is False


class TestSummaryTrend:
    def test_trend_has_6_zero_filled_months(self, db):
        from datetime import date

        from app.routers.budgets import budget_summary

        user = _make_user(db, "trend@test.com")
        cat = _make_category(db, user, "Supermercado")
        months = _last_months(3)
        _make_expense(db, user, 10000, cat.id, months[0])
        _make_expense(db, user, 20000, cat.id, months[2])

        summary = budget_summary(month=None, db=db, current_user=user)

        assert len(summary.trend_6m) == 6
        today = date.today()
        assert summary.trend_6m[-1].month == f"{today.year}-{today.month:02d}"
        totals = {t.month: t.total for t in summary.trend_6m}
        d0 = months[0]
        d2 = months[2]
        assert totals[f"{d0.year}-{d0.month:02d}"] == 10000
        assert totals[f"{d2.year}-{d2.month:02d}"] == 20000
        assert sum(1 for v in totals.values() if v == 0) == 4
