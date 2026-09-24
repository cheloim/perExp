from pydantic import BaseModel


class TagBase(BaseModel):
    name: str
    color: str = "#6366f1"
    group_name: str = "otros"
    card_id: int | None = None
    account_id: int | None = None
    category_id: int | None = None


class TagCreate(BaseModel):
    name: str
    color: str = "#6366f1"
    group_name: str = "otros"
    card_id: int | None = None
    account_id: int | None = None


class TagUpdate(BaseModel):
    name: str | None = None
    color: str | None = None
    group_name: str | None = None
    card_id: int | None = None
    account_id: int | None = None


class TagResponse(TagBase):
    id: int
    expense_count: int = 0
    model_config = {"from_attributes": True}
