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
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from app.database import Base


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    full_name = Column(String, nullable=False, default="")
    email = Column(String, unique=True, nullable=False)
    invite_code = Column(String(8), nullable=True, unique=True, index=True)
    hashed_password = Column(String, nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    telegram_key = Column(String(12), nullable=True, unique=True, index=True)
    telegram_chat_id = Column(String, nullable=True, unique=True, index=True)
    provider = Column(String, nullable=True)
    provider_id = Column(String, nullable=True, index=True)
    avatar_url = Column(String, nullable=True)
    reset_token = Column(String(64), nullable=True, unique=True, index=True)
    reset_token_expires = Column(DateTime, nullable=True)
    # Security: MFA
    mfa_secret = Column(String(32), nullable=True)
    mfa_enabled = Column(Boolean, default=False)
    # Security: Email verification
    email_verified = Column(Boolean, default=False)
    email_verification_token = Column(String(64), nullable=True, unique=True, index=True)
    # Security: Forced password change
    force_password_change = Column(Boolean, default=False)


class Group(Base):
    __tablename__ = "groups"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    members = relationship("GroupMember", back_populates="group", cascade="all, delete-orphan")


class GroupMember(Base):
    __tablename__ = "group_members"
    __table_args__ = (UniqueConstraint("group_id", "user_id", name="uq_group_member"),)
    id = Column(Integer, primary_key=True, index=True)
    group_id = Column(Integer, ForeignKey("groups.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    role = Column(String, default="member")
    status = Column(String, default="accepted")  # pending | accepted | rejected
    invited_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    joined_at = Column(DateTime, default=datetime.utcnow)
    group = relationship("Group", back_populates="members")


class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (Index("ix_notifications_user_read", "user_id", "read"),)
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    type = Column(String, nullable=False)
    title = Column(String, nullable=False)
    body = Column(Text, default="")
    data = Column(Text, default="{}")  # JSON
    read = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)


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


class Category(Base):
    __tablename__ = "categories"
    __table_args__ = (
        Index("ix_categories_user_id", "user_id"),
        Index("ix_categories_parent_id", "parent_id"),
        UniqueConstraint("name", "user_id", name="uq_category_name_user"),
    )
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    color = Column(String, default="#6366f1")
    keywords = Column(Text, default="")
    parent_id = Column(Integer, ForeignKey("categories.id", ondelete="SET NULL"), nullable=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    expenses = relationship("Expense", back_populates="category")


class Account(Base):
    __tablename__ = "accounts"
    __table_args__ = (Index("ix_accounts_user_id", "user_id"),)
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
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
    )
    id = Column(Integer, primary_key=True, index=True)
    card_name = Column(String, nullable=False)  # Visa, Mastercard, etc
    bank = Column(String, default="")
    holder = Column(
        String, default=""
    )  # Primer nombre del usuario (para agrupar en grupo familiar)
    card_type = Column(String, default="credito")  # credito, debito
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


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
    description = Column(String, nullable=False)
    amount = Column(Float, nullable=False)
    category_id = Column(Integer, ForeignKey("categories.id", ondelete="SET NULL"), nullable=True)
    notes = Column(Text, default="")
    transaction_id = Column(String, nullable=True, index=True)
    currency = Column(String, default="ARS")
    installment_number = Column(Integer, nullable=True)
    installment_total = Column(Integer, nullable=True)
    installment_group_id = Column(String, nullable=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    account_id = Column(Integer, ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True)
    card_id = Column(Integer, ForeignKey("cards.id", ondelete="SET NULL"), nullable=True)
    is_income = Column(Boolean, default=False, nullable=False)
    category = relationship("Category", back_populates="expenses")
    account_rel = relationship("Account")
    card_rel = relationship("Card")


class AnalysisHistory(Base):
    __tablename__ = "analysis_history"
    __table_args__ = (Index("ix_analysis_history_user_id", "user_id"),)
    id = Column(Integer, primary_key=True, index=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    month = Column(String, nullable=True)
    question = Column(Text, nullable=True)
    result_text = Column(Text, nullable=False, default="")
    expense_count = Column(Integer, default=0)
    total_amount = Column(Float, default=0.0)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)


class Setting(Base):
    __tablename__ = "settings"
    key = Column(String, primary_key=True)
    value = Column(Text, default="")


class Investment(Base):
    __tablename__ = "investments"
    __table_args__ = (
        Index("ix_investments_user_id", "user_id"),
        Index("ix_investments_user_ticker_broker", "user_id", "ticker", "broker"),
    )
    id = Column(Integer, primary_key=True, index=True)
    ticker = Column(String, default="")
    name = Column(String, default="")
    type = Column(String, default="")
    broker = Column(String, default="")
    quantity = Column(Float, default=0.0)
    avg_cost = Column(Float, default=0.0)
    current_price = Column(Float, nullable=True)
    currency = Column(String, default="ARS")
    notes = Column(Text, default="")
    updated_at = Column(DateTime, default=datetime.utcnow)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)


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
    description = Column(String, nullable=False)

    # Structured fields
    card_id = Column(Integer, ForeignKey("cards.id", ondelete="SET NULL"), nullable=True)
    account_id = Column(Integer, ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True)

    # Estado
    status = Column(String, default="PENDING", index=True)  # PENDING | EXECUTED | CANCELLED

    # Categoría
    category_id = Column(Integer, ForeignKey("categories.id", ondelete="SET NULL"), nullable=True)

    # Si fue ejecutada
    executed_expense_id = Column(
        Integer, ForeignKey("expenses.id", ondelete="SET NULL"), nullable=True
    )
    executed_at = Column(DateTime, nullable=True)

    # Auditoría
    created_at = Column(DateTime, default=datetime.utcnow)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    transaction_id = Column(String, nullable=True, index=True)

    # Relationships
    category = relationship("Category")
    executed_expense = relationship("Expense", foreign_keys=[executed_expense_id])
    card_rel = relationship("Card")
    account_rel = relationship("Account")


class MonthlyReport(Base):
    __tablename__ = "monthly_reports"
    __table_args__ = (Index("ix_monthly_reports_user_month", "user_id", "month", unique=True),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    month = Column(String(7), nullable=False)  # YYYY-MM format
    status = Column(String(20), default="READY")  # PENDING | READY | FAILED
    report_data = Column(Text, nullable=True)  # JSON with full report data
    pdf_data = Column(LargeBinary, nullable=True)  # Generated PDF bytes (legacy)
    png_data = Column(LargeBinary, nullable=True)  # Generated PNG image bytes
    error_message = Column(Text, nullable=True)  # Error if FAILED
    created_at = Column(DateTime, default=datetime.utcnow)
    generated_at = Column(DateTime, nullable=True)


class AuditLog(Base):
    __tablename__ = "audit_logs"
    __table_args__ = (Index("ix_audit_logs_user_id", "user_id"),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    action = Column(String(50), nullable=False)
    ip_address = Column(String(45), nullable=True)
    user_agent = Column(String(500), nullable=True)
    details = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
