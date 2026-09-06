"""Tests for bot_reports service — pure data-building and formatting functions."""

import os
from datetime import date, timedelta
from unittest.mock import MagicMock

os.environ["SECRET_KEY"] = "test-secret-key-that-is-at-least-32-chars-long-for-testing"

import pytest

from app.services.bot_reports import (
    build_budget_status,
    build_period_summary,
    build_upcoming_recurring,
    build_upcoming_scheduled,
    get_group_user_ids,
)
from app.telegram_bot import (
    _chunk_message,
    _format_budget_report,
    _format_period_report,
    _format_recurring_report,
    _format_scheduled_report,
)


# ── Helpers ──────────────────────────────────────────────────────────


def _create_user(db, email="test@example.com"):
    from app.models import User
    from app.services.auth import get_password_hash

    user = User(
        email=email,
        full_name="Test User",
        hashed_password=get_password_hash("testpassword"),
        email_verified=True,
    )
    db.add(user)
    db.flush()
    return user


def _create_category(db, user, name, parent_id=None, budget_group="necesidades"):
    from app.models import Category

    cat = Category(
        name=name,
        user_id=user.id,
        parent_id=parent_id,
        budget_group=budget_group,
    )
    db.add(cat)
    db.flush()
    return cat


def _create_expense(db, user, amount, category_id=None, date_=None, is_income=False):
    from app.models import Expense
    from app.services.encryption import compute_hmac

    if date_ is None:
        date_ = date.today()

    desc = f"test expense {amount}"
    expense = Expense(
        date=date_,
        description=desc,
        description_hmac=compute_hmac(desc),
        amount=amount,
        category_id=category_id,
        user_id=user.id,
        is_income=is_income,
    )
    db.add(expense)
    db.flush()
    return expense


def _create_budget(db, user, category_id, amount, threshold=0.80):
    from app.models import Budget

    budget = Budget(
        user_id=user.id,
        category_id=category_id,
        amount=amount,
        alert_threshold=threshold,
    )
    db.add(budget)
    db.flush()
    return budget


def _create_budget_group(db, user, name, display_name, percentage, amount=0):
    from app.models import BudgetGroup

    group = BudgetGroup(
        user_id=user.id,
        name=name,
        display_name=display_name,
        percentage=percentage,
        amount=amount,
    )
    db.add(group)
    db.flush()
    return group


def _create_scheduled_expense(
    db, user, amount, description, scheduled_date, installment_total=1, installment_number=1
):
    from app.models import ScheduledExpense
    from app.services.encryption import compute_hmac

    se = ScheduledExpense(
        installment_group_id=f"test-{user.id}-{scheduled_date}",
        installment_number=installment_number,
        installment_total=installment_total,
        scheduled_date=scheduled_date,
        amount=amount,
        description=description,
        description_hmac=compute_hmac(description),
        status="PENDING",
        user_id=user.id,
    )
    db.add(se)
    db.flush()
    return se


def _create_recurring_expense(db, user, amount, description, next_date, frequency="monthly"):
    from app.models import RecurringExpense

    rec = RecurringExpense(
        user_id=user.id,
        merchant_key=f"test-{description.lower().replace(' ', '-')}",
        description=description,
        amount=amount,
        next_charge_date=next_date,
        frequency=frequency,
        is_active=True,
        source="manual",
    )
    db.add(rec)
    db.flush()
    return rec


# ── Tests: get_group_user_ids ────────────────────────────────────────


def test_get_group_user_ids_no_group(db):
    user = _create_user(db, "nogroup@test.com")
    assert get_group_user_ids(user.id, db) == [user.id]


# ── Tests: build_budget_status ───────────────────────────────────────


def test_build_budget_status_no_budgets(db):
    user = _create_user(db, "nobudget@test.com")
    report = build_budget_status(user.id, db)

    assert report.month == date.today().strftime("%Y-%m")
    assert report.total_budget == 0
    assert report.total_spent == 0
    assert report.groups == []
    assert report.flagged == []


def test_build_budget_status_with_budget_under_threshold(db):
    user = _create_user(db, "under@test.com")
    cat = _create_category(db, user, "Alimentación")
    _create_budget(db, user, cat.id, amount=100000)
    _create_expense(db, user, 50000, category_id=cat.id, date_=date.today())

    report = build_budget_status(user.id, db)

    assert report.total_budget == 100000
    assert report.total_spent == 50000
    assert len(report.flagged) == 0  # 50% < 80% threshold


def test_build_budget_status_with_budget_warning(db):
    user = _create_user(db, "warning@test.com")
    cat = _create_category(db, user, "Transporte")
    _create_budget(db, user, cat.id, amount=100000)
    _create_expense(db, user, 85000, category_id=cat.id, date_=date.today())

    report = build_budget_status(user.id, db)

    assert len(report.flagged) == 1
    assert report.flagged[0].status == "warning"
    assert report.flagged[0].pct == 85.0


