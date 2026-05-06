import os
from datetime import datetime, date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Investment, Setting, User
from app.schemas import InvestmentCreate
from app.services.auth import get_current_user

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


def _get_setting(db: Session, key: str, user_id: int | None = None) -> str:
    scoped_key = f"{user_id}:{key}" if user_id is not None else key
    row = db.query(Setting).filter(Setting.key == scoped_key).first()
    if row:
        return row.value
    # fallback to global key for backwards compatibility
    row = db.query(Setting).filter(Setting.key == key).first()
    return row.value if row else ""


def _set_setting(db: Session, key: str, value: str, user_id: int | None = None):
    scoped_key = f"{user_id}:{key}" if user_id is not None else key
    row = db.query(Setting).filter(Setting.key == scoped_key).first()
    if row:
        row.value = value
    else:
        db.add(Setting(key=scoped_key, value=value))
    db.commit()


# ─── Settings ────────────────────────────────────────────────────────────────

@router.get("/settings")
def get_settings(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    prefix = f"{current_user.id}:"
    rows = db.query(Setting).filter(Setting.key.like(f"{prefix}%")).all()
    result = {r.key[len(prefix):]: r.value for r in rows}
    result["iol_configured"] = bool(os.getenv("IOL_USERNAME") and os.getenv("IOL_PASSWORD"))
    result["ppi_configured"] = bool(os.getenv("PPI_API_KEY") and os.getenv("PPI_API_SECRET"))
    return result


@router.put("/settings/{key}")
def put_setting(key: str, payload: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    value = payload.get("value", "")
    _set_setting(db, key, value, user_id=current_user.id)

    # Also write sensitive broker credentials to the .env file so they persist
    # across server restarts and are picked up by os.getenv()
    _ENV_KEY_MAP = {
        "iol_username":   "IOL_USERNAME",
        "iol_password":   "IOL_PASSWORD",
        "ppi_api_key":    "PPI_API_KEY",
        "ppi_api_secret": "PPI_API_SECRET",
    }
    env_var = _ENV_KEY_MAP.get(key.lower())
    if env_var and value:
        _write_env_var(env_var, value)
        # Also set in current process so next sync/balance call works immediately
        import os as _os
        _os.environ[env_var] = value

    return {"ok": True}


def _write_env_var(var: str, value: str):
    """Write or update a variable in backend/.env, creating the file if needed."""
    import re as _re
    env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), ".env")
    try:
        try:
            with open(env_path, "r") as f:
                lines = f.readlines()
        except FileNotFoundError:
            lines = []

        pattern = _re.compile(rf"^{_re.escape(var)}\s*=")
        updated = False
        new_lines = []
        for line in lines:
            if pattern.match(line):
                new_lines.append(f"{var}={value}\n")
                updated = True
            else:
                new_lines.append(line)
        if not updated:
            if new_lines and not new_lines[-1].endswith("\n"):
                new_lines.append("\n")
            new_lines.append(f"{var}={value}\n")

        with open(env_path, "w") as f:
            f.writelines(new_lines)
    except Exception:
        pass  # .env write failure is non-fatal


# ─── Investments CRUD ─────────────────────────────────────────────────────────

