"""Deduplication is scoped to the user (GHSA-gwvx).

Before this fix, the same transaction_id/date/amount/description in another
tenant made the import skip the row, which leaked the existence of that data.
"""

from datetime import date

from app.models import Expense, User
from app.services.encryption import compute_hmac
from app.services.import_utils import _is_duplicate


def _make_user(db, email: str) -> User:
    user = User(email=email, full_name=email, email_verified=True)
    db.add(user)
    db.flush()
    return user


def _make_expense(db, user: User, **overrides) -> Expense:
    description = overrides.pop("description", "Compra súper")
    expense = Expense(
        user_id=user.id,
        date=overrides.pop("date", date(2026, 10, 15)),
        amount=overrides.pop("amount", 15000.0),
        description=description,
        description_hmac=compute_hmac(description),
        **overrides,
    )
    db.add(expense)
    db.flush()
    return expense


def test_other_users_transaction_id_does_not_collide(db, test_user):
    other = _make_user(db, "other-tenant@example.com")
    _make_expense(db, other, transaction_id="txn-1")

    assert (
        _is_duplicate(
            db,
            date(2026, 10, 15),
            15000.0,
            "Compra súper",
            "txn-1",
            user_id=test_user.id,
        )
        is False
    )


def test_other_users_triple_does_not_collide(db, test_user):
    other = _make_user(db, "other-triple@example.com")
    _make_expense(db, other)

    assert (
        _is_duplicate(
            db,
            date(2026, 10, 15),
            15000.0,
            "Compra súper",
            user_id=test_user.id,
        )
        is False
    )


def test_own_expense_still_detected(db, test_user):
    _make_expense(db, test_user, transaction_id="txn-2")

    assert (
        _is_duplicate(
            db,
            date(2026, 10, 15),
            15000.0,
            "Compra súper",
            "txn-2",
            user_id=test_user.id,
        )
        is True
    )
