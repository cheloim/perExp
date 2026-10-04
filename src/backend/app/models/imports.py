"""Import and scheduling models: ImportJob, ScheduledExpense, RecurringExpense."""

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
    LargeBinary,
    String,
    Text,
)
from sqlalchemy.orm import relationship

from app.database import Base
from app.types.encrypted import EncryptedType


class ImportJob(Base):
    __tablename__ = "import_jobs"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    filename = Column(String, nullable=False)
    status = Column(String, default="PROCESSING")  # PROCESSING | READY_PREVIEW | COMPLETED | FAILED
    file_content = Column(LargeBinary)
    preview_data = Column(Text)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)


class ScheduledExpense(Base):
    __tablename__ = "scheduled_expenses"
    __table_args__ = (
        Index("ix_scheduled_expenses_user_id", "user_id"),
        Index("ix_scheduled_expenses_user_status", "user_id", "status"),
    )

    id = Column(Integer, primary_key=True, index=True)
    installment_group_id = Column(String, nullable=False, index=True)
    installment_number = Column(Integer, nullable=False)
    installment_total = Column(Integer, nullable=False)

    scheduled_date = Column(Date, nullable=False, index=True)
    amount = Column(Float, nullable=False)
    currency = Column(String, default="ARS")
    description = Column(EncryptedType, nullable=False)
    description_hmac = Column(String(64), nullable=True, index=True)

    # Structured fields
    card_id = Column(Integer, ForeignKey("cards.id", ondelete="SET NULL"), nullable=True)
    account_id = Column(Integer, ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True)

    # Estado
    status = Column(String, default="PENDING", index=True)  # PENDING | EXECUTED | CANCELLED

    # Categoria
    category_id = Column(Integer, ForeignKey("categories.id", ondelete="SET NULL"), nullable=True)

    # Si fue ejecutada
    executed_expense_id = Column(
        Integer, ForeignKey("expenses.id", ondelete="SET NULL"), nullable=True
    )
    expense_id = Column(Integer, ForeignKey("expenses.id", ondelete="SET NULL"), nullable=True)
    executed_at = Column(DateTime, nullable=True)

    # Auditoria
    created_at = Column(DateTime, default=datetime.utcnow)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    transaction_id = Column(String, nullable=True, index=True)

    # Relationships
    category = relationship("Category")
    executed_expense = relationship("Expense", foreign_keys=[executed_expense_id])
    template_expense = relationship("Expense", foreign_keys=[expense_id])
    card_rel = relationship("Card")
    account_rel = relationship("Account")


class RecurringExpense(Base):
    __tablename__ = "recurring_expenses"
    __table_args__ = (Index("ix_recurring_expenses_user_id", "user_id"),)
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    merchant_key = Column(String(255), nullable=False)
    description = Column(String(500), nullable=False)
    amount = Column(Float, nullable=False)
    currency = Column(String, default="ARS")
    category_id = Column(Integer, ForeignKey("categories.id", ondelete="SET NULL"), nullable=True)
    card_id = Column(Integer, ForeignKey("cards.id", ondelete="SET NULL"), nullable=True)
    account_id = Column(Integer, ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True)
    tag_id = Column(Integer, ForeignKey("tags.id", ondelete="SET NULL"), nullable=True)
    frequency = Column(String, default="monthly")
    next_charge_date = Column(Date, nullable=True)
    alert_days_before = Column(Integer, default=3)
    is_active = Column(Boolean, default=True)
    source = Column(String(20), default="manual")  # auto | manual
    last_seen_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, onupdate=datetime.utcnow)

    user = relationship("User")
    category = relationship("Category")
    card = relationship("Card")
    account = relationship("Account")
    tag = relationship("Tag")