def test_build_budget_status_with_budget_exceeded(db):
    user = _create_user(db, "exceeded@test.com")
    cat = _create_category(db, user, "Entretención")
    _create_budget(db, user, cat.id, amount=50000)
    _create_expense(db, user, 60000, category_id=cat.id, date_=date.today())

    report = build_budget_status(user.id, db)

    assert len(report.flagged) == 1
    assert report.flagged[0].status == "exceeded"
    assert report.flagged[0].pct == 120.0


def test_build_budget_status_groups(db):
    user = _create_user(db, "groups@test.com")
    _create_budget_group(db, user, "necesidades", "Necesidades", 50, amount=200000)
    _create_budget_group(db, user, "gustos", "Gustos", 30, amount=120000)

    cat_n = _create_category(db, user, "Alimentación", budget_group="necesidades")
    cat_g = _create_category(db, user, "Restaurantes", budget_group="gustos")
    _create_expense(db, user, 100000, category_id=cat_n.id, date_=date.today())
    _create_expense(db, user, 50000, category_id=cat_g.id, date_=date.today())

    report = build_budget_status(user.id, db)

    assert len(report.groups) == 2
    # Groups are filtered by BUDGET_AHORRO_ENABLED (default false), but
    # necesidades and gustos are always present
    nombres = {g.display_name for g in report.groups}
    assert "Necesidades" in nombres
    assert "Gustos" in nombres


# ── Tests: build_period_summary ──────────────────────────────────────


def test_build_period_summary_week(db):
    user = _create_user(db, "week@test.com")
    uid_list = [user.id]
    cat = _create_category(db, user, "Supermercado")

    today = date.today()
    _create_expense(db, user, 15000, category_id=cat.id, date_=today)
    _create_expense(db, user, 8000, category_id=cat.id, date_=today - timedelta(days=2))
    _create_expense(db, user, 20000, category_id=cat.id, is_income=True, date_=today)

    report = build_period_summary(user.id, uid_list, "week", db)

    assert report.total == 23000
    assert report.income == 20000
    assert report.net == 3000
    assert report.count == 2
    assert len(report.top_categories) == 1
    assert report.top_categories[0].name == "Supermercado"


def test_build_period_summary_month(db):
    user = _create_user(db, "month@test.com")
    uid_list = [user.id]
    cat = _create_category(db, user, "Servicios")

    today = date.today()
    _create_expense(db, user, 5000, category_id=cat.id, date_=today)

    report = build_period_summary(user.id, uid_list, "month", db)

    assert report.total == 5000
    assert report.count == 1
    assert "month" in report.label.lower() or report.label != ""


def test_build_period_summary_empty(db):
    user = _create_user(db, "empty@test.com")
    uid_list = [user.id]

    report = build_period_summary(user.id, uid_list, "week", db)

    assert report.total == 0
    assert report.count == 0
    assert report.top_categories == []


# ── Tests: build_upcoming_scheduled ──────────────────────────────────


def test_build_upcoming_scheduled_empty(db):
    user = _create_user(db, "nosched@test.com")
    uid_list = [user.id]

    report = build_upcoming_scheduled(uid_list, 30, db)

    assert report.count == 0
    assert report.total == 0
    assert report.weeks == []


def test_build_upcoming_scheduled_with_items(db):
    user = _create_user(db, "sched@test.com")
    uid_list = [user.id]
    today = date.today()

    _create_scheduled_expense(db, user, 5000, "Netflix", today + timedelta(days=3))
    _create_scheduled_expense(
        db, user, 10000, "Cuota 1/3", today + timedelta(days=5), installment_total=3
    )

    report = build_upcoming_scheduled(uid_list, 30, db)

    assert report.count == 2
    assert report.total == 15000
    assert len(report.weeks) >= 1


def test_build_upcoming_scheduled_ignores_past(db):
    user = _create_user(db, "past@test.com")
    uid_list = [user.id]
    today = date.today()

    _create_scheduled_expense(db, user, 5000, "Vencido", today - timedelta(days=1))

    report = build_upcoming_scheduled(uid_list, 30, db)

    assert report.count == 0


def test_build_upcoming_scheduled_ignores_non_pending(db):
    user = _create_user(db, "exec@test.com")
    uid_list = [user.id]
    today = date.today()

    se = _create_scheduled_expense(db, user, 5000, "Ya ejecutado", today + timedelta(days=3))
    se.status = "EXECUTED"
    db.flush()

    report = build_upcoming_scheduled(uid_list, 30, db)

    assert report.count == 0


# ── Tests: build_upcoming_recurring ──────────────────────────────────


