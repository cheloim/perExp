"""The single spending definition (#509): expenses exclude income."""

from datetime import date

from fastapi.testclient import TestClient

from app.database import get_db
from app.models import Category, Expense, User
from app.services.aggregation import (
    income_totals,
    spending_breakdown,
    spending_totals,
)
from app.services.auth import get_current_user, get_password_hash
from app.services.encryption import compute_hmac
from main import app


def _user(db, email: str) -> User:
    user = User(
        email=email,
        full_name=email,
        hashed_password=get_password_hash("testpassword"),
        email_verified=True,
    )
    db.add(user)
    db.flush()
    return user


def _expense(
    db,
    user: User,
    amount: float,
    *,
    currency: str = "ARS",
    is_income: bool = False,
    category: Category | None = None,
    fx_rate: float | None = None,
    fx_rate_date: date | None = None,
    fx_rate_source: str | None = None,
) -> Expense:
    description = f"{'income' if is_income else 'expense'} {amount} {currency}"
    expense = Expense(
        user_id=user.id,
        date=date.today(),
        amount=amount,
        currency=currency,
        is_income=is_income,
        category_id=category.id if category else None,
        description=description,
        description_hmac=compute_hmac(description),
        fx_rate=fx_rate,
        fx_rate_date=fx_rate_date,
        fx_rate_source=fx_rate_source,
    )
    db.add(expense)
    db.flush()
    return expense


def test_spending_totals_excludes_income_and_groups_by_currency(db):
    user = _user(db, "spending@example.com")
    _expense(db, user, 100.0, currency="ARS")
    _expense(db, user, 20.0, currency="USD")
    _expense(db, user, 500.0, currency="ARS", is_income=True)

    assert spending_totals(db, [user.id]) == {"ARS": 100.0, "USD": 20.0}
    assert income_totals(db, [user.id]) == {"ARS": 500.0}


def test_breakdown_converts_usd_with_the_expense_snapshot(db):
    user = _user(db, "breakdown@example.com")
    _expense(db, user, 100.0, currency="ARS")
    _expense(
        db,
        user,
        20.0,
        currency="USD",
        fx_rate=1000.0,
        fx_rate_date=date(2026, 11, 15),
        fx_rate_source="BNA",
    )

    result = spending_breakdown(db, [user.id])

    assert result.totals == {"ARS": 100.0, "USD": 20.0}
    assert result.converted_total == 20100.0
    assert result.rate == 1000.0
    assert result.rate_date == date(2026, 11, 15)
    assert result.rate_source == "BNA"
    assert result.missing_fx == 0


def test_breakdown_flags_missing_fx_instead_of_adding_nominal(db):
    user = _user(db, "missing-fx@example.com")
    _expense(db, user, 100.0, currency="ARS")
    _expense(db, user, 20.0, currency="USD")

    result = spending_breakdown(db, [user.id])

    assert result.totals == {"ARS": 100.0, "USD": 20.0}
    assert result.converted_total == 100.0
    assert result.missing_fx == 1
    assert result.rate is None


def test_breakdown_uses_the_fallback_rate_for_missing_snapshots(db):
    user = _user(db, "fallback-fx@example.com")
    _expense(db, user, 20.0, currency="USD")

    result = spending_breakdown(
        db,
        [user.id],
        fallback={"rate": 1200.0, "date": "2026-11-16", "source": "BNA"},
    )

    assert result.converted_total == 24000.0
    assert result.rate == 1200.0
    assert result.fallback_used is True
    assert result.missing_fx == 0


def test_breakdown_marks_mixed_rates(db):
    user = _user(db, "mixed-fx@example.com")
    _expense(
        db,
        user,
        10.0,
        currency="USD",
        fx_rate=1000.0,
        fx_rate_date=date(2026, 11, 14),
        fx_rate_source="BNA",
    )
    _expense(
        db,
        user,
        10.0,
        currency="USD",
        fx_rate=1100.0,
        fx_rate_date=date(2026, 11, 15),
        fx_rate_source="BNA",
    )

    result = spending_breakdown(db, [user.id])

    assert result.converted_total == 21000.0
    assert result.rate is None
    assert result.rate_source == "mixed"


