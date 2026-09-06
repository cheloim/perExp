"""Tests for expense_update service — shared edit logic for API and bot."""

import os
from datetime import date, datetime, timedelta
from unittest.mock import MagicMock

os.environ["SECRET_KEY"] = "test-secret-key-that-is-at-least-32-chars-long-for-testing"

import pytest

from app.services.expense_update import (
    EDITABLE_WINDOW_HOURS,
    ExpenseEditError,
    update_expense_checked,
)
from app.services.encryption import compute_hmac


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


def _create_expense(
    db,
    user,
    amount=5000,
    description="test expense",
    date_=None,
    created_at=None,
    budget_event_id=None,
    installment_total=None,
    installment_group_id=None,
    recurring_expense_id=None,
):
    from app.models import Expense

    if date_ is None:
        date_ = date.today()
    if created_at is None:
        created_at = datetime.utcnow()

    expense = Expense(
        date=date_,
        description=description,
        description_hmac=compute_hmac(description),
        amount=amount,
        user_id=user.id,
        created_at=created_at,
        budget_event_id=budget_event_id,
        installment_total=installment_total,
        installment_group_id=installment_group_id,
        recurring_expense_id=recurring_expense_id,
    )
    db.add(expense)
    db.flush()
    return expense


def _create_category(db, user, name):
    from app.models import Category

    cat = Category(name=name, user_id=user.id)
    db.add(cat)
    db.flush()
    return cat


# ── Tests: ownership ─────────────────────────────────────────────────


def test_ownership_rejected(db):
    user1 = _create_user(db, "owner@test.com")
    user2 = _create_user(db, "other@test.com")
    expense = _create_expense(db, user1, amount=1000)

    with pytest.raises(ExpenseEditError, match="permiso"):
        update_expense_checked(db, user2.id, expense, {"amount": 2000})


# ── Tests: 48h window ───────────────────────────────────────────────


def test_48h_window_allows_recent(db):
    user = _create_user(db, "recent@test.com")
    expense = _create_expense(
        db, user, amount=1000, created_at=datetime.utcnow() - timedelta(hours=24)
    )

    updated = update_expense_checked(db, user.id, expense, {"amount": 2000})
    assert updated.amount == 2000


def test_48h_window_rejects_old(db):
    user = _create_user(db, "old@test.com")
    expense = _create_expense(
        db, user, amount=1000, created_at=datetime.utcnow() - timedelta(hours=50)
    )

    with pytest.raises(ExpenseEditError, match="48h"):
        update_expense_checked(db, user.id, expense, {"amount": 2000})


def test_48h_window_null_created_at(db):
    user = _create_user(db, "null@test.com")
    expense = _create_expense(db, user, amount=1000, created_at=None)

    with pytest.raises(ExpenseEditError, match="antes de la migración"):
        update_expense_checked(db, user.id, expense, {"amount": 2000})


def test_48h_check_skipped(db):
    user = _create_user(db, "skip@test.com")
    expense = _create_expense(
        db, user, amount=1000, created_at=datetime.utcnow() - timedelta(hours=100)
    )

    updated = update_expense_checked(
        db, user.id, expense, {"amount": 2000}, skip_48h_check=True
    )
    assert updated.amount == 2000


# ── Tests: linked expenses ───────────────────────────────────────────


def test_block_budget_event(db):
    user = _create_user(db, "be@test.com")
    expense = _create_expense(db, user, budget_event_id=1)

    with pytest.raises(ExpenseEditError, match="presupuesto"):
        update_expense_checked(db, user.id, expense, {"amount": 2000})


def test_block_installment(db):
    user = _create_user(db, "inst@test.com")
    expense = _create_expense(
        db,
        user,
        installment_total=3,
        installment_group_id="test-group",
    )

    with pytest.raises(ExpenseEditError, match="cuota"):
        update_expense_checked(db, user.id, expense, {"amount": 2000})


def test_block_recurring(db):
    user = _create_user(db, "rec@test.com")
    expense = _create_expense(db, user, recurring_expense_id=1)

    with pytest.raises(ExpenseEditError, match="recurrente"):
        update_expense_checked(db, user.id, expense, {"amount": 2000})


# ── Tests: HMAC recompute ───────────────────────────────────────────


def test_hmac_recomputed(db):
    user = _create_user(db, "hmac@test.com")
    expense = _create_expense(db, user, description="old description")
    old_hmac = expense.description_hmac

    updated = update_expense_checked(
        db, user.id, expense, {"description": "new description"}
    )

    assert updated.description_hmac != old_hmac
    assert updated.description_hmac == compute_hmac("new description")


# ── Tests: successful edit ──────────────────────────────────────────


def test_edit_amount(db):
    user = _create_user(db, "amt@test.com")
    expense = _create_expense(db, user, amount=5000)

    updated = update_expense_checked(db, user.id, expense, {"amount": 7500})

    assert updated.amount == 7500


def test_edit_date(db):
    user = _create_user(db, "dt@test.com")
    expense = _create_expense(db, user, date_=date(2026, 9, 1))

    new_date = date(2026, 9, 3)
    updated = update_expense_checked(db, user.id, expense, {"date": new_date})

    assert updated.date == new_date


def test_edit_category(db):
    user = _create_user(db, "cat@test.com")
    cat = _create_category(db, user, "Nueva Categoría")
    expense = _create_expense(db, user)

    updated = update_expense_checked(
        db, user.id, expense, {"category_id": cat.id}
    )

    assert updated.category_id == cat.id


# ── Tests: single installment allowed ───────────────────────────────


def test_single_installment_allowed(db):
    user = _create_user(db, "single@test.com")
    expense = _create_expense(db, user, installment_total=1, installment_group_id="test-single")

    updated = update_expense_checked(db, user.id, expense, {"amount": 3000})
    assert updated.amount == 3000


# ── Tests: _log_expense_audit ───────────────────────────────────────


def test_audit_log_written(db):
    from app.services.expense_update import _log_expense_audit
    from app.models import AuditLog

    user = _create_user(db, "audit@test.com")
    expense = _create_expense(db, user, amount=5000)

    old_vals = {"amount": 5000}
    new_vals = {"amount": 7000}

    _log_expense_audit(db, user.id, expense.id, old_vals, new_vals)
    db.flush()

    log = db.query(AuditLog).filter(AuditLog.action == "expense.update").first()
    assert log is not None
    assert log.user_id == user.id
    assert "expense_id" in log.details
    assert "amount" in log.details


def test_audit_log_no_change_no_entry(db):
    from app.services.expense_update import _log_expense_audit
    from app.models import AuditLog

    user = _create_user(db, "nochange@test.com")
    expense = _create_expense(db, user, amount=5000)

    old_vals = {"amount": 5000}
    new_vals = {"amount": 5000}  # same value

    _log_expense_audit(db, user.id, expense.id, old_vals, new_vals)
    db.flush()

    log = db.query(AuditLog).filter(AuditLog.action == "expense.update").first()
    assert log is None


# ── Tests: EDITABLE_WINDOW_HOURS ────────────────────────────────────


def test_editable_window_constant():
    assert EDITABLE_WINDOW_HOURS == 48
