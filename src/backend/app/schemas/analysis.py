from datetime import datetime

from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    """One turn of the assistant thread, as the browser stores it."""

    role: str = "user"
    text: str = ""


class AnalysisRequest(BaseModel):
    month: str | None = None
    question: str | None = None
    debug_mode: bool = False
    # The whole thread, so the model knows what has already been said. Optional:
    # an older client asking a single question must keep working. Bounded: the
    # client sends a window already, and this turns a runaway payload into a
    # 422 instead of a slow request.
    messages: list[ChatMessage] | None = Field(default=None, max_length=50)


class AnalysisHistoryResponse(BaseModel):
    id: int
    created_at: datetime
    month: str | None = None
    question: str | None = None
    result_text: str
    expense_count: int
    total_amount: float
    model_config = {"from_attributes": True}
