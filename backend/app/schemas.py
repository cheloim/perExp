import re
from datetime import date, datetime
from typing import Optional, List, Any

import pandas as pd
from pydantic import BaseModel, computed_field, field_validator, field_serializer

from app.services.date_utils import _normalize_date_str


class LoginRequest(BaseModel):
    email: str
    password: str


class UserCreate(BaseModel):
    full_name: str
    email: str
    password: str


class UserResponse(BaseModel):
    id: int
    full_name: str
    email: str
    is_active: bool
    created_at: datetime
    provider: Optional[str] = None
    avatar_url: Optional[str] = None
    invite_code: Optional[str] = None
    model_config = {"from_attributes": True}


class OAuthRequest(BaseModel):
    id_token: Optional[str] = None
    code: Optional[str] = None
    provider: str


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class InvestmentCreate(BaseModel):
    ticker: str = ""
    name: str = ""
    type: str = ""
    broker: str = ""
    quantity: float = 0.0
    avg_cost: float = 0.0
    current_price: Optional[float] = None
    currency: str = "ARS"
    notes: str = ""


class CategoryBase(BaseModel):
    name: str
    color: str = "#6366f1"
    keywords: str = ""
    parent_id: Optional[int] = None


class CategoryCreate(CategoryBase):
    pass


class CategoryResponse(CategoryBase):
    id: int
    model_config = {"from_attributes": True}


class AccountSimple(BaseModel):
    id: int
    name: str
    type: str
    model_config = {"from_attributes": True}


class CardSimple(BaseModel):
    id: int
    name: str
    bank: str
    last4_digits: Optional[str] = None
    card_type: str
    model_config = {"from_attributes": True}


class ExpenseCreate(BaseModel):
    date: date
    description: str
    amount: float
    category_id: Optional[int] = None
    # Legacy fields (deprecated)
    card: str = ""
    bank: str = ""
    person: str = ""
    notes: str = ""
    transaction_id: Optional[str] = None
    currency: str = "ARS"
    installment_number: Optional[int] = None
    installment_total: Optional[int] = None
    installment_group_id: Optional[str] = None
    card_last4: Optional[str] = None
    # New structured fields
    account_id: Optional[int] = None
    card_id: Optional[int] = None

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
    date: Optional[str] = None
    description: Optional[str] = None
    amount: Optional[float] = None
    category_id: Optional[int] = None
    # Legacy fields
    card: Optional[str] = None
    bank: Optional[str] = None
    person: Optional[str] = None
    notes: Optional[str] = None
    transaction_id: Optional[str] = None
    currency: Optional[str] = None
    installment_number: Optional[int] = None
    installment_total: Optional[int] = None
    installment_group_id: Optional[str] = None
    card_last4: Optional[str] = None
    # New structured fields
    account_id: Optional[int] = None
    card_id: Optional[int] = None


class ExpenseResponse(BaseModel):
    id: int
    date: date
    description: str
    amount: float
    category_id: Optional[int] = None
    # Legacy fields
    card: str = ""
    bank: str = ""
    person: str = ""
    notes: str = ""
    transaction_id: Optional[str] = None
    currency: str = "ARS"
    installment_number: Optional[int] = None
    installment_total: Optional[int] = None
    installment_group_id: Optional[str] = None
    card_last4: str = ""
    # Relations
    category: Optional[CategoryResponse] = None
    account_id: Optional[int] = None
    card_id: Optional[int] = None
    account_rel: Optional[AccountSimple] = None
    card_rel: Optional[CardSimple] = None
    model_config = {"from_attributes": True}

    @field_validator("card", "bank", "person", "notes", "currency", "card_last4", mode="before")
    @classmethod
    def coerce_none(cls, v: object) -> str:
        return v if v is not None else ""

    @field_serializer("date")
    def serialize_date(self, d: date) -> str:
        return f"{d.day:02d}-{d.month:02d}-{d.year}"

    @computed_field  # type: ignore[misc]
    @property
    def category_name(self) -> Optional[str]:
        return self.category.name if self.category else None

    @computed_field  # type: ignore[misc]
    @property
    def category_color(self) -> Optional[str]:
        return self.category.color if self.category else None


class AnalysisRequest(BaseModel):
    month: Optional[str] = None
    question: Optional[str] = None


class AnalysisHistoryResponse(BaseModel):
    id: int
    created_at: datetime
    month: Optional[str] = None
    question: Optional[str] = None
    result_text: str
    expense_count: int
    total_amount: float
    model_config = {"from_attributes": True}


class RowsConfirmBody(BaseModel):
    rows: List[Any]


class CardClosingResponse(BaseModel):
    id: int
    card: str
    card_last_digits: str = ""
    card_type: str = ""
    bank: str
    closing_date: date
    next_closing_date: Optional[date] = None
    due_date: Optional[date] = None
    model_config = {"from_attributes": True}
