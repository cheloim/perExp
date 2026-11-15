"""Tests for automatic execution of confirmed recurring expenses."""

import os
from datetime import date

os.environ.setdefault("SECRET_KEY", "test-secret-key-that-is-at-least-32-chars-long-for-testing")

from app.models import Card, Category, Expense, RecurringExpense


def _create_category(db, user, name="Suscripciones"):
    cat = Category(name=name, user_id=user.id, budget_group="gustos")
    db.add(cat)
    db.flush()
    return cat


def _create_recurring(
    db,
    user,
    *,
    amount=6990.0,
    description="NETFLIX",
    next_charge_date=date(2026, 11, 1),
    frequency="monthly",
    source="manual",
    active=True,
    category_id=None,
):
    rec = RecurringExpense(
        user_id=user.id,
        merchant_key=description,
        description=description,
        amount=amount,
        currency="ARS",
        category_id=category_id,
        frequency=frequency,
        next_charge_date=next_charge_date,
        is_active=active,
        source=source,
    )
    db.add(rec)
    db.flush()
    return rec


def _create_expense(db, user, *, amount, description, exp_date, recurring_id=None):
    exp = Expense(
        user_id=user.id,
        date=exp_date,
        description=description,
        amount=amount,
        currency="ARS",
        recurring_expense_id=recurring_id,
        is_recurring_projection=False,
    )
    db.add(exp)
    db.flush()
    return exp


def test_manual_recurring_creates_projection_and_advances_date(db, test_user):
    from app.tasks.recurring_charges import _process_due_recurring

    cat = _create_category(db, test_user)
    rec = _create_recurring(
        db,
        test_user,
        amount=6990.0,
        next_charge_date=date(2026, 11, 1),
        category_id=cat.id,
    )

    result = _process_due_recurring(db, today=date(2026, 11, 10))

    created = db.query(Expense).filter(Expense.user_id == test_user.id).all()
    assert len(created) == 1
    assert created[0].date == date(2026, 11, 1)
    assert created[0].amount == 6990.0
    assert created[0].recurring_expense_id == rec.id
    assert created[0].is_recurring_projection is True
    assert rec.next_charge_date == date(2026, 12, 1)
    assert result["created"] == 1


def test_execution_is_idempotent(db, test_user):
    from app.tasks.recurring_charges import _process_due_recurring

    _create_recurring(db, test_user, next_charge_date=date(2026, 11, 1))

    _process_due_recurring(db, today=date(2026, 11, 10))
    _process_due_recurring(db, today=date(2026, 11, 10))

    assert db.query(Expense).filter(Expense.user_id == test_user.id).count() == 1


def test_auto_detected_recurring_only_advances_without_creating_expense(db, test_user):
    from app.tasks.recurring_charges import _process_due_recurring

    rec = _create_recurring(
        db,
        test_user,
        next_charge_date=date(2026, 11, 1),
        source="auto",
    )

    result = _process_due_recurring(db, today=date(2026, 11, 10))

    assert db.query(Expense).filter(Expense.user_id == test_user.id).count() == 0
    assert rec.next_charge_date == date(2026, 12, 1)
    assert result["created"] == 0


def test_skips_overdue_occurrences_older_than_31_days(db, test_user):
    from app.tasks.recurring_charges import _process_due_recurring

    rec = _create_recurring(
        db,
        test_user,
        next_charge_date=date(2026, 9, 1),
        frequency="monthly",
    )

    result = _process_due_recurring(db, today=date(2026, 11, 10))

    expenses = db.query(Expense).filter(Expense.user_id == test_user.id).all()
    assert [e.date for e in expenses] == [date(2026, 11, 1)]
    assert rec.next_charge_date == date(2026, 12, 1)
    assert result["skipped_old"] == 2


