import re
from datetime import date, datetime

import pandas as pd
from pydantic import BaseModel, computed_field, field_serializer, field_validator

from app.schemas.categories import CategoryResponse
from app.schemas.common import AccountSimple, CardSimple
from app.services.date_utils import _normalize_date_str

BUE = __import__("zoneinfo", fromlist=["ZoneInfo"]).ZoneInfo("America/Argentina/Buenos_Aires")


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
            return datetime.now(BUE).date()
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
