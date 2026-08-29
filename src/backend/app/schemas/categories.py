from pydantic import BaseModel


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


class CategorySuggestRequest(BaseModel):
    description: str
    amount: float | None = None
