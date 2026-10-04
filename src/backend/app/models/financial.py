"""Financial domain models: Account, Card, Expense, Tag, ExpenseTag, CardClosing."""

from datetime import datetime

from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
)
from sqlalchemy.orm import relationship

from app.database import Base
from app.types.encrypted import EncryptedType


class Account(Base):
    __tablename__ = "accounts"
    __table_args__ = (Index("ix_accounts_user_id", "user_id"),)
    id = Column(Integer, primary_key=True, index=True)
    name = Column(EncryptedType, nullable=False)
    name_hmac = Column(String(64), nullable=True, index=True)
    type = Column(
        String, default="efectivo"
    )  # efectivo, cuenta_corriente, caja_ahorro, mercadopago, etc
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class Card(Base):
    __tablename__ = "cards"
    __table_args__ = (
        Index("ix_cards_user_id", "user_id"),
        Index("ix_cards_card_type", "card_type"),
        Index("ix_cards_linked_account_id", "linked_account_id"),
    )
    id = Column(Integer, primary_key=True, index=True)
    card_name = Column(EncryptedType, nullable=False)  # Visa, Mastercard, etc
    card_name_hmac = Column(String(64), nullable=True, index=True)
    bank = Column(EncryptedType, default="")
    bank_hmac = Column(String(64), nullable=True, index=True)
    holder = Column(
        EncryptedType, default=""
    )  # Primer nombre del usuario (para agrupar en grupo familiar)
    card_type = Column(String, default="credito")  # credito, debito
    linked_account_id = Column(
        Integer, ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True
    )
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    linked_account = relationship("Account")


class Expense(Base):
    __tablename__ = "expenses"
    __table_args__ = (
        Index("ix_expenses_user_date", "user_id", "date"),
        Index("ix_expenses_user_category", "user_id", "category_id"),
        Index("ix_expenses_user_installment", "user_id", "installment_group_id"),
        Index("ix_expenses_user_id", "user_id"),
        Index("ix_expenses_card_id", "card_id"),
        Index("ix_expenses_category_id", "category_id"),
        Index("ix_expenses_account_id", "account_id"),
        Index("ix_expenses_is_income", "is_income"),
    )
    id = Column(Integer, primary_key=True, index=True)
    date = Column(Date, nullable=False)
    description = Column(EncryptedType, nullable=False)
    description_hmac = Column(String(64), nullable=True, index=True)
    amount = Column(Float, nullable=False)
    category_id = Column(Integer, ForeignKey("categories.id", ondelete="SET NULL"), nullable=True)
    notes = Column(EncryptedType, default="")
    transaction_id = Column(String, nullable=True, index=True)
    currency = Column(String, default="ARS")
    installment_number = Column(Integer, nullable=True)
    installment_total = Column(Integer, nullable=True)
    installment_group_id = Column(String, nullable=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    account_id = Column(Integer, ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True)
    card_id = Column(Integer, ForeignKey("cards.id", ondelete="SET NULL"), nullable=True)
    budget_event_id = Column(
        Integer, ForeignKey("budget_events.id", ondelete="SET NULL"), nullable=True
    )
    recurring_expense_id = Column(
        Integer, ForeignKey("recurring_expenses.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    is_income = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=True)
    category = relationship("Category", back_populates="expenses")
    account_rel = relationship("Account")
    card_rel = relationship("Card")
    recurring_expense = relationship("RecurringExpense")
    tags = relationship("Tag", secondary="expense_tags", back_populates="expenses")


class Tag(Base):
    __tablename__ = "tags"
    __table_args__ = (
        Index("ix_tags_user_id", "user_id"),
        Index("ix_tags_card_id", "card_id"),
        Index("ix_tags_account_id", "account_id"),
        Index("ix_tags_category_id", "category_id"),
        Index("ix_tags_group_name", "group_name"),
    )
    id = Column(Integer, primary_key=True, index=True)
    name = Column(EncryptedType, nullable=False)
    name_hmac = Column(String(64), nullable=False, index=True)
    color = Column(String(7), default="#6366f1")
    group_name = Column(String(20), nullable=False, default="otros")
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    card_id = Column(Integer, ForeignKey("cards.id", ondelete="SET NULL"), nullable=True)
    account_id = Column(Integer, ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True)
    category_id = Column(Integer, ForeignKey("categories.id", ondelete="CASCADE"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    expenses = relationship("Expense", secondary="expense_tags", back_populates="tags")
    card_rel = relationship("Card")
    account_rel = relationship("Account")
    category_rel = relationship("Category")


class ExpenseTag(Base):
    __tablename__ = "expense_tags"
    __table_args__ = (Index("ix_expense_tags_tag_id", "tag_id"),)
    expense_id = Column(Integer, ForeignKey("expenses.id", ondelete="CASCADE"), primary_key=True)
    tag_id = Column(Integer, ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True)


class CardClosing(Base):
    __tablename__ = "card_closings"
    __table_args__ = (Index("ix_card_closings_user_id", "user_id"),)
    id = Column(Integer, primary_key=True, index=True)
    card = Column(String, nullable=False, default="")
    card_last_digits = Column(String, default="")
    card_type = Column(String, default="")
    bank = Column(String, default="")
    card_id = Column(Integer, ForeignKey("cards.id", ondelete="SET NULL"), nullable=True)
    closing_date = Column(Date, nullable=False)
    next_closing_date = Column(Date, nullable=True)
    due_date = Column(Date, nullable=True)
    last_imported_at = Column(DateTime, default=datetime.utcnow)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    card_rel = relationship("Card")
