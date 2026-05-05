import os
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Investment, Setting
from app.schemas import InvestmentCreate

router = APIRouter(tags=["investments"])

_IOL_TYPE_MAP = {
    "ACCIONES":                 "Acción",
    "CEDEARS":                  "Cedear",
    "BONOS":                    "Bono",
    "LETRAS":                   "Letra",
    "OBLIGACIONES_NEGOCIABLES": "ON",
    "FONDOS_COMUNES_INVERSION": "FCI",
    "CAUCIONES":                "Caución",
    "OPCIONES":                 "Otro",
    "FUTUROS":                  "Otro",
}

_IOL_CURRENCY_MAP = {
    "pesos_argentinos":        "ARS",
    "dolares_estadounidenses": "USD",
    "dolares_cable":           "USD",
}

_PPI_TYPE_MAP = {
    "ACCIONES":     "Acción",
    "CEDEARS":      "Cedear",
    "BONOS":        "Bono",
    "LETRAS":       "Letra",
    "ON":           "ON",
    "FCI":          "FCI",
    "CAUCIONES":    "Caución",
    "ETF":          "Cedear",
    "ACCIONES-USA": "Cedear",
    "FCI-EXTERIOR": "FCI",
    "NOBAC":        "Bono",
    "LEBAC":        "Letra",
    "OPCIONES":     "Otro",
    "FUTUROS":      "Otro",
}


def _inv_response(inv: Investment) -> dict:
    cost_basis = (inv.quantity or 0) * (inv.avg_cost or 0)
    current_value = (inv.quantity or 0) * inv.current_price if inv.current_price is not None else None
    pnl = (current_value - cost_basis) if current_value is not None else None
    pnl_pct = (pnl / cost_basis * 100) if (pnl is not None and cost_basis != 0) else None
    return {
        "id":            inv.id,
        "ticker":        inv.ticker or "",
        "name":          inv.name or "",
        "type":          inv.type or "",
        "broker":        inv.broker or "",
        "quantity":      inv.quantity or 0.0,
        "avg_cost":      inv.avg_cost or 0.0,
        "current_price": inv.current_price,
        "currency":      inv.currency or "ARS",
        "notes":         inv.notes or "",
        "updated_at":    inv.updated_at.isoformat() if inv.updated_at else None,
        "cost_basis":    cost_basis,
        "current_value": current_value,
        "pnl":           pnl,
        "pnl_pct":       pnl_pct,
    }


def _get_setting(db: Session, key: str) -> str:
    row = db.query(Setting).filter(Setting.key == key).first()
    return row.value if row else ""


def _set_setting(db: Session, key: str, value: str):
    row = db.query(Setting).filter(Setting.key == key).first()
    if row:
        row.value = value
    else:
        db.add(Setting(key=key, value=value))
    db.commit()


# ─── Settings ────────────────────────────────────────────────────────────────

@router.get("/settings")
def get_settings(db: Session = Depends(get_db)):
    rows = db.query(Setting).all()
    result = {r.key: r.value for r in rows}
    result["iol_configured"] = bool(os.getenv("IOL_USERNAME") and os.getenv("IOL_PASSWORD"))
    result["ppi_configured"] = bool(os.getenv("PPI_API_KEY") and os.getenv("PPI_API_SECRET"))
    return result


@router.put("/settings/{key}")
def put_setting(key: str, payload: dict, db: Session = Depends(get_db)):
    _set_setting(db, key, payload.get("value", ""))
    return {"ok": True}


# ─── Investments CRUD ─────────────────────────────────────────────────────────

@router.get("/investments")
def get_investments(broker: Optional[str] = None, db: Session = Depends(get_db)):
    q = db.query(Investment)
    if broker:
        q = q.filter(Investment.broker == broker)
    return [_inv_response(inv) for inv in q.order_by(Investment.broker, Investment.type, Investment.name).all()]


@router.post("/investments", status_code=201)
def create_investment(data: InvestmentCreate, db: Session = Depends(get_db)):
    inv = Investment(**data.model_dump(), updated_at=datetime.utcnow())
    db.add(inv)
    db.commit()
    db.refresh(inv)
    return _inv_response(inv)


