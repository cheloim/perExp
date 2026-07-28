"""Integration tests for encryption with real PostgreSQL."""

import pytest
from datetime import date

from app.models import Card, Expense, User
from app.services.encryption import (
    compute_hmac,
    decrypt_value,
    encrypt_value,
    is_encrypted,
    tokenize_description,
)


class TestUserEncryption:
    def test_create_user_encrypts_full_name(self, db, test_user):
        """Full name is encrypted in database."""
        db.refresh(test_user)
        # Check raw database value is encrypted
        from sqlalchemy import text

        result = db.execute(
            text("SELECT full_name FROM users WHERE id = :id"), {"id": test_user.id}
        ).fetchone()
        assert is_encrypted(result[0])

    def test_user_returns_decrypted_name(self, db, test_user):
        """User object returns decrypted full_name."""
        db.refresh(test_user)
        assert test_user.full_name == "Test, User"
        assert not is_encrypted(test_user.full_name)


class TestCardEncryption:
    def test_create_card_generates_search_tokens(self, db, test_user):
        """Card creation generates search tokens."""
        card = Card(
            card_name="Visa Signature",
            card_name_search=tokenize_description("Visa Signature"),
            bank="Banco Nación",
            bank_search=tokenize_description("Banco Nación"),
            holder="Test, User",
            holder_search=tokenize_description("Test, User"),
            card_type="credito",
            user_id=test_user.id,
        )
        db.add(card)
        db.flush()

        assert card.card_name_search == "visa signature"
        assert card.bank_search == "banco nacion"
        assert card.holder_search == "test user"

    def test_filter_by_bank_works(self, db, test_user):
        """Filter by bank works with search columns."""
        card = Card(
            card_name="Visa",
            card_name_search="visa",
            bank="Banco Nación",
            bank_search="banco nacion",
            holder="Test",
            holder_search="test",
            card_type="credito",
            user_id=test_user.id,
        )
        db.add(card)
        db.flush()

        result = (
            db.query(Card).filter(Card.bank_search.ilike("%banco%")).first()
        )
        assert result is not None
        assert result.id == card.id

    def test_filter_by_holder_works(self, db, test_user):
        """Filter by holder works with search columns."""
        card = Card(
            card_name="Mastercard",
            card_name_search="mastercard",
            bank="BBVA",
            bank_search="bbva",
            holder="Marcelo",
            holder_search="marcelo",
            card_type="credito",
            user_id=test_user.id,
        )
        db.add(card)
        db.flush()

        result = (
            db.query(Card).filter(Card.holder_search.ilike("%marcelo%")).first()
        )
        assert result is not None
        assert result.id == card.id


class TestExpenseEncryption:
    def test_create_expense_encrypts_description(self, db, test_user):
        """Expense description is encrypted."""
        expense = Expense(
            date=date.today(),
            description="Test expense",
            description_search="test expense",
            amount=100.0,
            user_id=test_user.id,
        )
        db.add(expense)
        db.flush()

        # Check raw database
        from sqlalchemy import text

        result = db.execute(
            text("SELECT description FROM expenses WHERE id = :id"), {"id": expense.id}
        ).fetchone()
        assert is_encrypted(result[0])

    def test_expense_returns_decrypted_description(self, db, test_user):
        """Expense object returns decrypted description."""
        expense = Expense(
            date=date.today(),
            description="Farmacity medicamentos",
            description_search="farmacity medicamentos",
            amount=100.0,
            user_id=test_user.id,
        )
        db.add(expense)
        db.flush()

        db.refresh(expense)
        assert expense.description == "Farmacity medicamentos"
        assert not is_encrypted(expense.description)

    def test_search_expenses_works(self, db, test_user):
        """Search expenses works with encrypted fields."""
        expense = Expense(
            date=date.today(),
            description="Farmacity medicamentos",
            description_search="farmacity medicamentos",
            amount=100.0,
            user_id=test_user.id,
        )
        db.add(expense)
        db.flush()

        result = (
            db.query(Expense)
            .filter(Expense.description_search.ilike("%farmacia%"))
            .first()
        )
        assert result is not None
        assert result.id == expense.id


class TestTelegramBotLookup:
    def test_bot_finds_user_by_chat_hash(self, db, test_user):
        """Bot finds user by telegram_chat_hash."""
        chat_id = "123456789"
        test_user.telegram_chat_id = chat_id
        test_user.telegram_chat_hash = compute_hmac(chat_id)
        db.flush()

        result = (
            db.query(User)
            .filter(User.telegram_chat_hash == compute_hmac(chat_id))
            .first()
        )
        assert result is not None
        assert result.id == test_user.id


class TestDecryptFallback:
    def test_decrypt_returns_encrypted_placeholder_on_failure(self):
        """Decrypt returns '[encrypted]' for invalid data."""
        result = decrypt_value("not-encrypted-data")
        assert result == "[encrypted]"

    def test_decrypt_returns_empty_for_none(self):
        """Decrypt returns None for None input."""
        assert decrypt_value(None) is None
        assert decrypt_value("") == ""
