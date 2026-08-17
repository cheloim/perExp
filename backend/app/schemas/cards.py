from datetime import datetime

from pydantic import BaseModel


class CardCreate(BaseModel):
    card_name: str
    bank: str = ""
    holder: str = ""
    card_type: str = "credito"  # credito, debito
    linked_account_id: int | None = None


class CardUpdate(BaseModel):
    card_name: str | None = None
    bank: str | None = None
    holder: str | None = None
    card_type: str | None = None
    linked_account_id: int | None = None


class CardResponse(BaseModel):
    id: int
    card_name: str
    bank: str
    holder: str
    card_type: str
    linked_account_id: int | None = None
    linked_account_name: str | None = None
    user_id: int
    created_at: datetime

    class Config:
        from_attributes = True