def test_dashboard_total_converts_usd_with_the_snapshot(db):
    from app.routers.dashboard import _compute_summary

    user = _user(db, "dashboard-fx@example.com")
    _expense(db, user, 100.0, currency="ARS")
    _expense(
        db,
        user,
        20.0,
        currency="USD",
        fx_rate=1000.0,
        fx_rate_date=date(2026, 11, 15),
        fx_rate_source="BNA",
    )

    result = _compute_summary(db=db, current_user=user, as_of=date.today())

    assert result["total_amount"] == 20100.0
    assert result["fx_rate"] == 1000.0
    assert result["fx_rate_source"] == "BNA"


def test_dashboard_currency_buckets_exclude_income(db):
    from app.routers.dashboard import _compute_summary

    user = _user(db, "currency-income@example.com")
    _expense(db, user, 100.0, currency="ARS")
    _expense(
        db,
        user,
        500.0,
        currency="USD",
        is_income=True,
        fx_rate=1000.0,
        fx_rate_date=date(2026, 11, 15),
        fx_rate_source="BNA",
    )

    result = _compute_summary(db=db, current_user=user, as_of=date.today())

    assert {c["currency"]: c["total"] for c in result["by_currency"]} == {"ARS": 100.0}
    assert result["total_amount"] == 100.0


def test_stats_and_dashboard_agree_on_the_converted_total(db):
    from app.routers.dashboard import _compute_summary

    user = _user(db, "consistency-fx@example.com")
    _expense(db, user, 100.0, currency="ARS")
    _expense(
        db,
        user,
        20.0,
        currency="USD",
        fx_rate=1000.0,
        fx_rate_date=date(2026, 11, 15),
        fx_rate_source="BNA",
    )

    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    try:
        stats = TestClient(app).get("/expenses/stats")
    finally:
        app.dependency_overrides.clear()

    dashboard = _compute_summary(db=db, current_user=user, as_of=date.today())

    assert stats.status_code == 200
    assert stats.json()["total"] == dashboard["total_amount"] == 20100.0


def test_budget_summary_converts_usd_with_the_snapshot(db):
    from app.models import Budget
    from app.routers.budgets import budget_summary

    user = _user(db, "budget-fx@example.com")
    category = Category(name="Comida", user_id=user.id)
    db.add(category)
    db.flush()
    db.add(Budget(user_id=user.id, category_id=category.id, amount=100000.0))
    _expense(
        db,
        user,
        10.0,
        currency="USD",
        category=category,
        fx_rate=1000.0,
        fx_rate_date=date(2026, 11, 15),
        fx_rate_source="BNA",
    )
    db.flush()

    result = budget_summary(db=db, current_user=user)

    assert result.total_spent == 10000.0


def test_expense_stats_excludes_income(db):
    user = _user(db, "stats@example.com")
    _expense(db, user, 100.0)
    _expense(db, user, 500.0, is_income=True)

    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    try:
        response = TestClient(app).get("/expenses/stats")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json()["total"] == 100.0
    assert response.json()["count"] == 1


def test_by_category_excludes_income(db):
    user = _user(db, "category-stats@example.com")
    category = Category(name="Comida", user_id=user.id)
    db.add(category)
    db.flush()
    _expense(db, user, 100.0, category=category)
    _expense(db, user, 500.0, is_income=True, category=category)

    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    try:
        response = TestClient(app).get("/expenses/by-category")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json() == [
        {
            "category_id": category.id,
            "category_name": "Comida",
            "category_color": category.color,
            "total": 100.0,
            "count": 1,
        }
    ]
