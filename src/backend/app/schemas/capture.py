"""Public schemas for transient voice and receipt capture."""

from datetime import date
from typing import Literal

from pydantic import BaseModel


class TranscriptionResponse(BaseModel):
    text: str
    duration_seconds: float | None
    unclear: bool


class ExpenseDraftResponse(BaseModel):
    amount: float
    currency: str
    description: str
    date: date | None
    confidence: str
    source_type: str
    card_hint: str | None


class ExpenseImageResponse(BaseModel):
    status: Literal["ok", "rejected"]
    draft: ExpenseDraftResponse | None
    reason: str | None
    message: str
