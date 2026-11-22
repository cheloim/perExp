"""Investment portfolio use cases: CRUD, deduplication and price history.

The router stays HTTP-only; tenant scoping and persistence live here.
"""

from __future__ import annotations

from datetime import datetime

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import Investment, User
from app.schemas import InvestmentCreate
from app.services.access import scoped_user_ids_for
from app.services.investment_prices import (
    fetch_yahoo_history,
    fetch_yahoo_quote,
    get_yahoo_ticker,
)
from app.services.investment_settings import delete_settings_for_broker

HISTORY_INTERVALS = {"1d": "5m", "7d": "15m", "30d": "1h"}


def investment_response(inv: Investment, user_name: str | None = None) -> dict:
    """Serialize an investment with derived totals for the API."""
    cost_basis = (inv.quantity or 0) * (inv.avg_cost or 0)
    current_value = (
        (inv.quantity or 0) * inv.current_price if inv.current_price is not None else None
    )
    pnl = (current_value - cost_basis) if current_value is not None else None
    pnl_pct = (pnl / cost_basis * 100) if (pnl is not None and cost_basis != 0) else None
    return {
        "id": inv.id,
        "ticker": inv.ticker or "",
        "name": inv.name or "",
        "type": inv.type or "",
        "broker": inv.broker or "",
        "quantity": inv.quantity or 0.0,
        "avg_cost": inv.avg_cost or 0.0,
        "current_price": inv.current_price,
        "currency": inv.currency or "ARS",
        "notes": inv.notes or "",
        "updated_at": inv.updated_at.isoformat() if inv.updated_at else None,
        "cost_basis": cost_basis,
        "current_value": current_value,
        "pnl": pnl,
        "pnl_pct": pnl_pct,
        "user_name": user_name,
    }


def _find_investment(db: Session, uid_list: list[int], inv_id: int) -> Investment:
    inv = (
        db.query(Investment)
        .filter(Investment.id == inv_id, Investment.user_id.in_(uid_list))
        .first()
    )
    if not inv:
        raise HTTPException(404, "Inversión no encontrada")
    return inv


def list_investments(db: Session, current_user_id: int, broker: str | None = None) -> list[dict]:
    """List the family group's investments, optionally filtered by broker."""
    uid_list = scoped_user_ids_for(current_user_id, db)
    # Build user_id -> full_name mapping for family group
    users = db.query(User).filter(User.id.in_(uid_list)).all()
    user_names = {u.id: u.full_name or u.email for u in users}
    q = db.query(Investment).filter(Investment.user_id.in_(uid_list))
    if broker:
        q = q.filter(Investment.broker == broker)
    return [
        investment_response(inv, user_names.get(inv.user_id))
        for inv in q.order_by(Investment.broker, Investment.type, Investment.name).all()
    ]


def create_or_add_investment(db: Session, current_user_id: int, data: InvestmentCreate) -> dict:
    """Create an investment or add to the existing ticker+broker position."""
    # Buscar precio de Yahoo Finance automáticamente
    yf_quote = fetch_yahoo_quote(data.ticker, data.currency or "ARS") if data.ticker else None

    # Buscar si ya existe ticker+broker para este usuario
    existing = (
        db.query(Investment)
        .filter(
            Investment.ticker == data.ticker,
            Investment.broker == data.broker,
            Investment.user_id == current_user_id,
        )
        .first()
    )

    if existing:
        # Sumar quantities y promediar avg_cost
        new_qty = existing.quantity + data.quantity
        if new_qty > 0 and data.avg_cost > 0:
            existing.avg_cost = (
                existing.quantity * existing.avg_cost + data.quantity * data.avg_cost
            ) / new_qty
        existing.quantity = new_qty
        # Usar precio de Yahoo Finance si está disponible
        if yf_quote and yf_quote.get("price"):
            existing.current_price = yf_quote["price"]
        existing.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(existing)
        return investment_response(existing)

    inv = Investment(**data.model_dump(), user_id=current_user_id, updated_at=datetime.utcnow())
    # Sobrescribir current_price con el de Yahoo si está disponible
    if yf_quote and yf_quote.get("price"):
        inv.current_price = yf_quote["price"]
    db.add(inv)
    db.commit()
    db.refresh(inv)
    return investment_response(inv)