def test_build_upcoming_recurring_empty(db):
    user = _create_user(db, "norec@test.com")
    uid_list = [user.id]

    report = build_upcoming_recurring(uid_list, 30, db)

    assert report.count == 0
    assert report.total == 0
    assert report.items == []


def test_build_upcoming_recurring_with_items(db):
    user = _create_user(db, "rec@test.com")
    uid_list = [user.id]
    today = date.today()

    _create_recurring_expense(db, user, 3000, "Spotify", today + timedelta(days=2))
    _create_recurring_expense(db, user, 8000, "Netflix", today + timedelta(days=10))

    report = build_upcoming_recurring(uid_list, 30, db)

    assert report.count == 2
    assert report.total == 11000
    assert report.items[0].description == "Spotify"
    assert report.items[0].days_until == 2
    assert report.items[1].days_until == 10


def test_build_upcoming_recurring_ignores_far_future(db):
    user = _create_user(db, "far@test.com")
    uid_list = [user.id]
    today = date.today()

    _create_recurring_expense(db, user, 1000, "Lejano", today + timedelta(days=60))

    report = build_upcoming_recurring(uid_list, 30, db)

    assert report.count == 0


def test_build_upcoming_recurring_ignores_inactive(db):
    user = _create_user(db, "inactive@test.com")
    uid_list = [user.id]
    today = date.today()

    rec = _create_recurring_expense(db, user, 1000, "Pausado", today + timedelta(days=3))
    rec.is_active = False
    db.flush()

    report = build_upcoming_recurring(uid_list, 30, db)

    assert report.count == 0


# ── Tests: _chunk_message ────────────────────────────────────────────


def test_chunk_message_short():
    assert _chunk_message("hello") == ["hello"]


def test_chunk_message_exact_limit():
    text = "a" * 4096
    assert _chunk_message(text) == [text]


def test_chunk_message_over_limit():
    text = "line one\n" + "a" * 4090 + "\nline two"
    chunks = _chunk_message(text)
    assert len(chunks) >= 2
    assert "line one" in chunks[0]
    assert "line two" in chunks[-1]


def test_chunk_message_no_newlines():
    text = "a" * 5000
    chunks = _chunk_message(text)
    assert len(chunks) == 2
    assert len(chunks[0]) == 4096


# ── Tests: formatting functions ──────────────────────────────────────


def test_format_budget_report_empty():
    from app.services.bot_reports import BudgetStatusReport

    report = BudgetStatusReport(
        month="2026-01", total_budget=0, total_spent=0, total_pct=0, groups=[], flagged=[]
    )
    text = _format_budget_report(report)
    assert "Presupuesto" in text
    assert "No hay presupuestos" in text


def test_format_budget_report_with_flagged():
    from app.services.bot_reports import BudgetCategoryRow, BudgetStatusReport

    report = BudgetStatusReport(
        month="2026-01",
        total_budget=100000,
        total_spent=50000,
        total_pct=50.0,
        groups=[],
        flagged=[
            BudgetCategoryRow(
                name="Alimentación", budget=50000, spent=45000, pct=90.0, status="warning"
            )
        ],
    )
    text = _format_budget_report(report)
    assert "Alimentación" in text
    assert "90.0%" in text
    assert "Categorías con alerta" in text


def test_format_period_report_with_data():
    from app.services.bot_reports import CategorySummary, PeriodSummaryReport

    report = PeriodSummaryReport(
        label="Semana 01/09 – 07/09",
        total=50000,
        income=100000,
        net=-50000,
        top_categories=[
            CategorySummary(name="Supermercado", emoji="🛒", total=30000)
        ],
        prev_total=40000,
        prev_income=80000,
        prev_net=-40000,
        count=10,
        prev_count=8,
    )
    text = _format_period_report(report)
    assert "Semana 01/09" in text
    assert "$50,000" in text
    assert "Supermercado" in text
    assert "vs. anterior" in text


def test_format_scheduled_report_empty():
    from app.services.bot_reports import UpcomingScheduledReport

    report = UpcomingScheduledReport(weeks=[], total=0, count=0)
    text = _format_scheduled_report(report)
    assert "No hay cuotas" in text


def test_format_recurring_report_empty():
    from app.services.bot_reports import UpcomingRecurringReport

    report = UpcomingRecurringReport(items=[], total=0, count=0)
    text = _format_recurring_report(report)
    assert "No hay cobros" in text


def test_format_recurring_report_with_items():
    from app.services.bot_reports import RecurringItem, UpcomingRecurringReport

    report = UpcomingRecurringReport(
        items=[
            RecurringItem(
                description="Netflix",
                amount=3000,
                next_date="07/09",
                days_until=1,
                frequency="monthly",
            )
        ],
        total=3000,
        count=1,
    )
    text = _format_recurring_report(report)
    assert "Netflix" in text
    assert "$3,000" in text
    assert "Mensual" in text
    assert "mañana" in text
