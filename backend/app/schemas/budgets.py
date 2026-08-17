from datetime import date
from typing import Any

from pydantic import BaseModel


class BudgetCreate(BaseModel):
    category_id: int
    amount: float
    alert_threshold: float = 0.80
    rollover: bool = False


class BudgetUpdate(BaseModel):
    amount: float | None = None
    alert_threshold: float | None = None
    rollover: bool | None = None


class BudgetResponse(BaseModel):
    id: int
    category_id: int
    category_name: str = ""
    category_color: str = ""
    amount: float
    alert_threshold: float
    rollover: bool
    is_active: bool
    model_config = {"from_attributes": True}


class BudgetSummaryItem(BaseModel):
    category_id: int | None = None
    category_name: str
    category_color: str = ""
    budget_group: str = "necesidades"
    budget_amount: float = 0
    spent_amount: float = 0
    avg_monthly: float = 0
    percentage: float = 0
    status: str = "no_budget"  # ok | warning | exceeded | no_budget
    has_budget: bool = False
    children: list["BudgetSummaryItem"] = []


class BudgetSummaryResponse(BaseModel):
    month: str
    total_budget: float
    total_spent: float
    total_percentage: float
    categories: list[BudgetSummaryItem]


class BudgetGroupCreate(BaseModel):
    name: str
    display_name: str
    percentage: float
    amount: float = 0


class BudgetGroupUpdate(BaseModel):
    display_name: str | None = None
    percentage: float | None = None
    amount: float | None = None


class BudgetGroupCategory(BaseModel):
    category_id: int
    category_name: str
    category_color: str = ""
    budgeted: float = 0
    spent: float = 0


class BudgetGroupResponse(BaseModel):
    id: int
    name: str
    display_name: str
    percentage: float
    amount: float
    spent: float = 0
    committed: float = 0
    available: float = 0
    categories: list[BudgetGroupCategory] = []
    is_active: bool
    model_config = {"from_attributes": True}


class BudgetEventCreate(BaseModel):
    name: str
    start_date: date
    end_date: date
    total_amount: float
    categories: list[dict[str, Any]] = []


class BudgetEventUpdate(BaseModel):
    name: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    total_amount: float | None = None
    categories: list[dict[str, Any]] | None = None


class BudgetEventResponse(BaseModel):
    id: int
    name: str
    start_date: date
    end_date: date
    total_amount: float
    spent: float
    categories: list[dict[str, Any]] = []
    is_active: bool
    model_config = {"from_attributes": True}


class BudgetSuggestion(BaseModel):
    category_id: int
    category_name: str
    category_color: str = ""
    avg_monthly: float
    suggested: float
    has_budget: bool
    current_budget: float = 0
