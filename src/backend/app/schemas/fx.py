from pydantic import BaseModel


class FxRateResponse(BaseModel):
    rate: float
    date: str
    source: str
    warning: str | None = None
