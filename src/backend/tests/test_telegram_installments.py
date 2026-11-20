"""Telegram installment detection and saved-message formatting."""

from datetime import date
from types import SimpleNamespace

import pytest

from app import telegram_bot


class _SessionProxy:
    """Give _save_expense the test session without closing it."""

    def __init__(self, session):
        self._session = session

    def __getattr__(self, name):
        return getattr(self._session, name)

    def close(self):
        pass


def _seed(db, email="tg-installments@test.com"):
    from app.models import Card, Category, User
    from app.services.auth import get_password_hash

    user = User(
        email=email,
        full_name="TG Installments",
        hashed_password=get_password_hash("testpassword"),
        email_verified=True,
    )
    db.add(user)
    db.flush()
    card = Card(card_name="Visa", bank="Galicia", card_type="credito", user_id=user.id)
    category = Category(name="Tecnología", user_id=user.id)
    db.add_all([card, category])
    db.flush()
    return user, card, category


def _cleanup(db, expense):
    from app.models import Expense, ScheduledExpense

    db.query(ScheduledExpense).filter(ScheduledExpense.expense_id == expense.id).delete()
    db.query(Expense).filter(Expense.id == expense.id).delete()
    db.commit()


def test_save_expense_total_mode_creates_the_whole_series(db, monkeypatch):
    from app.models import ScheduledExpense

    user, card, category = _seed(db)
    monkeypatch.setattr(telegram_bot, "SessionLocal", lambda: _SessionProxy(db))

    expense = telegram_bot._save_expense(
        {
            "amount": 120000,
            "description": "TV",
            "date": "2026-11-01",
            "currency": "ARS",
        },
        payment="",
        person="Test",
        user_id=user.id,
        predicted_category_id=category.id,
        card_id=card.id,
        installment_total=12,
        installment_number=1,
        amount_is_total=True,
    )

    future = (
        db.query(ScheduledExpense)
        .filter(ScheduledExpense.expense_id == expense.id)
        .order_by(ScheduledExpense.installment_number)
        .all()
    )
    assert expense.amount == pytest.approx(10000)
    assert expense.installment_number == 1
    assert expense.installment_total == 12
    assert expense.installment_group_id
    assert [row.installment_number for row in future] == list(range(2, 13))
    assert expense.amount + sum(row.amount for row in future) == pytest.approx(120000)
    _cleanup(db, expense)


def test_save_expense_current_mode_does_not_divide(db, monkeypatch):
    from app.models import ScheduledExpense

    user, card, category = _seed(db, email="tg-current@test.com")
    monkeypatch.setattr(telegram_bot, "SessionLocal", lambda: _SessionProxy(db))

    expense = telegram_bot._save_expense(
        {
            "amount": 15000,
            "description": "Netflix",
            "date": "2026-11-01",
            "currency": "ARS",
        },
        payment="",
        person="Test",
        user_id=user.id,
        predicted_category_id=category.id,
        card_id=card.id,
        installment_total=12,
        installment_number=3,
        amount_is_total=False,
    )

    future = (
        db.query(ScheduledExpense)
        .filter(ScheduledExpense.expense_id == expense.id)
        .order_by(ScheduledExpense.installment_number)
        .all()
    )
    assert expense.amount == pytest.approx(15000)
    assert expense.installment_number == 3
    assert [row.installment_number for row in future] == list(range(4, 13))
    assert all(row.amount == pytest.approx(15000) for row in future)
    _cleanup(db, expense)


@pytest.mark.parametrize(
    ("parsed", "expected"),
    [
        ({}, {}),
        (
            {"installment_total": 12, "installment_number": 3, "amount_kind": "installment"},
            {"installment_total": 12, "installment_number": 3, "amount_is_total": False},
        ),
        (
            {"installment_total": 12, "installment_number": 1, "amount_kind": "total"},
            {"installment_total": 12, "installment_number": 1, "amount_is_total": True},
        ),
        (
            {"installment_total": 6, "installment_number": 1},
            {"installment_total": 6, "installment_number": 1, "amount_is_total": True},
        ),
        (
            {"installment_total": 6, "installment_number": 4},
            {"installment_total": 6, "installment_number": 4, "amount_is_total": False},
        ),
    ],
)
def test_installment_args_from_parsed(parsed, expected):
    assert telegram_bot._installment_args(parsed) == expected


