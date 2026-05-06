"""
Lightweight price-only refresh for IOL and PPI.
Only updates current_price + updated_at on existing investments.
Does NOT touch quantities or create new rows.
"""
import logging
import os
from datetime import datetime

from sqlalchemy.orm import Session

from app.models import Investment

logger = logging.getLogger(__name__)

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


def refresh_iol_prices(db: Session) -> int:
    import requests as _req

    username = os.getenv("IOL_USERNAME", "")
    password = os.getenv("IOL_PASSWORD", "")
    if not username or not password:
        return 0

    try:
        auth = _req.post(
            "https://api.invertironline.com/token",
            data={"username": username, "password": password, "grant_type": "password"},
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=20,
        )
        auth.raise_for_status()
        token = auth.json().get("access_token")
        if not token:
            return 0
    except Exception as e:
        logger.warning(f"IOL auth failed during price refresh: {e}")
        return 0

    headers = {"Authorization": f"Bearer {token}"}
    updated = 0

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
                ticker = titulo.get("simbolo", "")
                if not ticker:
                    continue
                cantidad = float(activo.get("cantidad") or 0)
                valorizado = float(activo.get("valorizado") or 0)
                if valorizado > 0 and cantidad > 0:
                    price = valorizado / cantidad
                else:
                    raw = activo.get("ultimoPrecio")
                    price = float(raw) if raw is not None else None
                if price is None:
                    continue

                inv = db.query(Investment).filter(
                    Investment.ticker == ticker,
                    Investment.broker == "InvertirOnline",
                ).first()
                if inv:
                    inv.current_price = price
                    inv.updated_at = datetime.utcnow()
                    updated += 1
        except Exception as e:
            logger.warning(f"IOL price refresh error ({mercado}): {e}")

    db.commit()
    return updated


def refresh_ppi_prices(db: Session) -> int:
    api_key = os.getenv("PPI_API_KEY", "")
    api_secret = os.getenv("PPI_API_SECRET", "")
    if not api_key or not api_secret:
        return 0

    try:
        from ppi_client.ppi import PPI
        ppi = PPI(sandbox=False)
        ppi.account.login_api(api_key, api_secret)
        accounts = ppi.account.get_accounts()
        if not accounts:
            return 0
        account_number = (
            accounts[0].get("comitente")
            or accounts[0].get("accountNumber")
            or accounts[0].get("numeroCuenta")
            or str(accounts[0].get("id", ""))
        )
        data = ppi.account.get_balance_and_positions(account_number)
    except Exception as e:
        logger.warning(f"PPI price refresh error: {e}")
        return 0

    updated = 0
    for group in data.get("groupedInstruments", []):
        for instrument in group.get("instruments", []):
            ticker = instrument.get("ticker", "")
            price = instrument.get("price")
            if not ticker or price is None:
                continue
            inv = db.query(Investment).filter(
                Investment.ticker == ticker,
                Investment.broker == "Portfolio Personal",
            ).first()
            if inv:
                inv.current_price = float(price)
                inv.updated_at = datetime.utcnow()
                updated += 1

    db.commit()
    return updated


def refresh_manual_prices(db: Session) -> int:
    """Refresh current_price for investments NOT synced from IOL/PPI portfolios.
    Tries IOL individual quote endpoint first, falls back to PPI market data.
    """
    import requests as _req

    MANAGED_BROKERS = ("InvertirOnline", "Portfolio Personal")
    manual_invs = db.query(Investment).filter(
        Investment.broker.notin_(MANAGED_BROKERS)
    ).all()
    if not manual_invs:
        return 0

    tickers = list({inv.ticker for inv in manual_invs if inv.ticker})

    # ── IOL individual quote ───────────────────────────────────────────────────
    iol_prices: dict[str, float] = {}
    username = os.getenv("IOL_USERNAME", "")
    password = os.getenv("IOL_PASSWORD", "")
    if username and password:
        try:
            auth = _req.post(
                "https://api.invertironline.com/token",
                data={"username": username, "password": password, "grant_type": "password"},
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                timeout=20,
            )
            auth.raise_for_status()
            token = auth.json().get("access_token")
            if token:
                hdrs = {"Authorization": f"Bearer {token}"}
                for ticker in tickers:
                    for mercado in ("bCBA", "nYSE"):
                        try:
                            resp = _req.get(
                                f"https://api.invertironline.com/api/v2/{mercado}/Titulos/{ticker}/CotizacionDetalle",
                                headers=hdrs, timeout=10,
                            )
                            if resp.status_code == 200:
                                data = resp.json()
                                price = data.get("ultimoPrecio") or data.get("ultimo")
                                if price is not None:
                                    iol_prices[ticker] = float(price)
                                    break
                        except Exception:
                            pass
        except Exception as e:
            logger.warning(f"IOL auth failed for manual price refresh: {e}")

    # ── PPI market data fallback ───────────────────────────────────────────────
    ppi_prices: dict[str, float] = {}
    api_key = os.getenv("PPI_API_KEY", "")
    api_secret = os.getenv("PPI_API_SECRET", "")
    remaining = [t for t in tickers if t not in iol_prices]
    if remaining and api_key and api_secret:
        try:
            from ppi_client.ppi import PPI
            ppi = PPI(sandbox=False)
            ppi.account.login_api(api_key, api_secret)
            for ticker in remaining:
                try:
                    data = ppi.marketdata.get(ticker, "acciones", "A-48HS")
                    if data and data.get("price") is not None:
                        ppi_prices[ticker] = float(data["price"])
                except Exception:
                    pass
        except Exception as e:
            logger.warning(f"PPI auth failed for manual price refresh: {e}")

    # ── Update rows ────────────────────────────────────────────────────────────
    updated = 0
    combined = {**ppi_prices, **iol_prices}  # IOL wins if both have it
    for inv in manual_invs:
        price = combined.get(inv.ticker)
        if price is not None:
            inv.current_price = price
            inv.updated_at = datetime.utcnow()
            updated += 1

    db.commit()
    return updated
