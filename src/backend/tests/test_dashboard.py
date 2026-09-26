"""Tests for GET /dashboard/summary — previous_total computation.

Covers Issue #235 acceptance criteria:
- previous_total is correctly populated per category
- Categories only in previous month appear with total=0
- MoM data is accurate for the MiniApp "vs mes anterior" KPI
"""

import os
from datetime import date

os.environ["SECRET_KEY"] = "test-secret-key-that-is-at-least-32-chars-long-for-testing"

import pytest
from sqlalchemy.orm import Session

from app.models import Category, Expense, User
from app.routers.dashboard import get_summary
from app.services.encryption import compute_hmac

# ── Helpers ──────────────────────────────────────────────────────────


def _create_user(db: Session, email="dash_test@example.com") -> User:
    from app.services.auth import get_password_hash

    user = User(
        email=email,
        full_name="Dashboard Tester",
        hashed_password=get_password_hash("testpassword"),
        email_verified=True,
    )
    db.add(user)
    db.flush()
    return user


def _create_category(db: Session, user: User, name: str, color: str = "#6366f1") -> Category:
    cat = Category(name=name, color=color, user_id=user.id)
    db.add(cat)
    db.flush()
    return cat


def _create_expense(
    db: Session,
    user: User,
    amount: float,
    description: str,
    date_: date,
    category: Category | None = None,
    currency: str = "ARS",
) -> Expense:
    exp = Expense(
        date=date_,
        description=description,
        description_hmac=compute_hmac(description),
        amount=amount,
        user_id=user.id,
        category_id=category.id if category else None,
        currency=currency,
        is_income=False,
    )
    db.add(exp)
    db.flush()
    return exp


# ── Fixtures ─────────────────────────────────────────────────────────


@pytest.fixture
def dashboard_user(db: Session):
    return _create_user(db)


# ── Tests ────────────────────────────────────────────────────────────


def test_previous_total_populated(db, dashboard_user):
    """by_category[].previous_total is set when previous month has expenses."""
    food = _create_category(db, dashboard_user, "Comida", "#ef4444")
    transport = _create_category(db, dashboard_user, "Transporte", "#3b82f6")

    # Current month: 2026-09
    _create_expense(db, dashboard_user, 10000, "Supermercado", date(2026, 9, 5), food)
    _create_expense(db, dashboard_user, 5000, "Taxi", date(2026, 9, 10), transport)

    # Previous month: 2026-08
    _create_expense(db, dashboard_user, 8000, "Restaurante", date(2026, 8, 15), food)
    _create_expense(db, dashboard_user, 3000, "Subte", date(2026, 8, 20), transport)

    db.flush()

    result = get_summary(month="2026-09", db=db, current_user=dashboard_user)

    by_cat = {c["category_name"]: c for c in result["by_category"]}

    # Food: current=10000, previous=8000
    assert by_cat["Comida"]["total"] == 10000
    assert by_cat["Comida"]["previous_total"] == 8000

    # Transport: current=5000, previous=3000
    assert by_cat["Transporte"]["total"] == 5000
    assert by_cat["Transporte"]["previous_total"] == 3000


def test_category_only_in_previous_month(db, dashboard_user):
    """A category that only had expenses last month appears with total=0."""
    food = _create_category(db, dashboard_user, "Comida", "#ef4444")
    entertainment = _create_category(db, dashboard_user, "Entretenimiento", "#a855f7")

    # Current month: only food
    _create_expense(db, dashboard_user, 10000, "Supermercado", date(2026, 9, 5), food)

    # Previous month: food + entertainment
    _create_expense(db, dashboard_user, 8000, "Restaurante", date(2026, 8, 15), food)
    _create_expense(db, dashboard_user, 4000, "Cine", date(2026, 8, 20), entertainment)

    db.flush()

    result = get_summary(month="2026-09", db=db, current_user=dashboard_user)

    by_cat = {c["category_name"]: c for c in result["by_category"]}

    # Entertainment: not present in current month, but should appear with total=0
    assert "Entretenimiento" in by_cat
    assert by_cat["Entretenimiento"]["total"] == 0
    assert by_cat["Entretenimiento"]["previous_total"] == 4000


def test_category_only_in_current_month(db, dashboard_user):
    """A category only in current month has previous_total=0."""
    food = _create_category(db, dashboard_user, "Comida", "#ef4444")
    health = _create_category(db, dashboard_user, "Salud", "#22c55e")

    # Current month: food + health
    _create_expense(db, dashboard_user, 10000, "Supermercado", date(2026, 9, 5), food)
    _create_expense(db, dashboard_user, 6000, "Farmacia", date(2026, 9, 12), health)

    # Previous month: only food
    _create_expense(db, dashboard_user, 8000, "Restaurante", date(2026, 8, 15), food)

    db.flush()

    result = get_summary(month="2026-09", db=db, current_user=dashboard_user)

    by_cat = {c["category_name"]: c for c in result["by_category"]}

    # Health: only in current month, previous_total should be 0
    assert by_cat["Salud"]["total"] == 6000
    assert by_cat["Salud"]["previous_total"] == 0


def test_no_previous_month_data(db, dashboard_user):
    """When there's no previous month data, all previous_total are 0."""
    food = _create_category(db, dashboard_user, "Comida", "#ef4444")

    _create_expense(db, dashboard_user, 10000, "Supermercado", date(2026, 9, 5), food)
    db.flush()

    result = get_summary(month="2026-09", db=db, current_user=dashboard_user)

    by_cat = {c["category_name"]: c for c in result["by_category"]}
    assert by_cat["Comida"]["previous_total"] == 0


def test_uncategorized_previous_total(db, dashboard_user):
    """Expenses without category are grouped under 'Sin categoría'."""
    # Current month: uncategorized
    _create_expense(db, dashboard_user, 7000, "Varios", date(2026, 9, 8), category=None)

    # Previous month: uncategorized
    _create_expense(db, dashboard_user, 3000, "Otros", date(2026, 8, 3), category=None)

    db.flush()

    result = get_summary(month="2026-09", db=db, current_user=dashboard_user)

    by_cat = {c["category_name"]: c for c in result["by_category"]}

    assert "Sin categoría" in by_cat
    assert by_cat["Sin categoría"]["total"] == 7000
    assert by_cat["Sin categoría"]["previous_total"] == 3000


def test_income_excluded_from_previous_total(db, dashboard_user):
    """Income transactions are not counted in expense previous_total."""
    food = _create_category(db, dashboard_user, "Comida", "#ef4444")

    _create_expense(db, dashboard_user, 10000, "Supermercado", date(2026, 9, 5), food)

    # Previous month: expense + income
    _create_expense(db, dashboard_user, 8000, "Restaurante", date(2026, 8, 15), food)
    income = Expense(
        date=date(2026, 8, 25),
        description="Salario",
        description_hmac=compute_hmac("Salario"),
        amount=50000,
        user_id=dashboard_user.id,
        category_id=food.id,
        currency="ARS",
        is_income=True,
    )
    db.add(income)
    db.flush()

    result = get_summary(month="2026-09", db=db, current_user=dashboard_user)

    by_cat = {c["category_name"]: c for c in result["by_category"]}

    # previous_total should only include the 8000 expense, not the 50000 income
    assert by_cat["Comida"]["previous_total"] == 8000
