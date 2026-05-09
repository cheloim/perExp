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
    status = Column(String, default="accepted")  # pending | accepted | rejected
    invited_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    joined_at = Column(DateTime, default=datetime.utcnow)
    group = relationship("Group", back_populates="members")


class Notification(Base):
    __tablename__ = "notifications"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    type = Column(String, nullable=False)
    title = Column(String, nullable=False)
    body = Column(Text, default="")
    data = Column(Text, default="{}")  # JSON
    read = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class Category(Base):
    __tablename__ = "categories"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    color = Column(String, default="#6366f1")
    keywords = Column(Text, default="")
    parent_id = Column(Integer, ForeignKey("categories.id"), nullable=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    expenses = relationship("Expense", back_populates="category")


class Account(Base):
    __tablename__ = "accounts"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    type = Column(String, default="efectivo")  # efectivo, cuenta_corriente, caja_ahorro, mercadopago, etc
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class Card(Base):
    __tablename__ = "cards"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)  # Visa, Mastercard, etc
    bank = Column(String, default="")
    holder = Column(String, default="")  # Nombre del titular
    card_type = Column(String, default="credito")  # credito, debito
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class Expense(Base):
    __tablename__ = "expenses"
    id = Column(Integer, primary_key=True, index=True)
    date = Column(Date, nullable=False)
    description = Column(String, nullable=False)
    amount = Column(Float, nullable=False)
    category_id = Column(Integer, ForeignKey("categories.id"), nullable=True)
    # Legacy fields (deprecated, use account_id or card_id instead)
    card = Column(String, default="")
    bank = Column(String, default="")
    person = Column(String, default="")
    notes = Column(Text, default="")
    transaction_id = Column(String, nullable=True, index=True)
    currency = Column(String, default="ARS")
    installment_number = Column(Integer, nullable=True)
    installment_total = Column(Integer, nullable=True)
    installment_group_id = Column(String, nullable=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    group_id = Column(Integer, ForeignKey("groups.id"), nullable=True)
    # New structured fields
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=True)
    card_id = Column(Integer, ForeignKey("cards.id"), nullable=True)
    category = relationship("Category", back_populates="expenses")
    account_rel = relationship("Account")
    card_rel = relationship("Card")


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


class ScheduledExpense(Base):
    __tablename__ = "scheduled_expenses"

    id = Column(Integer, primary_key=True, index=True)
    installment_group_id = Column(String, nullable=False, index=True)
    installment_number = Column(Integer, nullable=False)
    installment_total = Column(Integer, nullable=False)

    scheduled_date = Column(Date, nullable=False, index=True)
    amount = Column(Float, nullable=False)
    currency = Column(String, default="ARS")
    description = Column(String, nullable=False)

    # Legacy fields (compatibilidad)
    card = Column(String, default="")
    bank = Column(String, default="")
    person = Column(String, default="")

    # Nuevos campos estructurados
    card_id = Column(Integer, ForeignKey("cards.id"), nullable=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=True)

    # Estado
    status = Column(String, default="PENDING", index=True)  # PENDING | EXECUTED | CANCELLED

    # Categoría
    category_id = Column(Integer, ForeignKey("categories.id"), nullable=True)

    # Si fue ejecutada
    executed_expense_id = Column(Integer, ForeignKey("expenses.id"), nullable=True)
    executed_at = Column(DateTime, nullable=True)

    # Auditoría
    created_at = Column(DateTime, default=datetime.utcnow)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    group_id = Column(Integer, ForeignKey("groups.id"), nullable=True)
    transaction_id = Column(String, nullable=True, index=True)

    # Relationships
    category = relationship("Category")
    executed_expense = relationship("Expense", foreign_keys=[executed_expense_id])
    card_rel = relationship("Card")
    account_rel = relationship("Account")


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
        ("user_id", "INTEGER REFERENCES users(id)"),
        ("group_id", "INTEGER REFERENCES groups(id)"),
        ("account_id", "INTEGER REFERENCES accounts(id)"),
        ("card_id", "INTEGER REFERENCES cards(id)"),
    ]:
        if _col not in _cols:
            _conn.execute(sa_text(f"ALTER TABLE expenses ADD COLUMN {_col} {_type}"))
    _cat_cols = [c["name"] for c in inspect(engine).get_columns("categories")]
    if "parent_id" not in _cat_cols:
        _conn.execute(sa_text("ALTER TABLE categories ADD COLUMN parent_id INTEGER REFERENCES categories(id)"))
    if "user_id" not in _cat_cols:
        _conn.execute(sa_text("ALTER TABLE categories ADD COLUMN user_id INTEGER REFERENCES users(id)"))
    try:
        _conn.execute(sa_text("DROP INDEX IF EXISTS ix_categories_name"))
    except Exception:
        pass
    _gm_cols = [c["name"] for c in inspect(engine).get_columns("group_members")]
    for _col, _type in [
        ("status", "VARCHAR DEFAULT 'accepted'"),
        ("invited_by", "INTEGER REFERENCES users(id)"),
    ]:
        if _col not in _gm_cols:
            _conn.execute(sa_text(f"ALTER TABLE group_members ADD COLUMN {_col} {_type}"))
    for _tbl, _col, _type in [
        ("analysis_history", "user_id", "INTEGER REFERENCES users(id)"),
        ("investments", "user_id", "INTEGER REFERENCES users(id)"),
        ("card_closings", "user_id", "INTEGER REFERENCES users(id)"),
    ]:
        _tbl_cols = [c["name"] for c in inspect(engine).get_columns(_tbl)]
        if _col not in _tbl_cols:
            _conn.execute(sa_text(f"ALTER TABLE {_tbl} ADD COLUMN {_col} {_type}"))
    _user_cols = [c["name"] for c in inspect(engine).get_columns("users")]
    if "dni" in _user_cols:
        try:
            _conn.execute(sa_text("ALTER TABLE users DROP COLUMN dni"))
        except Exception:
            pass
    for _col, _type in [
        ("telegram_key", "VARCHAR(12)"),
        ("telegram_chat_id", "VARCHAR"),
        ("provider", "VARCHAR"),
        ("provider_id", "VARCHAR"),
        ("avatar_url", "VARCHAR"),
        ("invite_code", "VARCHAR(8)"),
    ]:
        if _col not in _user_cols:
            _conn.execute(sa_text(f"ALTER TABLE users ADD COLUMN {_col} {_type}"))
    _card_cols = [c["name"] for c in inspect(engine).get_columns("cards")]
    if "holder" not in _card_cols:
        _conn.execute(sa_text("ALTER TABLE cards ADD COLUMN holder VARCHAR DEFAULT ''"))

    # Crear tabla scheduled_expenses si no existe
    inspector = inspect(engine)
    if "scheduled_expenses" not in inspector.get_table_names():
        Base.metadata.tables["scheduled_expenses"].create(bind=engine)
        # Crear índices adicionales
        _conn.execute(sa_text(
            "CREATE INDEX IF NOT EXISTS idx_scheduled_status_date ON scheduled_expenses(status, scheduled_date)"
        ))
        _conn.execute(sa_text(
            "CREATE INDEX IF NOT EXISTS idx_scheduled_user_status ON scheduled_expenses(user_id, status)"
        ))

    _conn.commit()
