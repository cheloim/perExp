from sqlalchemy import (
    Column, Integer, String, Float, Date, ForeignKey, Text, DateTime, Boolean, inspect,
    text as sa_text,
)
from sqlalchemy.orm import relationship
from datetime import datetime
from app.database import Base, engine


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    dni = Column(String, unique=True, nullable=False, index=True)
    full_name = Column(String, nullable=False, default="")
    email = Column(String, unique=True, nullable=True)
    hashed_password = Column(String, nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class Group(Base):
    __tablename__ = "groups"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    members = relationship("GroupMember", back_populates="group")


class GroupMember(Base):
    __tablename__ = "group_members"
    id = Column(Integer, primary_key=True, index=True)
    group_id = Column(Integer, ForeignKey("groups.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    role = Column(String, default="member")
    joined_at = Column(DateTime, default=datetime.utcnow)
    group = relationship("Group", back_populates="members")


class Category(Base):
    __tablename__ = "categories"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)
    color = Column(String, default="#6366f1")
    keywords = Column(Text, default="")
    parent_id = Column(Integer, ForeignKey("categories.id"), nullable=True)
    expenses = relationship("Expense", back_populates="category")


class Expense(Base):
    __tablename__ = "expenses"
    id = Column(Integer, primary_key=True, index=True)
    date = Column(Date, nullable=False)
    description = Column(String, nullable=False)
    amount = Column(Float, nullable=False)
    category_id = Column(Integer, ForeignKey("categories.id"), nullable=True)
    card = Column(String, default="")
    bank = Column(String, default="")
    person = Column(String, default="")
    notes = Column(Text, default="")
    transaction_id = Column(String, nullable=True, index=True)
    currency = Column(String, default="ARS")
    installment_number = Column(Integer, nullable=True)
    installment_total = Column(Integer, nullable=True)
    installment_group_id = Column(String, nullable=True, index=True)
    card_last4 = Column(String(4), nullable=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    group_id = Column(Integer, ForeignKey("groups.id"), nullable=True)
    category = relationship("Category", back_populates="expenses")


class AnalysisHistory(Base):
    __tablename__ = "analysis_history"
    id = Column(Integer, primary_key=True, index=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    month = Column(String, nullable=True)
    question = Column(Text, nullable=True)
    result_text = Column(Text, nullable=False, default="")
    expense_count = Column(Integer, default=0)
    total_amount = Column(Float, default=0.0)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)


class Setting(Base):
    __tablename__ = "settings"
    key = Column(String, primary_key=True)
    value = Column(Text, default="")


class Investment(Base):
    __tablename__ = "investments"
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
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)


class CardClosing(Base):
    __tablename__ = "card_closings"
    id = Column(Integer, primary_key=True, index=True)
    card = Column(String, nullable=False, default="")
    card_last_digits = Column(String, default="")
    card_type = Column(String, default="")
    bank = Column(String, default="")
    closing_date = Column(Date, nullable=False)
    next_closing_date = Column(Date, nullable=True)
    due_date = Column(Date, nullable=True)
    last_imported_at = Column(DateTime, default=datetime.utcnow)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)


Base.metadata.create_all(bind=engine)

# Add new columns to existing DBs without losing data
with engine.connect() as _conn:
    _cols = [c["name"] for c in inspect(engine).get_columns("expenses")]
    for _col, _type in [
        ("bank", "VARCHAR DEFAULT ''"),
        ("person", "VARCHAR DEFAULT ''"),
        ("transaction_id", "VARCHAR"),
        ("currency", "VARCHAR DEFAULT 'ARS'"),
        ("installment_number", "INTEGER"),
        ("installment_total", "INTEGER"),
        ("installment_group_id", "VARCHAR"),
        ("card_last4", "VARCHAR(4)"),
        ("user_id", "INTEGER REFERENCES users(id)"),
        ("group_id", "INTEGER REFERENCES groups(id)"),
    ]:
        if _col not in _cols:
            _conn.execute(sa_text(f"ALTER TABLE expenses ADD COLUMN {_col} {_type}"))
    _cat_cols = [c["name"] for c in inspect(engine).get_columns("categories")]
    if "parent_id" not in _cat_cols:
        _conn.execute(sa_text("ALTER TABLE categories ADD COLUMN parent_id INTEGER REFERENCES categories(id)"))
    for _tbl, _col, _type in [
        ("analysis_history", "user_id", "INTEGER REFERENCES users(id)"),
        ("investments", "user_id", "INTEGER REFERENCES users(id)"),
        ("card_closings", "user_id", "INTEGER REFERENCES users(id)"),
    ]:
        _tbl_cols = [c["name"] for c in inspect(engine).get_columns(_tbl)]
        if _col not in _tbl_cols:
            _conn.execute(sa_text(f"ALTER TABLE {_tbl} ADD COLUMN {_col} {_type}"))
    _conn.commit()
