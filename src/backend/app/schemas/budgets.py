from datetime import date
from typing import Any, Literal

from pydantic import BaseModel

Currency = Literal["ARS", "USD"]


class BudgetCreate(BaseModel):
    category_id: int
    amount: float
    currency: Currency = "ARS"
    alert_threshold: float = 0.80
    alert_thresholds: list[float] | None = None
    rollover: bool = False


class BudgetUpdate(BaseModel):
    amount: float | None = None
    currency: Currency | None = None
    alert_threshold: float | None = None
    alert_thresholds: list[float] | None = None
    rollover: bool | None = None
    is_active: bool | None = None


class BudgetResponse(BaseModel):
    id: int
    category_id: int
    category_name: str = ""
    category_color: str = ""
    amount: float
    currency: str = "ARS"
    alert_threshold: float
    alert_thresholds: list[float] | None = None
    rollover: bool
    is_active: bool
    model_config = {"from_attributes": True}


class BudgetSummaryItem(BaseModel):
    category_id: int | None = None
    category_name: str
    category_color: str = ""
    budget_group: str = "necesidades"
    currency: str = "ARS"
    budget_amount: float = 0
    spent_amount: float = 0
    avg_monthly: float = 0
    months_with_data: int = 0
    percentage: float = 0
    status: str = "no_budget"  # ok | warning | exceeded | no_budget
    has_budget: bool = False
    children: list["BudgetSummaryItem"] = []


class BudgetSummaryResponse(BaseModel):
    month: str
    currency: str = "ARS"
    fx_rate: float | None = None
    fx_rate_date: str | None = None
    fx_rate_source: str | None = None
    total_budget: float
    total_spent: float
    total_percentage: float
    categories: list[BudgetSummaryItem]
    trend_6m: list["BudgetTrendPoint"] = []


class BudgetTrendPoint(BaseModel):
    month: str
    total: float = 0


class BudgetGroupCreate(BaseModel):
    name: str
    display_name: str
    percentage: float
    amount: float = 0
    currency: Currency = "ARS"


class BudgetGroupUpdate(BaseModel):
    display_name: str | None = None
    percentage: float | None = None
    amount: float | None = None
    currency: Currency | None = None
    alert_thresholds: list[float] | None = None
    is_active: bool | None = None


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
    currency: str = "ARS"
    spent: float = 0
    committed: float = 0
    available: float = 0
    alert_thresholds: list[float] | None = None
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
    is_active: bool | None = None


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
    months_with_data: int = 0
    suggested: float
    has_budget: bool
    current_budget: float = 0
