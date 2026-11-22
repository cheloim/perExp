"""Broker synchronization use cases for the investments feature.

A sync owns its transaction: it upserts positions, removes stale rows when the
broker returned a complete snapshot, commits once, then records the last-sync
timestamp. Manual rows and manual ``avg_cost`` are never overwritten.
"""

from __future__ import annotations

from datetime import datetime

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import Investment
from app.services.investment_brokers import (
    PPI_CURRENCY_MAP,
    PPI_TYPE_MAP,
    fetch_iol_portfolio,
    fetch_ppi_positions,
)
from app.services.investment_settings import get_user_creds, set_setting

IOL_BROKER = "InvertirOnline"
PPI_BROKER = "Portfolio Personal"


def sync_iol(db: Session, user_id: int) -> dict:
    """Fetch and persist the IOL portfolio for one user."""
    creds = get_user_creds(db, user_id)
    username = creds["iol_username"]
    password = creds["iol_password"]
    if not username or not password:
        raise HTTPException(
            400, "Credenciales de InvertirOnline no configuradas. Ingresalas en Ajustes."
        )

    raw, successful_markets = fetch_iol_portfolio(username, password)

    best: dict[str, dict] = {}
    for holding in raw:
        ticker = holding["ticker"]
        if not ticker:
            continue
        prev = best.get(ticker)
        if prev is None:
            best[ticker] = holding
        else:
            prev_score = (prev["avg_cost"] > 0, prev["quantity"])
            curr_score = (holding["avg_cost"] > 0, holding["quantity"])
            if curr_score > prev_score:
                best[ticker] = holding

    created = updated = 0
    for holding in best.values():
        all_existing = (
            db.query(Investment)
            .filter(
                Investment.ticker == holding["ticker"],
                Investment.broker == IOL_BROKER,
                Investment.user_id == user_id,
            )
            .all()
        )

        if all_existing:
            keeper = all_existing[0]
            for dup in all_existing[1:]:
                db.delete(dup)
            keeper.quantity = holding["quantity"]
            keeper.avg_cost = holding["avg_cost"]
            keeper.current_price = holding["current_price"]
            keeper.type = holding["type"]
            keeper.currency = holding["currency"]
            keeper.updated_at = datetime.utcnow()
            updated += 1
        else:
            db.add(
                Investment(
                    ticker=holding["ticker"],
                    name=holding["name"],
                    type=holding["type"],
                    broker=IOL_BROKER,
                    quantity=holding["quantity"],
                    avg_cost=holding["avg_cost"],
                    current_price=holding["current_price"],
                    currency=holding["currency"],
                    notes="",
                    updated_at=datetime.utcnow(),
                    user_id=user_id,
                )
            )
            created += 1

    removed = 0
    if len(successful_markets) == 3:
        fetched_tickers = set(best.keys())
        stale = (
            db.query(Investment)
            .filter(
                Investment.broker == IOL_BROKER,
                Investment.user_id == user_id,
                ~Investment.ticker.in_(fetched_tickers) if fetched_tickers else True,
            )
            .all()
        )
        for inv in stale:
            db.delete(inv)
            removed += 1

    db.commit()
    set_setting(db, "iol_last_sync", datetime.utcnow().isoformat(), user_id=user_id)
    return {
        "broker": "IOL",
        "created": created,
        "updated": updated,
        "removed": removed,
        "total": len(best),
    }


def sync_ppi(db: Session, user_id: int) -> dict:
    """Fetch and persist the PPI portfolio for one user."""
    creds = get_user_creds(db, user_id)
    api_key = creds["ppi_api_key"]
    api_secret = creds["ppi_api_secret"]
    if not api_key or not api_secret:
        raise HTTPException(
            400, "Credenciales de Portfolio Personal no configuradas. Ingresalas en Ajustes."
        )

    data = fetch_ppi_positions(api_key, api_secret)

    created = updated = 0
    fetched_tickers: set[str] = set()
    for group in data.get("groupedInstruments", []):
        group_name = (group.get("name") or "").upper()
        inv_type = PPI_TYPE_MAP.get(group_name, "Otro")

        for instrument in group.get("instruments", []):
            ticker = instrument.get("ticker", "")
            name = instrument.get("description", ticker)
            price = instrument.get("price")
            quantity = instrument.get("quantity")  # PPI returns actual quantity
            currency_raw = instrument.get("currency", "Pesos")
            if not ticker or not quantity:
                continue

            fetched_tickers.add(ticker)
            price_f = float(price) if price is not None else None
            quantity_f = float(quantity)
            currency = PPI_CURRENCY_MAP.get(currency_raw, "ARS")

            existing = (
                db.query(Investment)
                .filter(
                    Investment.ticker == ticker,
                    Investment.broker == PPI_BROKER,
                    Investment.user_id == user_id,
                )
                .first()
            )
            if existing:
                existing.quantity = quantity_f
                existing.current_price = price_f if price_f is not None else existing.current_price
                existing.type = inv_type
                existing.currency = currency
                existing.name = name or existing.name
                existing.updated_at = datetime.utcnow()
                # avg_cost is NOT provided by PPI API — preserve whatever the user set manually
                # Don't overwrite avg_cost with current_price — it masks real P&L
                updated += 1
            else:
                # Don't fake avg_cost — let it be 0 so user can set it manually
                db.add(
                    Investment(
                        ticker=ticker,
                        name=name,
                        type=inv_type,
                        broker=PPI_BROKER,
                        quantity=quantity_f,
                        avg_cost=0,
                        current_price=price_f,
                        currency=currency,
                        notes="",
                        updated_at=datetime.utcnow(),
                        user_id=user_id,
                    )
                )
                created += 1

    removed = 0
    stale = (
        db.query(Investment)
        .filter(
            Investment.broker == PPI_BROKER,
            Investment.user_id == user_id,
            ~Investment.ticker.in_(fetched_tickers) if fetched_tickers else True,
        )
        .all()
    )
    for inv in stale:
        db.delete(inv)
        removed += 1

    db.commit()
    set_setting(db, "ppi_last_sync", datetime.utcnow().isoformat(), user_id=user_id)
    return {"broker": "PPI", "created": created, "updated": updated, "removed": removed}
