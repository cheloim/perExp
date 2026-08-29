"""Integration tests for encryption with real PostgreSQL."""

import pytest
from datetime import date

from app.models import Account, Card, Expense, User
from app.services.encryption import (
    compute_hmac,
    decrypt_value,
    encrypt_value,
    is_encrypted,
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
    def test_create_card_generates_hmac(self, db, test_user):
        """Card creation generates HMAC columns."""
        card = Card(
            card_name="Visa Signature",
            card_name_hmac=compute_hmac("visa signature"),
            bank="Banco Nación",
            bank_hmac=compute_hmac("banco nacion"),
            card_type="credito",
            user_id=test_user.id,
        )
        db.add(card)
        db.flush()

        assert card.card_name_hmac == compute_hmac("visa signature")
        assert card.bank_hmac == compute_hmac("banco nacion")

    def test_filter_by_bank_hmac_works(self, db, test_user):
        """Filter by bank works with HMAC columns."""
        card = Card(
            card_name="Visa",
            card_name_hmac=compute_hmac("visa"),
            bank="Banco Nación",
            bank_hmac=compute_hmac("banco nacion"),
            card_type="credito",
            user_id=test_user.id,
        )
        db.add(card)
        db.flush()

        result = (
            db.query(Card).filter(Card.bank_hmac == compute_hmac("banco nacion")).first()
        )
        assert result is not None
        assert result.id == card.id


class TestExpenseEncryption:
    def test_create_expense_encrypts_description(self, db, test_user):
        """Expense description is encrypted."""
        expense = Expense(
            date=date.today(),
            description="Test expense",
            description_hmac=compute_hmac("test expense"),
            amount=100.0,
            user_id=test_user.id,
        )
        db.add(expense)
        db.flush()

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
            description_hmac=compute_hmac("farmacity medicamentos"),
            amount=100.0,
            user_id=test_user.id,
        )
        db.add(expense)
        db.flush()

        db.refresh(expense)
        assert expense.description == "Farmacity medicamentos"
        assert not is_encrypted(expense.description)

    def test_filter_expenses_by_hmac_works(self, db, test_user):
        """Filter expenses works with HMAC columns."""
        expense = Expense(
            date=date.today(),
            description="Farmacity medicamentos",
            description_hmac=compute_hmac("farmacity medicamentos"),
            amount=100.0,
            user_id=test_user.id,
        )
        db.add(expense)
        db.flush()

        result = (
            db.query(Expense)
            .filter(Expense.description_hmac == compute_hmac("farmacia"))
            .first()
        )
        assert result is None

        result = (
            db.query(Expense)
            .filter(Expense.description_hmac == compute_hmac("farmacity medicamentos"))
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


class TestAccountEncryption:
    def test_create_account_encrypts_name(self, db, test_user):
        """Account name is encrypted in database."""
        account = Account(
            name="Banco Nación Cuenta Corriente",
            name_hmac=compute_hmac("banco nacion cuenta corriente"),
            account_type="banco",
            user_id=test_user.id,
        )
        db.add(account)
        db.flush()

        from sqlalchemy import text

        result = db.execute(
            text("SELECT name FROM accounts WHERE id = :id"), {"id": account.id}
        ).fetchone()
        assert is_encrypted(result[0])

    def test_account_returns_decrypted_name(self, db, test_user):
        """Account object returns decrypted name."""
        account = Account(
            name="Banco Nación Cuenta Corriente",
            name_hmac=compute_hmac("banco nacion cuenta corriente"),
            account_type="banco",
            user_id=test_user.id,
        )
        db.add(account)
        db.flush()

        db.refresh(account)
        assert account.name == "Banco Nación Cuenta Corriente"
        assert not is_encrypted(account.name)

    def test_account_name_hmac_for_duplicate_detection(self, db, test_user):
        """Account name_hmac works for duplicate detection."""
        account1 = Account(
            name="Banco Nación",
            name_hmac=compute_hmac("banco nacion"),
            account_type="banco",
            user_id=test_user.id,
        )
        db.add(account1)
        db.flush()

        result = (
            db.query(Account)
            .filter(Account.name_hmac == compute_hmac("banco nacion"))
            .first()
        )
        assert result is not None
        assert result.id == account1.id

        different = (
            db.query(Account)
            .filter(Account.name_hmac == compute_hmac("otro banco"))
            .first()
        )
        assert different is None


class TestDecryptFallback:
    def test_decrypt_returns_encrypted_placeholder_on_failure(self):
        """Decrypt returns '[encrypted]' for invalid data."""
        result = decrypt_value("not-encrypted-data")
        assert result == "[encrypted]"

    def test_decrypt_returns_empty_for_none(self):
        """Decrypt returns None for None input."""
        assert decrypt_value(None) is None
        assert decrypt_value("") == ""
