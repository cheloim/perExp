"""Shared USD/ARS rate resolution.

BNA official is the canonical rate for money aggregates. If BNA is unavailable,
a budget falls back to the last BNA value we saw and never silently switches to
CCL/BCRA: mixing sources changes the number the user is looking at. Investments
may ask for a display rate, which keeps the historical BNA → ADR-implied → BCRA
chain because it is a market snapshot, not an accounting total.

Historical dates and the durable ``fx_rates`` table land with #508b.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta

import requests
from sqlalchemy.orm import Session

from app.models import FxRate
from app.services import cache

logger = logging.getLogger(__name__)

BNA_URL = "https://dolarapi.com/v1/dolares/oficial"
BCRA_URL = "https://api.bcra.gob.ar/estadisticas/v2.0/datosvariable/4/{desde}/{hasta}"
BCBA_ADR_MAP = {
    "GGAL.BA": "GGAL",
    "YPFD.BA": "YPF",
    "BBAR.BA": "BBAR",
    "BMA.BA": "BMA",
    "PAMP.BA": "PAM",
    "CEPU.BA": "CEPU",
    "TGSU2.BA": "TGS",
    "SUPV.BA": "SUPV",
}
USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"

RATE_TTL_SECONDS = 5 * 60
LAST_BNA_TTL_SECONDS = 7 * 24 * 60 * 60
LAST_BNA_KEY = "fx:usd:bna:last"


class FxUnavailableError(RuntimeError):
    """No rate can be resolved without mixing sources silently."""


def _today() -> str:
    return date.today().isoformat()


def _parse_bna(payload: dict) -> dict | None:
    rate = payload.get("venta") or payload.get("compra")
    if not rate:
        return None
    updated = str(payload.get("fechaActualizacion") or "")[:10]
    return {"rate": float(rate), "date": updated or _today(), "source": "BNA"}


def _fetch_bna() -> dict | None:
    try:
        response = requests.get(BNA_URL, timeout=8)
        response.raise_for_status()
        return _parse_bna(response.json())
    except Exception as exc:
        logger.warning("BNA USD rate unavailable: %s", exc)
        return None


def _fetch_adr() -> dict | None:
    headers = {"User-Agent": USER_AGENT}
    for bcba_ticker, adr_ticker in BCBA_ADR_MAP.items():
        try:
            bcba = requests.get(
                f"https://query2.finance.yahoo.com/v8/finance/chart/{bcba_ticker}",
                params={"interval": "1d", "range": "1d"},
                headers=headers,
                timeout=8,
            )
            adr = requests.get(
                f"https://query1.finance.yahoo.com/v8/finance/chart/{adr_ticker}",
                params={"interval": "1d", "range": "1d"},
                headers=headers,
                timeout=8,
            )
            if bcba.status_code != 200 or adr.status_code != 200:
                continue
            bcba_data = bcba.json().get("chart", {}).get("result", [])
            adr_data = adr.json().get("chart", {}).get("result", [])
            if not bcba_data or not adr_data:
                continue
            bcba_price = bcba_data[0]["meta"].get("regularMarketPrice")
            adr_price = adr_data[0]["meta"].get("regularMarketPrice")
            if bcba_price and adr_price and adr_price > 0:
                return {
                    "rate": round(float(bcba_price) / float(adr_price), 2),
                    "date": _today(),
                    "source": "ADR-implied",
                }
        except Exception as exc:
            logger.debug("ADR-implied rate failed for %s/%s: %s", bcba_ticker, adr_ticker, exc)
    return None


def _fetch_bcra() -> dict | None:
    try:
        today = date.today()
        desde = (today - timedelta(days=7)).strftime("%Y-%m-%d")
        hasta = today.strftime("%Y-%m-%d")
        response = requests.get(
            BCRA_URL.format(desde=desde, hasta=hasta),
            timeout=8,
            headers={"Accept": "application/json"},
            verify=False,
        )
        if response.status_code != 200:
            return None
        results = response.json().get("results", [])
        if not results:
            return None
        latest = results[-1]
        return {"rate": float(latest["v"]), "date": str(latest["d"]), "source": "BCRA"}
    except Exception as exc:
        logger.warning("BCRA USD rate unavailable: %s", exc)
        return None


def _rate_key(purpose: str, day: str) -> str:
    return f"fx:usd:rate:{purpose}:{day}"


def _last_bna() -> dict | None:
    value = cache.get_json(LAST_BNA_KEY)
    if isinstance(value, dict) and value.get("rate"):
        return value
    return None


def _with_warning(rate: dict, warning: str) -> dict:
    return {**rate, "warning": warning}


def get_usd_rate(purpose: str = "budget", date_str: str | None = None) -> dict:
    """Resolve the USD/ARS rate.

    ``budget`` uses BNA only (with the last BNA as fallback); ``display`` may
    use ADR-implied or BCRA after BNA. Only today is supported until #508b.
    """
    if purpose not in {"budget", "display"}:
        raise ValueError(f"unknown FX purpose: {purpose}")

    today = _today()
    if date_str and date_str != today:
        raise FxUnavailableError(
            "Las tasas históricas todavía no están disponibles; llegan con #508b"
        )

    key = _rate_key(purpose, today)
    cached = cache.get_json(key)
    if isinstance(cached, dict) and cached.get("rate"):
        return cached

    bna = _fetch_bna()
    if bna:
        cache.set_json(key, bna, RATE_TTL_SECONDS)
        cache.set_json(LAST_BNA_KEY, bna, LAST_BNA_TTL_SECONDS)
        return bna

    last = _last_bna()
    if purpose == "display":
        for fetch in (_fetch_adr, _fetch_bcra):
            fallback = fetch()
            if fallback:
                cache.set_json(key, fallback, RATE_TTL_SECONDS)
                return fallback

    if last:
        warning = f"Usando la última tasa BNA disponible ({last.get('date')})"
        result = _with_warning(last, warning)
        cache.set_json(key, result, 60)
        return result

    if purpose == "budget":
        raise FxUnavailableError("BNA no está disponible y no hay una última tasa persistida")
    raise FxUnavailableError("No se pudo obtener el tipo de cambio (BNA, ADR y BCRA fallaron)")


def save_rate(
    db: Session,
    rate: dict,
    *,
    base: str = "USD",
    quote: str = "ARS",
) -> FxRate:
    """Upsert a rate for its date/source pair. The caller owns the commit."""
    try:
        rate_date = date.fromisoformat(str(rate.get("date")))
    except (TypeError, ValueError):
        rate_date = date.today()
    source = str(rate.get("source") or "BNA")
    row = (
        db.query(FxRate)
        .filter(
            FxRate.date == rate_date,
            FxRate.source == source,
            FxRate.base == base,
            FxRate.quote == quote,
        )
        .first()
    )
    if row is None:
        row = FxRate(
            date=rate_date,
            source=source,
            base=base,
            quote=quote,
            rate=float(rate["rate"]),
        )
        db.add(row)
    else:
        row.rate = float(rate["rate"])
        row.fetched_at = datetime.utcnow()
    db.flush()
    return row


def get_rate_for_date(
    db: Session,
    rate_date: date,
    *,
    source: str = "BNA",
    base: str = "USD",
    quote: str = "ARS",
) -> FxRate | None:
    """Latest rate on or before ``rate_date``. Never uses a future rate."""
    return (
        db.query(FxRate)
        .filter(
            FxRate.date <= rate_date,
            FxRate.source == source,
            FxRate.base == base,
            FxRate.quote == quote,
        )
        .order_by(FxRate.date.desc())
        .first()
    )


def apply_rate_to_expense(db: Session, expense) -> FxRate | None:
    """Snapshot the rate on a non-ARS expense.

    A historical row without a stored rate stays null: using today's rate would
    silently change a past total. #508c treats null as "missing", not as 1:1.
    """
    currency = (expense.currency or "ARS").upper()
    if currency == "ARS" or expense.fx_rate:
        return None

    rate_date = expense.date or date.today()
    row = get_rate_for_date(db, rate_date)
    if row is None and rate_date == date.today():
        try:
            row = save_rate(db, get_usd_rate("budget"))
        except FxUnavailableError as exc:
            logger.warning("USD expense created without an FX rate: %s", exc)
            return None
    if row is None:
        logger.warning("No FX rate for %s on %s", currency, rate_date)
        return None

    expense.fx_rate = row.rate
    expense.fx_rate_date = row.date
    expense.fx_rate_source = row.source
    return row
