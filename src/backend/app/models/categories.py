"""Category domain model."""

from datetime import datetime

from sqlalchemy import Column, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import relationship

from app.database import Base


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
    budget_group = Column(String(20), default="necesidades")  # necesidades | gustos | ahorro
    expenses = relationship("Expense", back_populates="category")
    budgets = relationship("Budget", back_populates="category")
    children = relationship("Category", back_populates="parent")
    parent = relationship("Category", back_populates="children", remote_side="Category.id")