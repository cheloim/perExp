"""AI and suggestion models: AnalysisHistory, CategorySuggestion, MerchantPreference.

`CategorizationReview` is the internal, admin-only counterpart of
`CategorySuggestion`: it flags expenses that *have* a category but look
miscategorized. It never reaches the end user (issue #414).
"""

from datetime import datetime

from sqlalchemy import (
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
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


class CategorizationReview(Base):
    """Internal review of an expense that looks miscategorized (issue #414).

    Admin-only: a finding of the miscategorization detector, resolved as
    pending / accepted / rejected / investigated. It never shows up in the
    user-facing suggestion flow.
    """

    __tablename__ = "categorization_reviews"
    __table_args__ = (
        Index("ix_categorization_reviews_user_id", "user_id"),
        Index("ix_categorization_reviews_expense_id", "expense_id"),
        Index("ix_categorization_reviews_status", "status"),
        Index("ix_categorization_reviews_status_score", "status", "score"),
        UniqueConstraint("expense_id", "detector_version", name="uq_review_expense_version"),
    )
    id = Column(Integer, primary_key=True, index=True)
    expense_id = Column(Integer, ForeignKey("expenses.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    current_category_id = Column(
        Integer, ForeignKey("categories.id", ondelete="SET NULL"), nullable=True
    )
    suggested_category_id = Column(
        Integer, ForeignKey("categories.id", ondelete="SET NULL"), nullable=True
    )
    score = Column(Float, nullable=False)
    source = Column(String, default="rules")  # rules | rules+llm
    reason = Column(Text, default="")
    evidence = Column(Text, default="{}")  # JSON: signals, merchant_key, llm verdict
    detector_version = Column(String, nullable=False)
    status = Column(String, default="pending")  # pending | accepted | rejected | investigated
    reviewed_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    expense = relationship("Expense")
    current_category = relationship("Category", foreign_keys=[current_category_id])
    suggested_category = relationship("Category", foreign_keys=[suggested_category_id])
    reviewer = relationship("User", foreign_keys=[reviewed_by])
