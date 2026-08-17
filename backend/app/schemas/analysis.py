from datetime import datetime

from pydantic import BaseModel


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
