from datetime import date, datetime
from typing import Any

from pydantic import BaseModel


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
