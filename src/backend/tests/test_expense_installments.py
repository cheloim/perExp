"""Installment math and expansion tests."""

from datetime import date

import pytest


def test_split_installments_sums_exactly_to_total():
    from app.services.installments import split_installments

    plan = split_installments(100000, 12)
    assert [number for number, _ in plan] == list(range(1, 13))
    assert sum(amount for _, amount in plan) == pytest.approx(100000)


def test_split_installments_puts_rounding_remainder_on_last():
    from app.services.installments import split_installments

    plan = split_installments(100000, 12)
    assert plan[0][1] == pytest.approx(8333.33)
    assert plan[-1][1] == pytest.approx(8333.37)
    assert plan[-1][1] > plan[0][1]


def test_split_installments_can_start_at_the_current_installment():
    from app.services.installments import split_installments

    plan = split_installments(120000, 12, start=3)
    assert [number for number, _ in plan] == list(range(3, 13))
    assert plan[0][1] == pytest.approx(10000)


@pytest.mark.parametrize(
    ("total", "count", "start"),
    [(1000, 1, 1), (1000, 61, 1), (0, 6, 1), (-10, 6, 1), (1000, 6, 0), (1000, 6, 7)],
)
def test_split_installments_rejects_invalid_input(total, count, start):
    from app.services.installments import split_installments

    with pytest.raises(ValueError):
        split_installments(total, count, start=start)


def _user_and_expense(db):
    from app.models import Card, Category, Expense, User
    from app.services.auth import get_password_hash
    from app.services.encryption import compute_hmac

    user = User(
        email="installments@test.com",
        full_name="Installments User",
        hashed_password=get_password_hash("testpassword"),
        email_verified=True,
    )
    db.add(user)
    db.flush()
    card = Card(card_name="Visa", bank="Galicia", card_type="credito", user_id=user.id)
    category = Category(name="Tecnología", user_id=user.id)
    db.add_all([card, category])
    db.flush()
    expense = Expense(
        date=date(2026, 11, 1),
        description="TV",
        description_hmac=compute_hmac("TV"),
        amount=10000,
        currency="ARS",
        installment_number=1,
        installment_total=12,
        installment_group_id="group-1",
        card_id=card.id,
        category_id=category.id,
        user_id=user.id,
    )
    db.add(expense)
    db.flush()
    return user, expense


def test_create_future_installments_copies_fields_and_dates(db):
    from app.models import ScheduledExpense
    from app.services.installments import create_future_installments

    _, expense = _user_and_expense(db)
    created = create_future_installments(
        db,
        expense=expense,
        installment_total=12,
        amounts=[(number, 10000.0) for number in range(2, 13)],
    )
    db.flush()

    assert len(created) == 11
    assert all(row.status == "PENDING" for row in created)
    assert all(row.installment_group_id == expense.installment_group_id for row in created)
    assert all(row.expense_id == expense.id for row in created)
    assert [row.installment_number for row in created] == list(range(2, 13))
    assert created[0].scheduled_date == date(2026, 12, 1)
    assert created[-1].scheduled_date == date(2027, 10, 1)
    assert all(row.amount == 10000.0 for row in created)
    assert created[0].description == "TV"
    assert created[0].card_id == expense.card_id
    assert created[0].category_id == expense.category_id
    assert db.query(ScheduledExpense).count() == 11


def test_create_expense_with_total_mode_creates_the_series(db, test_user):
    from app.models import Card, Category, Expense, ScheduledExpense
    from app.routers.expenses import create_expense
    from app.schemas import ExpenseCreate

    card = Card(card_name="Visa", bank="Galicia", card_type="credito", user_id=test_user.id)
    category = Category(name="Tecnología", user_id=test_user.id)
    db.add_all([card, category])
    db.flush()

    created = create_expense(
        ExpenseCreate(
            date=date(2026, 11, 1),
            description="TV",
            amount=120000,
            installment_total=12,
            installment_number=1,
            installment_mode="total",
            card_id=card.id,
            category_id=category.id,
        ),
        db=db,
        current_user=test_user,
    )

    future = (
        db.query(ScheduledExpense)
        .filter(ScheduledExpense.expense_id == created.id)
        .order_by(ScheduledExpense.installment_number)
        .all()
    )
    assert created.amount == pytest.approx(10000)
    assert created.installment_number == 1
    assert created.installment_total == 12
    assert created.installment_group_id
    assert len(future) == 11
    assert [row.installment_number for row in future] == list(range(2, 13))
    assert created.amount + sum(row.amount for row in future) == pytest.approx(120000)

    # The committed rows outlive the fixture rollback; clean them up explicitly.
    db.query(ScheduledExpense).filter(ScheduledExpense.expense_id == created.id).delete()
    db.query(Expense).filter(Expense.id == created.id).delete()
    db.commit()


def test_create_expense_with_current_mode_does_not_divide(db, test_user):
    from app.models import Card, Category, Expense, ScheduledExpense
    from app.routers.expenses import create_expense
    from app.schemas import ExpenseCreate

    card = Card(card_name="Visa", bank="Galicia", card_type="credito", user_id=test_user.id)
    category = Category(name="Streaming", user_id=test_user.id)
    db.add_all([card, category])
    db.flush()

    created = create_expense(
        ExpenseCreate(
            date=date(2026, 11, 1),
            description="Netflix",
            amount=15000,
            installment_total=12,
            installment_number=3,
            installment_mode="current",
            card_id=card.id,
            category_id=category.id,
        ),
        db=db,
        current_user=test_user,
    )

    future = (
        db.query(ScheduledExpense)
        .filter(ScheduledExpense.expense_id == created.id)
        .order_by(ScheduledExpense.installment_number)
        .all()
    )
    assert created.amount == pytest.approx(15000)
    assert created.installment_number == 3
    assert [row.installment_number for row in future] == list(range(4, 13))
    assert all(row.amount == pytest.approx(15000) for row in future)

    db.query(ScheduledExpense).filter(ScheduledExpense.expense_id == created.id).delete()
    db.query(Expense).filter(Expense.id == created.id).delete()
    db.commit()


def test_create_expense_without_mode_keeps_single_row(db, test_user):
    from app.models import Expense, ScheduledExpense
    from app.routers.expenses import create_expense
    from app.schemas import ExpenseCreate

    created = create_expense(
        ExpenseCreate(
            date=date(2026, 11, 1),
            description="Café",
            amount=2500,
        ),
        db=db,
        current_user=test_user,
    )

    assert created.amount == pytest.approx(2500)
    assert created.installment_group_id is None
    assert db.query(ScheduledExpense).filter(ScheduledExpense.expense_id == created.id).count() == 0

    db.query(Expense).filter(Expense.id == created.id).delete()
    db.commit()


def test_deleting_the_template_expense_removes_pending_installments(db, test_user):
    from app.models import Expense, ScheduledExpense
    from app.routers.expenses import create_expense, delete_expense
    from app.schemas import ExpenseCreate

    created = create_expense(
        ExpenseCreate(
            date=date(2026, 11, 1),
            description="TV para borrar",
            amount=120000,
            installment_total=12,
            installment_number=1,
            installment_mode="total",
        ),
        db=db,
        current_user=test_user,
    )
    assert (
        db.query(ScheduledExpense).filter(ScheduledExpense.expense_id == created.id).count() == 11
    )

    delete_expense(created.id, db=db, current_user=test_user)

    assert db.query(Expense).filter(Expense.id == created.id).count() == 0
    assert db.query(ScheduledExpense).filter(ScheduledExpense.expense_id == created.id).count() == 0