def update_investment(
    db: Session, current_user_id: int, inv_id: int, data: InvestmentCreate
) -> dict:
    """Replace every editable field and refresh the market price."""
    uid_list = scoped_user_ids_for(current_user_id, db)
    inv = _find_investment(db, uid_list, inv_id)
    for k, v in data.model_dump().items():
        setattr(inv, k, v)
    # Obtener precio actualizado de Yahoo Finance
    yf_quote = fetch_yahoo_quote(data.ticker, data.currency or "ARS") if data.ticker else None
    if yf_quote and yf_quote.get("price"):
        inv.current_price = yf_quote["price"]
    inv.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(inv)
    return investment_response(inv)


def update_investment_price(
    db: Session, current_user_id: int, inv_id: int, current_price: float | None
) -> dict:
    """Manually set only the current price."""
    uid_list = scoped_user_ids_for(current_user_id, db)
    inv = _find_investment(db, uid_list, inv_id)
    inv.current_price = current_price
    inv.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(inv)
    return investment_response(inv)


def delete_investment(db: Session, current_user_id: int, inv_id: int) -> None:
    """Delete an investment owned by the user's scope."""
    uid_list = scoped_user_ids_for(current_user_id, db)
    inv = _find_investment(db, uid_list, inv_id)
    db.delete(inv)
    db.commit()


def deduplicate_investments(db: Session, current_user_id: int) -> dict:
    """Remove duplicate ticker+broker rows, keeping the one with the best data."""
    all_inv = (
        db.query(Investment)
        .filter(Investment.user_id == current_user_id)
        .order_by(Investment.id)
        .all()
    )
    seen: dict[tuple, int] = {}
    to_delete: list[int] = []

    for inv in all_inv:
        key = (inv.ticker, inv.broker)
        if key not in seen:
            seen[key] = inv.id
        else:
            kept = db.query(Investment).filter(Investment.id == seen[key]).first()
            curr_score = (inv.avg_cost > 0, inv.quantity)
            kept_score = (kept.avg_cost > 0, kept.quantity)
            if curr_score > kept_score:
                to_delete.append(seen[key])
                seen[key] = inv.id
            else:
                to_delete.append(inv.id)

    if to_delete:
        db.query(Investment).filter(Investment.id.in_(to_delete)).delete(synchronize_session=False)
        db.commit()

    return {"removed": len(to_delete)}


def delete_broker_data(db: Session, current_user_id: int, broker: str) -> dict:
    """Delete a broker's credentials and every investment synced from it."""
    deleted_settings = delete_settings_for_broker(db, current_user_id, broker)

    # Also delete all investments for this broker
    deleted_investments = (
        db.query(Investment)
        .filter(
            Investment.user_id == current_user_id,
            Investment.broker == broker,
        )
        .delete()
    )

    db.commit()
    return {
        "ok": True,
        "deleted_settings": deleted_settings,
        "deleted_investments": deleted_investments,
    }


def get_investment_history(
    db: Session, current_user_id: int, inv_id: int, range_str: str = "7d"
) -> dict:
    """Return the investment's current price and Yahoo Finance history."""
    inv = _find_investment(db, scoped_user_ids_for(current_user_id, db), inv_id)

    ticker = get_yahoo_ticker(inv)
    interval = HISTORY_INTERVALS.get(range_str, "15m")
    history = fetch_yahoo_history(ticker, range_str, interval) if ticker else []

    return {
        "ticker": inv.ticker or "",
        "currency": inv.currency or "ARS",
        "current_price": inv.current_price,
        "history": history,
    }
