from pydantic import BaseModel


class InvestmentCreate(BaseModel):
    ticker: str = ""
    name: str = ""
    type: str = ""
    broker: str = ""
    quantity: float = 0.0
    avg_cost: float = 0.0
    current_price: float | None = None
    currency: str = "ARS"
    notes: str = ""