@router.get("/investments")
def get_investments(broker: Optional[str] = None, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    q = db.query(Investment).filter(Investment.user_id == current_user.id)
    if broker:
        q = q.filter(Investment.broker == broker)
    return [_inv_response(inv) for inv in q.order_by(Investment.broker, Investment.type, Investment.name).all()]


@router.post("/investments", status_code=201)
def create_investment(data: InvestmentCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    inv = Investment(**data.model_dump(), user_id=current_user.id, updated_at=datetime.utcnow())
    db.add(inv)
    db.commit()
    db.refresh(inv)
    return _inv_response(inv)


@router.put("/investments/{inv_id}")
def update_investment(inv_id: int, data: InvestmentCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    inv = db.query(Investment).filter(Investment.id == inv_id, Investment.user_id == current_user.id).first()
    if not inv:
        raise HTTPException(404, "Inversión no encontrada")
    for k, v in data.model_dump().items():
        setattr(inv, k, v)
    inv.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(inv)
    return _inv_response(inv)


@router.patch("/investments/{inv_id}/price")
def update_investment_price(inv_id: int, payload: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    inv = db.query(Investment).filter(Investment.id == inv_id, Investment.user_id == current_user.id).first()
    if not inv:
        raise HTTPException(404, "Inversión no encontrada")
    inv.current_price = payload.get("current_price")
    inv.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(inv)
    return _inv_response(inv)


@router.delete("/investments/{inv_id}")
def delete_investment(inv_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    inv = db.query(Investment).filter(Investment.id == inv_id, Investment.user_id == current_user.id).first()
    if not inv:
        raise HTTPException(404, "Inversión no encontrada")
    db.delete(inv)
    db.commit()
    return {"ok": True}


@router.post("/investments/deduplicate")
def deduplicate_investments(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    all_inv = db.query(Investment).filter(Investment.user_id == current_user.id).order_by(Investment.id).all()
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
def sync_iol(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
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
            Investment.user_id == current_user.id,
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
                user_id=current_user.id,
            ))
            created += 1

    db.commit()
    _set_setting(db, "iol_last_sync", datetime.utcnow().isoformat(), user_id=current_user.id)
    return {"broker": "IOL", "created": created, "updated": updated, "total": len(best)}


@router.post("/investments/sync/ppi")
def sync_ppi(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
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

    _PPI_CURRENCY_MAP = {"Pesos": "ARS", "Dólares": "USD", "Dolares": "USD", "USD": "USD"}

    created = updated = 0
    for group in data.get("groupedInstruments", []):
        group_name = (group.get("name") or "").upper()
        inv_type = _PPI_TYPE_MAP.get(group_name, "Otro")

        for instrument in group.get("instruments", []):
            ticker   = instrument.get("ticker", "")
            name     = instrument.get("description", ticker)
            price    = instrument.get("price")
            quantity = instrument.get("quantity")   # PPI returns actual quantity
            currency_raw = instrument.get("currency", "Pesos")
            if not ticker or not quantity:
                continue

            price_f    = float(price) if price is not None else None
            quantity_f = float(quantity)
            currency   = _PPI_CURRENCY_MAP.get(currency_raw, "ARS")

            existing = db.query(Investment).filter(
                Investment.ticker == ticker,
                Investment.broker == "Portfolio Personal",
                Investment.user_id == current_user.id,
            ).first()
            if existing:
                existing.quantity      = quantity_f
                existing.current_price = price_f if price_f is not None else existing.current_price
                existing.type          = inv_type
                existing.currency      = currency
                existing.name          = name or existing.name
                existing.updated_at    = datetime.utcnow()
                # avg_cost is NOT provided by PPI API — preserve whatever the user set manually
                updated += 1
            else:
                db.add(Investment(
                    ticker=ticker, name=name, type=inv_type,
                    broker="Portfolio Personal",
                    quantity=quantity_f, avg_cost=0,
                    current_price=price_f,
                    currency=currency, notes="", updated_at=datetime.utcnow(),
                    user_id=current_user.id,
                ))
                created += 1

    db.commit()
    _set_setting(db, "ppi_last_sync", datetime.utcnow().isoformat(), user_id=current_user.id)
    return {"broker": "PPI", "created": created, "updated": updated}


# ─── USD Rate (BCRA oficial) ──────────────────────────────────────────────────

@router.get("/investments/usd-rate")
def get_usd_rate():
    """Returns the official USD/ARS rate. Tries BCRA first, falls back to dolarapi.com (BNA)."""
    import requests as _req

    # ── Attempt 1: BCRA ───────────────────────────────────────────────────────
    try:
        today = date.today()
        desde = (today - timedelta(days=7)).strftime("%Y-%m-%d")
        hasta = today.strftime("%Y-%m-%d")
        resp = _req.get(
            f"https://api.bcra.gob.ar/estadisticas/v2.0/datosvariable/4/{desde}/{hasta}",
            timeout=8,
            headers={"Accept": "application/json"},
            verify=False,  # BCRA cert has been unreliable
        )
        if resp.status_code == 200:
            results = resp.json().get("results", [])
            if results:
                latest = results[-1]
                return {"rate": latest["v"], "date": latest["d"], "source": "BCRA"}
    except Exception:
        pass  # fall through to BNA

    # ── Attempt 2: dolarapi.com (fuente BNA) ─────────────────────────────────
    try:
        resp = _req.get("https://dolarapi.com/v1/dolares/oficial", timeout=8)
        resp.raise_for_status()
        data = resp.json()
        rate = data.get("venta") or data.get("compra")
        if rate:
            fecha = (data.get("fechaActualizacion") or "")[:10]
            return {"rate": float(rate), "date": fecha, "source": "BNA (dolarapi.com)"}
    except Exception as e:
        raise HTTPException(502, f"No se pudo obtener el tipo de cambio (BCRA y BNA fallaron): {e}")


# ─── Cash Balances ────────────────────────────────────────────────────────────

@router.get("/investments/cash-balances")
def get_cash_balances():
    """Returns uninvested cash balances from IOL and PPI."""
    balances: dict = {
        "iol": {"ars": None, "usd": None, "configured": False},
        "ppi": {"ars": None, "usd": None, "configured": False},
    }

    # ── IOL ──────────────────────────────────────────────────────────────────
    iol_user = os.getenv("IOL_USERNAME", "")
    iol_pass = os.getenv("IOL_PASSWORD", "")
    if iol_user and iol_pass:
        balances["iol"]["configured"] = True
        try:
            import requests as _req
            auth = _req.post(
                "https://api.invertironline.com/token",
                data={"username": iol_user, "password": iol_pass, "grant_type": "password"},
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                timeout=20,
            )
            auth.raise_for_status()
            token = auth.json().get("access_token", "")
            if token:
                headers = {"Authorization": f"Bearer {token}"}
                r = _req.get(
                    "https://api.invertironline.com/api/v2/estadocuenta",
                    headers=headers, timeout=20,
                )
                if r.status_code == 200:
                    data = r.json()
                    # IOL returns a list of accounts or a single object depending on version
                    cuentas = data if isinstance(data, list) else data.get("cuentas", [data])
                    ars_total = 0.0
                    usd_total = 0.0
                    for cuenta in cuentas:
                        moneda = str(cuenta.get("moneda", cuenta.get("currency", ""))).lower()
                        disponible = float(cuenta.get("disponible", cuenta.get("disponibleOperar", cuenta.get("saldo", 0))) or 0)
                        if "dolar" in moneda or "usd" in moneda or "dollar" in moneda:
                            usd_total += disponible
                        else:
                            ars_total += disponible
                    balances["iol"]["ars"] = ars_total
                    balances["iol"]["usd"] = usd_total
        except Exception as e:
            balances["iol"]["error"] = str(e)

    # ── PPI ──────────────────────────────────────────────────────────────────
    ppi_key = os.getenv("PPI_API_KEY", "")
    ppi_secret = os.getenv("PPI_API_SECRET", "")
    if ppi_key and ppi_secret:
        balances["ppi"]["configured"] = True
        try:
            from ppi_client.ppi import PPI
            import requests as _req
            from requests.exceptions import JSONDecodeError as _JDE
            ppi = PPI(sandbox=False)
            ppi.account.login_api(ppi_key, ppi_secret)
            accounts = ppi.account.get_accounts()
            if accounts:
                account_number = (
                    accounts[0].get("comitente")
                    or accounts[0].get("accountNumber")
                    or accounts[0].get("numeroCuenta")
                    or str(accounts[0].get("id", ""))
                )
                # Use get_available_balance — returns list of {name, symbol, amount, settlement}
                availability = ppi.account.get_available_balance(account_number)
                ars_total = usd_total = 0.0
                for entry in (availability or []):
                    if entry.get("settlement") != "INMEDIATA":
                        continue
                    symbol = (entry.get("symbol") or "").upper()
                    amount = float(entry.get("amount") or 0)
                    if symbol == "ARS":
                        ars_total += amount
                    elif symbol == "USD":
                        usd_total += amount
                balances["ppi"]["ars"] = ars_total
                balances["ppi"]["usd"] = usd_total
        except (_JDE, ValueError) as e:
            balances["ppi"]["error"] = "API de PPI no disponible (intenta de nuevo más tarde)"
        except Exception as e:
            balances["ppi"]["error"] = str(e)

    return balances


@router.post("/investments/refresh-manual-prices")
def refresh_manual_prices_endpoint(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    from app.services.price_refresh import refresh_manual_prices
    updated = refresh_manual_prices(db, user_id=current_user.id)
    return {"updated": updated}


# ─── Manual cash balances ─────────────────────────────────────────────────────

_MANUAL_CASH_KEY = "manual_cash_balances"


@router.get("/investments/manual-cash-balances")
def get_manual_cash_balances(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    import json
    from app.models import Setting
    scoped_key = f"{current_user.id}:{_MANUAL_CASH_KEY}"
    row = db.query(Setting).filter(Setting.key == scoped_key).first()
    if not row or not row.value:
        return {}
    try:
        return json.loads(row.value)
    except Exception:
        return {}


@router.put("/investments/manual-cash-balances/{broker}")
def put_manual_cash_balance(broker: str, body: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    import json
    from app.models import Setting
    scoped_key = f"{current_user.id}:{_MANUAL_CASH_KEY}"
    row = db.query(Setting).filter(Setting.key == scoped_key).first()
    current: dict = {}
    if row and row.value:
        try:
            current = json.loads(row.value)
        except Exception:
            pass
    current[broker] = {"ars": body.get("ars"), "usd": body.get("usd")}
    if row:
        row.value = json.dumps(current)
    else:
        db.add(Setting(key=scoped_key, value=json.dumps(current)))
    db.commit()
    return current[broker]


@router.delete("/investments/manual-cash-balances/{broker}")
def delete_manual_cash_balance(broker: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    import json
    from app.models import Setting
    scoped_key = f"{current_user.id}:{_MANUAL_CASH_KEY}"
    row = db.query(Setting).filter(Setting.key == scoped_key).first()
    if not row or not row.value:
        return {}
    try:
        current = json.loads(row.value)
        current.pop(broker, None)
        row.value = json.dumps(current)
        db.commit()
    except Exception:
        pass
    return {}


# ─── Investments Chat ─────────────────────────────────────────────────────────

INVESTMENTS_SYSTEM_PROMPT = """Sos un asistente financiero especializado exclusivamente en inversiones, tanto del mercado argentino como de la bolsa de Estados Unidos.
Tu único rol es ayudar al usuario a entender su cartera, analizar activos, interpretar rendimientos y tomar mejores decisiones de inversión.
Conocés en profundidad:
- Mercado argentino: BYMA, Merval, bonos soberanos, ONs, FCI, cauciones, tipo de cambio, inflación y macroeconomía local.
- CEDEARs: instrumentos que replican acciones y ETFs del exterior operados en pesos en Argentina — entendés su relación con el CCL, el ratio de conversión y cómo seguir el subyacente en NYSE/NASDAQ.
- Bolsa de EE.UU.: NYSE, NASDAQ, S&P 500, acciones, ETFs, opciones, bonos del Tesoro, REITs, política de la Fed y macroeconomía global.

RESTRICCIONES ESTRICTAS:
- Solo respondés preguntas relacionadas con inversiones, mercados financieros, activos, carteras o economía.
- Si el usuario pregunta sobre cualquier otro tema (gastos, tecnología, recetas, etc.), respondés exactamente: "Solo puedo ayudarte con temas de inversiones y mercados financieros."
- Nunca das asesoramiento financiero formal ni garantizás rendimientos — aclarás cuando corresponde.
- Respondés en español, de forma clara, concisa y profesional."""


@router.post("/investments/chat/stream")
async def investments_chat_stream(body: dict):
    """SSE chat endpoint for the investments assistant. Uses INVESTMENTS_GEMINI_API_KEY if set, else GOOGLE_API_KEY."""
    import json
    from fastapi.responses import StreamingResponse
    from google import genai
    from google.genai import types as genai_types

    question = (body.get("question") or "").strip()
    context = (body.get("context") or "").strip()
    if not question:
        async def _err():
            yield f"data: {json.dumps({'text': 'Pregunta vacía.'})}\n\ndata: [DONE]\n\n"
        return StreamingResponse(_err(), media_type="text/event-stream")

    api_key = os.getenv("INVESTMENTS_GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        async def _no_key():
            yield f"data: {json.dumps({'text': 'INVESTMENTS_GEMINI_API_KEY / GOOGLE_API_KEY no configurada.'})}\n\ndata: [DONE]\n\n"
        return StreamingResponse(_no_key(), media_type="text/event-stream")

    user_message = question
    if context:
        user_message = f"{context}\n\nPREGUNTA: {question}"

    async def generate():
        try:
            client = genai.Client(api_key=api_key)
            async for chunk in await client.aio.models.generate_content_stream(
                model="gemini-flash-latest",
                contents=user_message,
                config=genai_types.GenerateContentConfig(
                    system_instruction=INVESTMENTS_SYSTEM_PROMPT,
                    temperature=0.4,
                ),
            ):
                if chunk.text:
                    yield f"data: {json.dumps({'text': chunk.text})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'text': f'Error: {e}'})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
