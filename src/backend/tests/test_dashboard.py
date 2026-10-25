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


def test_mtd_comparison_cuts_previous_month_at_same_day(db, dashboard_user):
    """Issue #393: current month compares against prev month cut at the same day.

    as_of=2026-10-14, month=2026-10:
    - Sep 05 (day <= 14) counts in both previous_total and previous_mtd_total
    - Sep 20 (day > 14) counts ONLY in previous_total
    """
    from app.routers.dashboard import _compute_summary as compute

    food = _create_category(db, dashboard_user, "Comida", "#ef4444")

    _create_expense(db, dashboard_user, 10000, "Supermercado", date(2026, 10, 5), food)
    _create_expense(db, dashboard_user, 8000, "Restaurante", date(2026, 9, 5), food)
    _create_expense(db, dashboard_user, 50000, "Banquete", date(2026, 9, 20), food)
    db.flush()

    result = compute(month="2026-10", db=db, current_user=dashboard_user, as_of=date(2026, 10, 14))

    assert result["is_current_month"] is True
    assert result["mtd_cutoff_day"] == 14
    by_cat = {c["category_name"]: c for c in result["by_category"]}
    assert by_cat["Comida"]["previous_total"] == 58000
    assert by_cat["Comida"]["previous_mtd_total"] == 8000
    assert result["previous_mtd_total"] == 8000


def test_closed_month_mtd_equals_full_previous(db, dashboard_user):
    """Issue #393: for closed months MTD comparison falls back to full-vs-full."""
    from app.routers.dashboard import _compute_summary as compute

    food = _create_category(db, dashboard_user, "Comida", "#ef4444")

    _create_expense(db, dashboard_user, 10000, "Supermercado", date(2026, 9, 5), food)
    _create_expense(db, dashboard_user, 8000, "Restaurante", date(2026, 8, 5), food)
    _create_expense(db, dashboard_user, 50000, "Banquete", date(2026, 8, 20), food)
    db.flush()

    result = compute(month="2026-09", db=db, current_user=dashboard_user, as_of=date(2026, 10, 14))

    assert result["is_current_month"] is False
    assert result["mtd_cutoff_day"] is None
    by_cat = {c["category_name"]: c for c in result["by_category"]}
    assert by_cat["Comida"]["previous_total"] == 58000
    assert by_cat["Comida"]["previous_mtd_total"] == 58000


def test_by_currency_carries_previous_totals(db, dashboard_user):
    """Issue #393 (item 3): by_currency exposes previous totals per currency.

    Frontend MoM must compare ARS vs ARS, not ARS vs mixed currencies.
    """
    from app.routers.dashboard import _compute_summary as compute

    food = _create_category(db, dashboard_user, "Comida", "#ef4444")

    _create_expense(
        db, dashboard_user, 10000, "Supermercado", date(2026, 10, 5), food, currency="ARS"
    )
    _create_expense(db, dashboard_user, 100, "Importado", date(2026, 10, 6), food, currency="USD")
    _create_expense(db, dashboard_user, 8000, "Restaurante", date(2026, 9, 5), food, currency="ARS")
    _create_expense(
        db, dashboard_user, 50, "Importado prev", date(2026, 9, 6), food, currency="USD"
    )
    db.flush()

    result = compute(month="2026-10", db=db, current_user=dashboard_user, as_of=date(2026, 10, 14))

    by_cur = {c["currency"]: c for c in result["by_currency"]}
    assert by_cur["ARS"]["previous_total"] == 8000
    assert by_cur["ARS"]["previous_mtd_total"] == 8000
    assert by_cur["USD"]["previous_total"] == 50
    assert by_cur["USD"]["previous_mtd_total"] == 50


def test_monthly_report_closed_month_has_no_mtd_split(db, dashboard_user, monkeypatch):
    """Issue #393 (item 4): closed months report full-vs-full, no projection."""
    import asyncio

    from app.routers.dashboard import get_monthly_report

    monkeypatch.delenv("LLM_API_KEY", raising=False)

    _create_expense(db, dashboard_user, 10000, "Supermercado", date(2026, 8, 5))
    _create_expense(db, dashboard_user, 8000, "Restaurante", date(2026, 7, 5))
    db.flush()

    result = asyncio.run(get_monthly_report(month="2026-08", db=db, current_user=dashboard_user))

    assert result["is_current_month"] is False
    assert result["mtd_cutoff_day"] is None
    assert result["previous_mtd_total"] == result["previous_total"] == 8000
    assert result["projected_total"] is None


def test_monthly_report_current_month_mtd_and_projection(db, dashboard_user, monkeypatch):
    """Issue #393 (item 4): current month compares MTD and projects month-end."""
    import asyncio
    from calendar import monthrange
    from datetime import date as date_cls

    from app.routers.dashboard import get_monthly_report

    monkeypatch.delenv("LLM_API_KEY", raising=False)

    today = date_cls.today()
    cur_key = today.strftime("%Y-%m")
    prev_year, prev_month = (
        (today.year, today.month - 1) if today.month > 1 else (today.year - 1, 12)
    )
    prev_last = monthrange(prev_year, prev_month)[1]
    cutoff = min(today.day, prev_last)

    _create_expense(db, dashboard_user, 12000, "Supermercado", today.replace(day=1))
    _create_expense(db, dashboard_user, 8000, "Restaurante", date(prev_year, prev_month, 1))
    after_cutoff_day = min(cutoff + 1, prev_last)
    _create_expense(
        db, dashboard_user, 50000, "Banquete", date(prev_year, prev_month, after_cutoff_day)
    )
    db.flush()

    result = asyncio.run(get_monthly_report(month=cur_key, db=db, current_user=dashboard_user))

    assert result["is_current_month"] is True
    assert result["mtd_cutoff_day"] == today.day
    if after_cutoff_day > cutoff:
        assert result["previous_mtd_total"] == 8000
        assert result["previous_total"] == 58000
    else:  # today is the last day of the month: MTD == full month
        assert result["previous_mtd_total"] == result["previous_total"] == 58000
    days_in_month = monthrange(today.year, today.month)[1]
    assert result["projected_total"] == round(12000 / today.day * days_in_month, 2)


def test_summary_has_no_dead_search_param():
    """Issue #472: `search` was accepted by /dashboard/summary and silently ignored.

    Its only effect was varying the cache key, so distinct searches cached
    identical results under distinct keys. Either the parameter filters (with
    a test) or it must not exist — this guards against it coming back as a
    no-op.
    """
    import inspect

    from app.routers.dashboard import _apply_filters, get_summary

    assert "search" not in inspect.signature(get_summary).parameters
    assert "search_val" not in inspect.signature(_apply_filters).parameters
