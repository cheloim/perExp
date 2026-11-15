"""Persisted USD/ARS rates used to convert expenses without changing totals."""

from datetime import datetime

from sqlalchemy import Column, Date, DateTime, Float, Integer, String, UniqueConstraint

from app.database import Base


class FxRate(Base):
    __tablename__ = "fx_rates"
    __table_args__ = (
        UniqueConstraint(
            "date",
            "source",
            "base",
            "quote",
            name="uq_fx_rates_date_source_pair",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    date = Column(Date, nullable=False, index=True)
    source = Column(String(20), nullable=False, default="BNA")
    base = Column(String(3), nullable=False, default="USD")
    quote = Column(String(3), nullable=False, default="ARS")
    rate = Column(Float, nullable=False)
    fetched_at = Column(DateTime, default=datetime.utcnow, nullable=False)
