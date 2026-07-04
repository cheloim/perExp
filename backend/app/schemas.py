import re
from datetime import date, datetime
from typing import Any

import pandas as pd
from pydantic import BaseModel, computed_field, field_serializer, field_validator

from app.services.date_utils import _normalize_date_str


class LoginRequest(BaseModel):
    email: str
    password: str


class UserCreate(BaseModel):
    full_name: str
    email: str
    password: str

    @field_validator("password")
    @classmethod
    def validate_password(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("La contraseña debe tener al menos 8 caracteres")
        if not any(c.isupper() for c in v):
            raise ValueError("La contraseña debe contener al menos una mayúscula")
        if not any(c.islower() for c in v):
            raise ValueError("La contraseña debe contener al menos una minúscula")
        if not any(c.isdigit() for c in v):
            raise ValueError("La contraseña debe contener al menos un número")
        return v


class UserResponse(BaseModel):
    id: int
    full_name: str
    email: str
    is_active: bool
    created_at: datetime
    provider: str | None = None
    avatar_url: str | None = None
    invite_code: str | None = None
    model_config = {"from_attributes": True}


class OAuthRequest(BaseModel):
    id_token: str | None = None
    code: str | None = None
    provider: str


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def validate_new_password(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("La contraseña debe tener al menos 8 caracteres")
        if not any(c.isupper() for c in v):
            raise ValueError("La contraseña debe contener al menos una mayúscula")
        if not any(c.islower() for c in v):
            raise ValueError("La contraseña debe contener al menos una minúscula")
        if not any(c.isdigit() for c in v):
            raise ValueError("La contraseña debe contener al menos un número")
        return v


class ForgotPasswordRequest(BaseModel):
    email: str


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def validate_new_password(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("La contraseña debe tener al menos 8 caracteres")
        if not any(c.isupper() for c in v):
            raise ValueError("La contraseña debe contener al menos una mayúscula")
        if not any(c.islower() for c in v):
            raise ValueError("La contraseña debe contener al menos una minúscula")
        if not any(c.isdigit() for c in v):
            raise ValueError("La contraseña debe contener al menos un número")
        return v


class InvestmentCreate(BaseModel):
    ticker: str = ""
    name: str = ""
    type: str = ""
    broker: str = ""
    quantity: float = 0.0
    avg_cost: float = 0.0
    current_price: float | None = None
    currency: str = "ARS"
    notes: str = ""


class CategoryBase(BaseModel):
    name: str
    color: str = "#6366f1"
    keywords: str = ""
    parent_id: int | None = None


class CategoryCreate(CategoryBase):
    pass


class CategoryResponse(CategoryBase):
    id: int
    model_config = {"from_attributes": True}


class BudgetCreate(BaseModel):
    category_id: int
    amount: float
    alert_threshold: float = 0.80


class BudgetUpdate(BaseModel):
    amount: float | None = None
    alert_threshold: float | None = None
    is_active: bool | None = None


class BudgetResponse(BaseModel):
    id: int
    category_id: int
    category_name: str = ""
    category_color: str = ""
    amount: float
    alert_threshold: float
    is_active: bool
    model_config = {"from_attributes": True}


class BudgetSummaryItem(BaseModel):
    category_id: int
    category_name: str
    category_color: str
    budget_amount: float
    spent_amount: float
    percentage: float
    status: str  # ok | warning | exceeded
    children: list["BudgetSummaryItem"] = []


class BudgetSummaryResponse(BaseModel):
    month: str
    total_budget: float
    total_spent: float
    total_percentage: float
    categories: list[BudgetSummaryItem]


class AccountSimple(BaseModel):
    id: int
    name: str
    type: str
    model_config = {"from_attributes": True}


class CardSimple(BaseModel):
    id: int
    card_name: str
    bank: str
    holder: str = ""
    card_type: str
    model_config = {"from_attributes": True}


class ExpenseCreate(BaseModel):
    date: date
    description: str
    amount: float
    category_id: int | None = None
    notes: str = ""
    transaction_id: str | None = None
    currency: str = "ARS"
    installment_number: int | None = None
    installment_total: int | None = None
    installment_group_id: str | None = None
    account_id: int | None = None
    card_id: int | None = None
    is_income: bool | None = None  # Set by backend based on category

    @field_validator("date", mode="before")
    @classmethod
    def parse_date(cls, v: object) -> date:
        if isinstance(v, date):
            return v
        s = str(v).strip()
        if not s:
            return date.today()
        normalized = _normalize_date_str(s)
        if re.match(r"^\d{4}-\d{2}-\d{2}$", normalized):
            return date.fromisoformat(normalized)
        return pd.to_datetime(normalized, dayfirst=True).date()


class ExpenseUpdate(BaseModel):
    date: str | None = None
    description: str | None = None
    amount: float | None = None
    category_id: int | None = None
    notes: str | None = None
    transaction_id: str | None = None
    currency: str | None = None
    installment_number: int | None = None
    installment_total: int | None = None
    installment_group_id: str | None = None
    account_id: int | None = None
    card_id: int | None = None
    is_income: bool | None = None


class ExpenseResponse(BaseModel):
    id: int
    date: date
    description: str
    amount: float
    category_id: int | None = None
    notes: str = ""
    transaction_id: str | None = None
    currency: str = "ARS"
    installment_number: int | None = None
    installment_total: int | None = None
    installment_group_id: str | None = None
    # Relations
    category: CategoryResponse | None = None
    account_id: int | None = None
    card_id: int | None = None
    is_income: bool = False
    account_rel: AccountSimple | None = None
    card_rel: CardSimple | None = None
    model_config = {"from_attributes": True}

    @field_validator("notes", "currency", mode="before")
    @classmethod
    def coerce_none(cls, v: object) -> str:
        return v if v is not None else ""

    @field_serializer("date")
    def serialize_date(self, d: date) -> str:
        return f"{d.day:02d}-{d.month:02d}-{d.year}"

    @computed_field  # type: ignore[misc]
    @property
    def category_name(self) -> str | None:
        return self.category.name if self.category else None

    @computed_field  # type: ignore[misc]
    @property
    def category_color(self) -> str | None:
        return self.category.color if self.category else None

    @computed_field  # type: ignore[misc]
    @property
    def card(self) -> str:
        return self.card_rel.card_name if self.card_rel else ""

    @computed_field  # type: ignore[misc]
    @property
    def bank(self) -> str:
        return self.card_rel.bank if self.card_rel else ""

    @computed_field  # type: ignore[misc]
    @property
    def person(self) -> str:
        return self.card_rel.holder if self.card_rel else ""


class AnalysisRequest(BaseModel):
    month: str | None = None
    question: str | None = None
    debug_mode: bool = False


class AnalysisHistoryResponse(BaseModel):
    id: int
    created_at: datetime
    month: str | None = None
    question: str | None = None
    result_text: str
    expense_count: int
    total_amount: float
    model_config = {"from_attributes": True}


class CardsMappingEntry(BaseModel):
    bank: str | None = None
    card_name: str | None = None


class RowsConfirmBody(BaseModel):
    rows: list[Any]
    cards_mapping: dict[str, dict[str, Any]] | None = (
        None  # key: "bank|card|holder" -> value: { bank?, card_name? }
    )


class CardClosingResponse(BaseModel):
    id: int
    card: str
    card_type: str = ""
    bank: str
    closing_date: date
    next_closing_date: date | None = None
    due_date: date | None = None
    model_config = {"from_attributes": True}


class ImportJobResponse(BaseModel):
    id: int
    filename: str
    status: str
    created_at: datetime
    completed_at: datetime | None = None
    error_message: str | None = None
    preview_data: dict | None = None
    model_config = {"from_attributes": True}
