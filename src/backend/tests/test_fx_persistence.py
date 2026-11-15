"""Persisted FX rates and the per-expense snapshot (#508b)."""

from datetime import date, timedelta

from app.models import Expense, FxRate
from app.services import fx
from app.services.encryption import compute_hmac


def _rate(day: date, rate: float, source: str = "BNA") -> dict:
    return {"rate": rate, "date": day.isoformat(), "source": source}


def _expense(db, user_id: int, **overrides) -> Expense:
    description = overrides.pop("description", "Compra USD")
    expense = Expense(
        user_id=user_id,
        date=overrides.pop("date", date.today()),
        amount=overrides.pop("amount", 100.0),
        currency=overrides.pop("currency", "USD"),
        description=description,
        description_hmac=compute_hmac(description),
        **overrides,
    )
    db.add(expense)
    return expense


def test_save_rate_is_idempotent(db, test_user):
    day = date(2026, 11, 10)
    first = fx.save_rate(db, _rate(day, 1000.0))
    second = fx.save_rate(db, _rate(day, 1050.0))
    db.commit()

    assert second.id == first.id
    assert db.query(FxRate).count() == 1
    assert second.rate == 1050.0


def test_get_rate_for_date_never_uses_a_future_rate(db, test_user):
    fx.save_rate(db, _rate(date(2026, 11, 10), 1000.0))
    fx.save_rate(db, _rate(date(2026, 11, 12), 1100.0))
    db.commit()

    assert fx.get_rate_for_date(db, date(2026, 11, 11)).rate == 1000.0
    assert fx.get_rate_for_date(db, date(2026, 11, 15)).rate == 1100.0
    assert fx.get_rate_for_date(db, date(2026, 11, 1)) is None


def test_ars_expense_is_not_touched(db, test_user):
    expense = _expense(db, test_user.id, currency="ARS")

    assert fx.apply_rate_to_expense(db, expense) is None
    assert expense.fx_rate is None


def test_usd_expense_today_gets_the_bna_snapshot(db, test_user, monkeypatch):
    monkeypatch.setattr(
        fx,
        "get_usd_rate",
        lambda purpose="budget", date_str=None: _rate(date.today(), 1234.5),
    )
    expense = _expense(db, test_user.id)
    db.flush()

    row = fx.apply_rate_to_expense(db, expense)

    assert row is not None
    assert expense.fx_rate == 1234.5
    assert expense.fx_rate_date == date.today()
    assert expense.fx_rate_source == "BNA"


def test_historical_usd_without_rate_stays_null(db, test_user, monkeypatch):
    def fail(*_args, **_kwargs):
        raise AssertionError("must not use today's rate for a past expense")

    monkeypatch.setattr(fx, "get_usd_rate", fail)
    expense = _expense(db, test_user.id, date=date.today() - timedelta(days=365))
    db.flush()

    assert fx.apply_rate_to_expense(db, expense) is None
    assert expense.fx_rate is None
    assert expense.fx_rate_date is None


def test_historical_usd_uses_the_stored_rate(db, test_user):
    old_day = date(2026, 1, 15)
    fx.save_rate(db, _rate(date(2026, 1, 10), 900.0))
    db.commit()
    expense = _expense(db, test_user.id, date=old_day)
    db.flush()

    row = fx.apply_rate_to_expense(db, expense)

    assert row is not None
    assert expense.fx_rate == 900.0
    assert expense.fx_rate_date == date(2026, 1, 10)
