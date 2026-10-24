from datetime import datetime

from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    """One turn of the assistant thread, as the browser stores it."""

    role: str = "user"
    text: str = ""


class AnalysisRequest(BaseModel):
    month: str | None = None
    # A window instead of a month: the current month plus `months - 1` previous
    # ones. `month` wins when both arrive — it names a precise period and is the
    # field older clients already send. The default is a twelve-month window:
    # long enough for trend and comparison questions, and bounded enough that a
    # request that names no period still cannot ask for the whole history.
    months: int | None = Field(default=12, ge=1, le=24)
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
