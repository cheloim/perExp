"""Investment and Setting models."""

from datetime import datetime

from sqlalchemy import Column, DateTime, Float, ForeignKey, Index, Integer, String, Text

from app.database import Base
from app.types.encrypted import EncryptedType


class Setting(Base):
    __tablename__ = "settings"
    key = Column(String, primary_key=True)
    value = Column(Text, default="")


class Investment(Base):
    __tablename__ = "investments"
    __table_args__ = (
        Index("ix_investments_user_id", "user_id"),
        Index("ix_investments_user_ticker_broker", "user_id", "ticker", "broker"),
    )
    id = Column(Integer, primary_key=True, index=True)
    ticker = Column(String, default="")
    name = Column(String, default="")
    type = Column(String, default="")
    broker = Column(String, default="")
    quantity = Column(Float, default=0.0)
    avg_cost = Column(Float, default=0.0)
    current_price = Column(Float, nullable=True)
    currency = Column(String, default="ARS")
    notes = Column(EncryptedType, default="")
    updated_at = Column(DateTime, default=datetime.utcnow)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
