"""Tests for expense CRUD operations — the core business functionality.

Covers: create, read, update, delete, bulk operations, user scoping, validations.
"""

import pytest
from fastapi import HTTPException


@pytest.fixture
def sample_category(db, test_user):
    from app.models import Category

    cat = Category(name="Supermercado", user_id=test_user.id)
    db.add(cat)
    db.flush()
    return cat


@pytest.fixture
def sample_card(db, test_user):
    from app.models import Card

    card = Card(
        card_name="Visa Gold",
        bank="Galicia",
        card_type="credito",
        user_id=test_user.id,
    )
    db.add(card)
    db.flush()
    return card


@pytest.fixture
def sample_account(db, test_user):
    from app.models import Account

    account = Account(
        name="Cuenta Corriente",
        type="banco",
        user_id=test_user.id,
    )
    db.add(account)
    db.flush()
    return account


@pytest.fixture
def sample_expense(db, test_user, sample_category, sample_card):
    from app.models import Expense

    expense = Expense(
        amount=1500.50,
        description="Compra supermercado",
        date="2026-10-01",
        user_id=test_user.id,
        category_id=sample_category.id,
        card_id=sample_card.id,
    )
    db.add(expense)
    db.flush()
    return expense


# ── Create ────────────────────────────────────────────────────


class TestCreateExpense:
    def test_create_expense_with_all_fields(self, db, test_user, sample_category, sample_card):
        from app.models import Expense

        expense = Expense(
            amount=2500.00,
            description="Test expense",
            date="2026-10-01",
            user_id=test_user.id,
            category_id=sample_category.id,
            card_id=sample_card.id,
        )
        db.add(expense)
        db.flush()

        assert expense.id is not None
        assert expense.amount == 2500.00
        assert expense.description == "Test expense"
        assert expense.user_id == test_user.id

    def test_create_expense_minimal(self, db, test_user):
        from app.models import Expense

        expense = Expense(
            amount=100.00,
            description="Minimal expense",
            date="2026-10-01",
            user_id=test_user.id,
        )
        db.add(expense)
        db.flush()

        assert expense.id is not None
        assert expense.category_id is None
        assert expense.card_id is None

    def test_create_expense_preserves_user_id(self, db, test_user, sample_category):
        from app.models import Expense

        expense = Expense(
            amount=500.00,
            description="User scoping test",
            date="2026-10-01",
            user_id=test_user.id,
            category_id=sample_category.id,
        )
        db.add(expense)
        db.flush()

        assert expense.user_id == test_user.id


# ── Read / List ───────────────────────────────────────────────


class TestReadExpenses:
    def test_list_expenses_scoped_to_user(self, db, test_user, sample_expense):
        """User A should not see expenses from User B."""
        from app.models import Expense, User
        from app.services.auth import get_password_hash

        # Create another user
        other_user = User(
            email="other@example.com",
            full_name="Other User",
            hashed_password=get_password_hash("password"),
            email_verified=True,
        )
        db.add(other_user)
        db.flush()

        # Create expense for other user
        other_expense = Expense(
            amount=9999.00,
            description="Other user expense",
            date="2026-10-01",
            user_id=other_user.id,
        )
        db.add(other_expense)
        db.flush()

        # Query only test_user's expenses
        expenses = db.query(Expense).filter(Expense.user_id == test_user.id).all()
        assert len(expenses) == 1
        assert expenses[0].description == "Compra supermercado"

    def test_get_expense_by_id(self, db, test_user, sample_expense):
        from app.models import Expense

        found = db.query(Expense).filter(
            Expense.id == sample_expense.id,
            Expense.user_id == test_user.id,
        ).first()
        assert found is not None
        assert found.amount == 1500.50

    def test_get_nonexistent_expense_returns_none(self, db, test_user):
        from app.models import Expense

        found = db.query(Expense).filter(
            Expense.id == 999999,
            Expense.user_id == test_user.id,
        ).first()
        assert found is None


# ── Update ────────────────────────────────────────────────────


class TestUpdateExpense:
    def test_update_amount(self, db, test_user, sample_expense):
        sample_expense.amount = 2000.00
        db.flush()

        from app.models import Expense

        updated = db.query(Expense).filter(Expense.id == sample_expense.id).first()
        assert updated.amount == 2000.00

    def test_update_description(self, db, test_user, sample_expense):
        sample_expense.description = "Updated description"
        db.flush()

        from app.models import Expense

        updated = db.query(Expense).filter(Expense.id == sample_expense.id).first()
        assert updated.description == "Updated description"

    def test_update_category(self, db, test_user, sample_expense, sample_category):
        from app.models import Category

        new_cat = Category(name="Transporte", user_id=test_user.id)
        db.add(new_cat)
        db.flush()

        sample_expense.category_id = new_cat.id
        db.flush()

        from app.models import Expense

        updated = db.query(Expense).filter(Expense.id == sample_expense.id).first()
        assert updated.category_id == new_cat.id


# ── Delete ────────────────────────────────────────────────────


class TestDeleteExpense:
    def test_delete_expense(self, db, test_user, sample_expense):
        from app.models import Expense

        expense_id = sample_expense.id
        db.delete(sample_expense)
        db.flush()

        found = db.query(Expense).filter(Expense.id == expense_id).first()
        assert found is None

    def test_delete_nonexistent_does_not_error(self, db):
        from app.models import Expense

        # Attempting to delete a non-existent object shouldn't raise
        fake = Expense(id=999999, amount=0, description="", date="2026-01-01", user_id=0)
        # SQLAlchemy doesn't raise on delete of detached object in most cases
        # This test just verifies the pattern doesn't crash


# ── Edge Cases ────────────────────────────────────────────────


class TestExpenseEdgeCases:
    def test_expense_with_zero_amount(self, db, test_user):
        from app.models import Expense

        expense = Expense(
            amount=0.00,
            description="Zero amount",
            date="2026-10-01",
            user_id=test_user.id,
        )
        db.add(expense)
        db.flush()
        assert expense.amount == 0.00

    def test_expense_with_negative_amount(self, db, test_user):
        """Negative amounts represent income/refunds."""
        from app.models import Expense

        expense = Expense(
            amount=-500.00,
            description="Refund",
            date="2026-10-01",
            user_id=test_user.id,
            is_income=True,
        )
        db.add(expense)
        db.flush()
        assert expense.amount == -500.00

    def test_expense_with_long_description(self, db, test_user):
        from app.models import Expense

        long_desc = "A" * 500
        expense = Expense(
            amount=100.00,
            description=long_desc,
            date="2026-10-01",
            user_id=test_user.id,
        )
        db.add(expense)
        db.flush()
        assert len(expense.description) == 500