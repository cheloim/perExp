"""AI and suggestion models: AnalysisHistory, CategorySuggestion, MerchantPreference."""

from datetime import datetime

from sqlalchemy import Column, DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import relationship

from app.database import Base


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


class CategorySuggestion(Base):
    __tablename__ = "category_suggestions"
    __table_args__ = (
        Index("ix_category_suggestions_user_id", "user_id"),
        Index("ix_category_suggestions_expense_id", "expense_id"),
        Index("ix_category_suggestions_status", "status"),
    )
    id = Column(Integer, primary_key=True, index=True)
    expense_id = Column(
        Integer, ForeignKey("expenses.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    suggested_category_id = Column(
        Integer, ForeignKey("categories.id", ondelete="CASCADE"), nullable=False
    )
    confidence = Column(Float, nullable=False)
    status = Column(String, default="pending")  # pending | approved | rejected
    source = Column(String, default="llm")  # llm | keyword
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    expense = relationship("Expense")
    suggested_category = relationship("Category")


class MerchantPreference(Base):
    __tablename__ = "merchant_preferences"
    __table_args__ = (
        Index("ix_merchant_preferences_user_id", "user_id"),
        UniqueConstraint("user_id", "merchant_key", name="uq_user_merchant"),
    )
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    merchant_key = Column(String(255), nullable=False)
    category_id = Column(Integer, ForeignKey("categories.id", ondelete="CASCADE"), nullable=False)
    confidence = Column(Float, default=1.0)
    usage_count = Column(Integer, default=1)
    last_used_at = Column(DateTime, default=datetime.utcnow)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User")
    category = relationship("Category")