@router.put("/investments/{inv_id}")
def update_investment(inv_id: int, data: InvestmentCreate, db: Session = Depends(get_db)):
    inv = db.query(Investment).filter(Investment.id == inv_id).first()
    if not inv:
        raise HTTPException(404, "Inversión no encontrada")
    for k, v in data.model_dump().items():
        setattr(inv, k, v)
    inv.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(inv)
    return _inv_response(inv)


@router.patch("/investments/{inv_id}/price")
def update_investment_price(inv_id: int, payload: dict, db: Session = Depends(get_db)):
    inv = db.query(Investment).filter(Investment.id == inv_id).first()
    if not inv:
        raise HTTPException(404, "Inversión no encontrada")
    inv.current_price = payload.get("current_price")
    inv.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(inv)
    return _inv_response(inv)


@router.delete("/investments/{inv_id}")
def delete_investment(inv_id: int, db: Session = Depends(get_db)):
    inv = db.query(Investment).filter(Investment.id == inv_id).first()
    if not inv:
        raise HTTPException(404, "Inversión no encontrada")
    db.delete(inv)
    db.commit()
    return {"ok": True}


@router.post("/investments/deduplicate")
def deduplicate_investments(db: Session = Depends(get_db)):
    all_inv = db.query(Investment).order_by(Investment.id).all()
    seen: dict[tuple, int] = {}
    to_delete: list[int] = []

    for inv in all_inv:
        key = (inv.ticker, inv.broker)
        if key not in seen:
            seen[key] = inv.id
        else:
            kept = db.query(Investment).filter(Investment.id == seen[key]).first()
            curr_score = (inv.avg_cost > 0, inv.quantity)
            kept_score = (kept.avg_cost > 0, kept.quantity)  # type: ignore[union-attr]
            if curr_score > kept_score:
                to_delete.append(seen[key])
                seen[key] = inv.id
            else:
                to_delete.append(inv.id)

    if to_delete:
        db.query(Investment).filter(Investment.id.in_(to_delete)).delete(synchronize_session=False)
        db.commit()

    return {"removed": len(to_delete)}


# ─── Broker Sync ─────────────────────────────────────────────────────────────

@router.post("/investments/sync/iol")
def sync_iol(db: Session = Depends(get_db)):
    import requests as _req

    username = os.getenv("IOL_USERNAME", "")
    password = os.getenv("IOL_PASSWORD", "")
    if not username or not password:
        raise HTTPException(400, "IOL_USERNAME / IOL_PASSWORD no configurados en .env")

    try:
        auth = _req.post(
            "https://api.invertironline.com/token",
            data={"username": username, "password": password, "grant_type": "password"},
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=20,
        )
        auth.raise_for_status()
    except Exception as e:
        raise HTTPException(502, f"Error autenticando con IOL: {e}")

    token = auth.json().get("access_token")
    if not token:
        raise HTTPException(502, "IOL no devolvió access_token")

    headers = {"Authorization": f"Bearer {token}"}

    raw: list[dict] = []
    for mercado in ("bCBA", "nYSE", "cFondos"):
        try:
            resp = _req.get(
                f"https://api.invertironline.com/api/v2/portafolio/{mercado}",
                headers=headers, timeout=20,
            )
            if resp.status_code != 200:
                continue
            for activo in resp.json().get("activos", []):
                titulo = activo.get("titulo", {})
                tipo_raw = titulo.get("tipo", "")
                moneda_raw = titulo.get("moneda", "")
                cantidad = float(activo.get("cantidad") or 0)
                valorizado = float(activo.get("valorizado") or 0)
                ganancia = activo.get("gananciaDinero")
                ppc = float(activo.get("ppc") or 0)

                if valorizado > 0 and cantidad > 0:
                    effective_price = valorizado / cantidad
                else:
                    raw_price = activo.get("ultimoPrecio")
                    effective_price = float(raw_price) if raw_price is not None else None

                if ganancia is not None and valorizado > 0 and cantidad > 0:
                    cost_basis = valorizado - float(ganancia)
                    effective_avg_cost = cost_basis / cantidad
                else:
                    effective_avg_cost = ppc

                raw.append({
                    "ticker":        titulo.get("simbolo", ""),
                    "name":          titulo.get("descripcion", ""),
                    "type":          _IOL_TYPE_MAP.get(tipo_raw, "Otro"),
                    "currency":      _IOL_CURRENCY_MAP.get(moneda_raw, "ARS"),
                    "quantity":      cantidad,
                    "avg_cost":      effective_avg_cost,
                    "current_price": effective_price,
                })
        except Exception:
            continue

    best: dict[str, dict] = {}
    for h in raw:
        t = h["ticker"]
        if not t:
            continue
        prev = best.get(t)
        if prev is None:
            best[t] = h
        else:
            prev_score = (prev["avg_cost"] > 0, prev["quantity"])
            curr_score = (h["avg_cost"] > 0, h["quantity"])
            if curr_score > prev_score:
                best[t] = h

    created = updated = 0
    for h in best.values():
        all_existing = db.query(Investment).filter(
            Investment.ticker == h["ticker"],
            Investment.broker == "InvertirOnline",
        ).all()

        if all_existing:
            keeper = all_existing[0]
            for dup in all_existing[1:]:
                db.delete(dup)
            keeper.quantity = h["quantity"]
            keeper.avg_cost = h["avg_cost"]
            keeper.current_price = h["current_price"]
            keeper.type = h["type"]
            keeper.currency = h["currency"]
            keeper.updated_at = datetime.utcnow()
            updated += 1
        else:
            db.add(Investment(
                ticker=h["ticker"], name=h["name"], type=h["type"],
                broker="InvertirOnline", quantity=h["quantity"],
                avg_cost=h["avg_cost"], current_price=h["current_price"],
                currency=h["currency"], notes="", updated_at=datetime.utcnow(),
            ))
            created += 1

    db.commit()
    _set_setting(db, "iol_last_sync", datetime.utcnow().isoformat())
    return {"broker": "IOL", "created": created, "updated": updated, "total": len(best)}