def test_links_existing_real_expense_instead_of_creating_another(db, test_user):
    from app.tasks.recurring_charges import _process_due_recurring

    rec = _create_recurring(db, test_user, next_charge_date=date(2026, 11, 1))
    real = _create_expense(
        db,
        test_user,
        amount=6990.0,
        description="NETFLIX",
        exp_date=date(2026, 11, 1),
    )

    result = _process_due_recurring(db, today=date(2026, 11, 10))

    db.refresh(real)
    assert real.recurring_expense_id == rec.id
    assert real.is_recurring_projection is False
    assert db.query(Expense).filter(Expense.user_id == test_user.id).count() == 1
    assert result["linked"] == 1


def test_groups_execution_notifications_per_user(db, test_user, monkeypatch):
    from app.tasks.recurring_charges import _process_due_recurring

    calls = []
    monkeypatch.setattr(
        "app.services.notify.notify_user",
        lambda *args, **kwargs: calls.append((args, kwargs)),
    )

    _create_recurring(db, test_user, description="NETFLIX", next_charge_date=date(2026, 11, 1))
    _create_recurring(
        db, test_user, description="SPOTIFY", amount=3990.0, next_charge_date=date(2026, 11, 1)
    )

    _process_due_recurring(db, today=date(2026, 11, 10))

    assert len(calls) == 1
    args, _kwargs = calls[0]
    assert args[2] == "recurring_executed"
    assert args[5]["count"] == 2
    assert args[5]["total_amount"] == 10980.0


def test_confirmed_recurring_advances_weekly_and_yearly(db, test_user):
    from app.services.recurring_schedule import add_charge_period

    assert add_charge_period(date(2026, 1, 31), "monthly") == date(2026, 2, 28)
    assert add_charge_period(date(2026, 1, 31), "weekly") == date(2026, 2, 7)
    assert add_charge_period(date(2028, 2, 29), "yearly") == date(2029, 2, 28)


def test_duplicate_guard_ignores_recurring_projections(db, test_user):
    from app.services.encryption import compute_hmac
    from app.services.import_utils import _is_duplicate

    rec = _create_recurring(db, test_user)
    projection = Expense(
        user_id=test_user.id,
        date=date(2026, 11, 1),
        description="NETFLIX",
        description_hmac=compute_hmac("NETFLIX"),
        amount=6990.0,
        currency="ARS",
        recurring_expense_id=rec.id,
        is_recurring_projection=True,
    )
    db.add(projection)
    db.flush()

    assert (
        _is_duplicate(
            db,
            date(2026, 11, 1),
            6990.0,
            "NETFLIX",
            transaction_id=None,
            user_id=test_user.id,
        )
        is False
    )


def test_reconciles_projection_with_imported_fields(db, test_user):
    from app.services.recurring_schedule import (
        apply_imported_fields,
        find_matching_expense,
    )

    rec = _create_recurring(db, test_user)
    card = Card(
        card_name="Visa",
        bank="Galicia",
        holder="Test",
        card_type="credito",
        user_id=test_user.id,
    )
    db.add(card)
    db.flush()
    projection = Expense(
        user_id=test_user.id,
        date=date(2026, 11, 1),
        description="NETFLIX",
        amount=6990.0,
        currency="ARS",
        recurring_expense_id=rec.id,
        is_recurring_projection=True,
    )
    db.add(projection)
    db.flush()

    match = find_matching_expense(
        db,
        test_user.id,
        date(2026, 11, 3),
        6890.0,
        "NETFLIX.COM",
        projection=True,
    )
    assert match is not None

    apply_imported_fields(
        match,
        exp_date=date(2026, 11, 3),
        description="NETFLIX.COM",
        amount=6890.0,
        currency="ARS",
        transaction_id="123456",
        category_id=None,
        card_id=card.id,
    )
    db.flush()

    assert match.date == date(2026, 11, 3)
    assert match.amount == 6890.0
    assert match.transaction_id == "123456"
    assert match.card_id == card.id
    assert match.is_recurring_projection is False
    assert match.recurring_expense_id == rec.id