def test_saved_text_shows_a_current_installment_without_repeating_the_total():
    expense = SimpleNamespace(
        amount=15000,
        currency="ARS",
        date=date(2026, 11, 1),
        installment_number=3,
        installment_total=12,
        _cat_levels=[],
        _tags=[],
    )
    text = telegram_bot._saved_text(expense)
    assert "Cuota 3 de 12" in text
    assert "$ 15.000,00" in text
    assert "12 cuotas de" not in text


def test_saved_text_shows_the_split_for_a_new_purchase():
    expense = SimpleNamespace(
        amount=10000,
        currency="ARS",
        date=date(2026, 11, 1),
        installment_number=1,
        installment_total=12,
        _cat_levels=[],
        _tags=[],
    )
    text = telegram_bot._saved_text(expense)
    assert "$ 120.000,00" in text
    assert "12 cuotas de $ 10.000,00" in text


def test_confirm_text_shows_the_current_installment():
    parsed = {
        "amount": 15000,
        "description": "Netflix",
        "date": "2026-11-01",
        "currency": "ARS",
        "amount_kind": "installment",
        "installment_number": 3,
    }
    text = telegram_bot._confirm_text(parsed, "Visa", installments=12)
    assert "Cuota 3 de 12" in text
    assert "$ 15.000,00" in text


class _EmptyQuery:
    def filter(self, *args, **kwargs):
        return self

    def join(self, *args, **kwargs):
        return self

    def first(self):
        return None

    def all(self):
        return []


class _FakeDB:
    def close(self):
        pass

    def query(self, *args, **kwargs):
        return _EmptyQuery()


def test_bank_notification_uses_the_installments_the_parser_extracted(monkeypatch):
    import asyncio

    parsed = {
        "amount": 15000,
        "description": "Netflix",
        "date": "2026-11-01",
        "currency": "ARS",
        "card_type": "credito",
        "card_name": "Visa",
        "bank": "Galicia",
        "installment_number": 3,
        "installment_total": 12,
        "amount_kind": "installment",
    }
    replies = []

    async def reply_text(text, **kwargs):
        replies.append(text)

    update = SimpleNamespace(
        message=SimpleNamespace(reply_text=reply_text),
        effective_chat=SimpleNamespace(id=1),
        effective_user=SimpleNamespace(full_name="Test"),
    )
    context = SimpleNamespace(user_data={"user_id": 42})
    captured = {}

    def fake_save(parsed, **kwargs):
        captured.update(kwargs)
        return SimpleNamespace(
            id=1,
            amount=15000,
            currency="ARS",
            description="Netflix",
            category_id=None,
        )

    monkeypatch.setattr(telegram_bot, "_parse_bank_notification", lambda *a, **k: parsed)
    monkeypatch.setattr(telegram_bot, "SessionLocal", lambda: _FakeDB())
    monkeypatch.setattr(
        telegram_bot,
        "_match_card_from_notification",
        lambda *a, **k: SimpleNamespace(id=7, card_type="credito"),
    )
    monkeypatch.setattr(telegram_bot, "_instant_categorize", lambda *a, **k: (None, []))
    monkeypatch.setattr(telegram_bot, "_save_expense", fake_save)
    monkeypatch.setattr(telegram_bot, "_quick_saved_text", lambda *a, **k: "✅ Guardado")

    asyncio.run(telegram_bot._handle_bank_notification(update, context, "texto", log_content=False))

    assert captured["installment_total"] == 12
    assert captured["installment_number"] == 3
    assert captured["amount_is_total"] is False
    assert replies[-1] == "✅ Guardado"
