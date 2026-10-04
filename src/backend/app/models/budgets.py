"""Budget domain models: Budget, BudgetGroup, BudgetEvent."""

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
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from app.database import Base


class Budget(Base):
    __tablename__ = "budgets"
    __table_args__ = (
        Index("ix_budgets_user_id", "user_id"),
        Index("ix_budgets_category_id", "category_id"),
        UniqueConstraint("user_id", "category_id", name="uq_budget_user_cat"),
    )
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    category_id = Column(Integer, ForeignKey("categories.id", ondelete="CASCADE"), nullable=False)
    amount = Column(Float, nullable=False)
    alert_threshold = Column(Float, default=0.80)
    rollover = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, onupdate=datetime.utcnow)
    category = relationship("Category", back_populates="budgets")


class BudgetGroup(Base):
    __tablename__ = "budget_groups"
    __table_args__ = (
        Index("ix_budget_groups_user_id", "user_id"),
        UniqueConstraint("user_id", "name", name="uq_budget_group_user_name"),
    )
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(20), nullable=False)
    display_name = Column(String(50), nullable=False)
    percentage = Column(Float, nullable=False)
    amount = Column(Float, default=0)
    spent = Column(Float, default=0)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, onupdate=datetime.utcnow)


class BudgetEvent(Base):
    __tablename__ = "budget_events"
    __table_args__ = (Index("ix_budget_events_user_id", "user_id"),)
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(100), nullable=False)
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=False)
    total_amount = Column(Float, nullable=False)
    spent = Column(Float, default=0)
    categories = Column(Text, default="[]")
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, onupdate=datetime.utcnow)