@router.post("/investments/sync/ppi")
def sync_ppi(db: Session = Depends(get_db)):
    from ppi_client.ppi import PPI

    api_key = os.getenv("PPI_API_KEY", "")
    api_secret = os.getenv("PPI_API_SECRET", "")
    if not api_key or not api_secret:
        raise HTTPException(400, "PPI_API_KEY / PPI_API_SECRET no configurados en .env")

    try:
        ppi = PPI(sandbox=False)
        ppi.account.login_api(api_key, api_secret)

        accounts = ppi.account.get_accounts()
        if not accounts:
            raise HTTPException(502, "PPI no devolvió ninguna cuenta")
        account_number = (
            accounts[0].get("comitente")
            or accounts[0].get("accountNumber")
            or accounts[0].get("numeroCuenta")
            or str(accounts[0].get("id", ""))
        )
        if not account_number:
            raise HTTPException(502, f"No se pudo leer el número de cuenta de PPI: {accounts[0]}")

        data = ppi.account.get_balance_and_positions(account_number)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Error conectando con PPI: {e}")

    created = updated = 0
    for group in data.get("groupedInstruments", []):
        group_name = (group.get("name") or "").upper()
        inv_type = _PPI_TYPE_MAP.get(group_name, "Otro")

        for instrument in group.get("instruments", []):
            ticker = instrument.get("ticker", "")
            price = instrument.get("price")
            amount = instrument.get("amount", 0)
            if not ticker:
                continue

            existing = db.query(Investment).filter(
                Investment.ticker == ticker,
                Investment.broker == "Portfolio Personal",
            ).first()
            if existing:
                existing.quantity = float(amount or 0)
                existing.current_price = float(price) if price else existing.current_price
                existing.type = inv_type
                existing.updated_at = datetime.utcnow()
                updated += 1
            else:
                db.add(Investment(
                    ticker=ticker, name=ticker, type=inv_type,
                    broker="Portfolio Personal",
                    quantity=float(amount or 0), avg_cost=0,
                    current_price=float(price) if price else None,
                    currency="ARS", notes="", updated_at=datetime.utcnow(),
                ))
                created += 1

    db.commit()
    _set_setting(db, "ppi_last_sync", datetime.utcnow().isoformat())
    return {"broker": "PPI", "created": created, "updated": updated}
