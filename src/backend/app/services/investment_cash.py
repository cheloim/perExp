"""Cash balances for the investments feature.

Two sources coexist: broker-reported available cash (read-only, best effort)
and manually tracked balances stored as JSON in the user's settings.
"""

from __future__ import annotations

import contextlib
import json

from sqlalchemy.orm import Session

from app.models import Setting
from app.services.investment_brokers import fetch_iol_cash, fetch_ppi_cash
from app.services.investment_settings import get_user_creds

MANUAL_CASH_KEY = "manual_cash_balances"


def get_cash_balances(db: Session, user_id: int) -> dict:
    """Return uninvested cash balances from configured IOL and PPI accounts."""
    creds = get_user_creds(db, user_id)
    balances: dict = {
        "iol": {"ars": None, "usd": None, "configured": False},
        "ppi": {"ars": None, "usd": None, "configured": False},
    }

    # ── IOL ──────────────────────────────────────────────────────────────────
    iol_user = creds["iol_username"]
    iol_pass = creds["iol_password"]
    if iol_user and iol_pass:
        balances["iol"]["configured"] = True
        try:
            cash = fetch_iol_cash(iol_user, iol_pass)
            if cash is not None:
                balances["iol"]["ars"] = cash["ars"]
                balances["iol"]["usd"] = cash["usd"]
        except Exception as e:
            balances["iol"]["error"] = str(e)

    # ── PPI ──────────────────────────────────────────────────────────────────
    ppi_key = creds["ppi_api_key"]
    ppi_secret = creds["ppi_api_secret"]
    if ppi_key and ppi_secret:
        balances["ppi"]["configured"] = True
        try:
            from requests.exceptions import JSONDecodeError as _JDE

            cash = fetch_ppi_cash(ppi_key, ppi_secret)
            if cash is not None:
                balances["ppi"]["ars"] = cash["ars"]
                balances["ppi"]["usd"] = cash["usd"]
        except (_JDE, ValueError):
            balances["ppi"]["error"] = "API de PPI no disponible (intenta de nuevo más tarde)"
        except Exception:
            balances["ppi"]["error"] = "Error al obtener saldos de PPI (intenta de nuevo más tarde)"

    return balances


def _manual_cash_row(db: Session, user_id: int):
    scoped_key = f"{user_id}:{MANUAL_CASH_KEY}"
    return db.query(Setting).filter(Setting.key == scoped_key).first(), scoped_key


def get_manual_cash_balances(db: Session, user_id: int) -> dict:
    """Return the manually stored per-broker balances, or ``{}``."""
    row, _ = _manual_cash_row(db, user_id)
    if not row or not row.value:
        return {}
    try:
        return json.loads(row.value)
    except Exception:
        return {}


def put_manual_cash_balance(db: Session, user_id: int, broker: str, body: dict) -> dict:
    """Create or update a manually tracked broker balance."""
    row, scoped_key = _manual_cash_row(db, user_id)
    current: dict = {}
    if row and row.value:
        with contextlib.suppress(Exception):
            current = json.loads(row.value)
    current[broker] = {"ars": body.get("ars"), "usd": body.get("usd")}
    if row:
        row.value = json.dumps(current)
    else:
        db.add(Setting(key=scoped_key, value=json.dumps(current)))
    db.commit()
    return current[broker]


def delete_manual_cash_balance(db: Session, user_id: int, broker: str) -> dict:
    """Remove a manually tracked broker balance. Always returns ``{}``."""
    row, _ = _manual_cash_row(db, user_id)
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
