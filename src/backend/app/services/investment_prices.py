"""Yahoo Finance quotes and price history for the investments feature.

Every network failure is non-fatal: callers get ``None`` or an empty list and
keep the last known price. The FX cache lives in ``app.services.fx``; quotes
are not cached because they feed a manual refresh action.
"""

from __future__ import annotations

from datetime import datetime

from app.models import Investment


def fetch_yahoo_quote(symbol: str, currency: str = "ARS") -> dict | None:
    """Fetch quote from Yahoo Finance for a given symbol."""
    import requests as _req

    yf_headers = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"}
    # Only append .BA for Argentine-listed stocks (ARS currency or already has suffix)
    if "." in symbol:
        yf_symbol = symbol
    elif currency == "USD":
        yf_symbol = symbol  # US-listed stock, no suffix
    else:
        yf_symbol = f"{symbol}.BA"
    url = f"https://query2.finance.yahoo.com/v8/finance/chart/{yf_symbol}"
    try:
        resp = _req.get(
            url, params={"interval": "1d", "range": "1d"}, headers=yf_headers, timeout=10
        )
        if resp.status_code != 200:
            return None
        result = resp.json().get("chart", {}).get("result", [])
        if not result:
            return None
        meta = result[0].get("meta", {})
        return {
            "symbol": symbol.upper(),
            "name": meta.get("shortName", ""),
            "price": meta.get("regularMarketPrice"),
            "currency": meta.get("currency", "USD"),
        }
    except Exception:
        return None


def lookup_symbol(symbol: str) -> dict | None:
    """Look up a single symbol, returning ``None`` for an empty input."""
    if not symbol or len(symbol.strip()) < 1:
        return None
    symbol = symbol.strip().upper()
    return fetch_yahoo_quote(symbol)


def lookup_symbols(symbols: str) -> dict:
    """Look up comma-separated symbols as ``{symbol: quote}``."""
    if not symbols or len(symbols.strip()) < 1:
        return {}
    result = {}
    for symbol in symbols.split(","):
        symbol = symbol.strip().upper()
        if symbol:
            quote = fetch_yahoo_quote(symbol)
            result[symbol] = (
                quote if quote else {"symbol": symbol, "name": "", "price": None, "currency": "USD"}
            )
    return result


def get_yahoo_ticker(inv: Investment) -> str | None:
    """Map an internal ticker to its Yahoo Finance symbol."""
    if not inv.ticker:
        return None
    ticker = inv.ticker.strip().upper()
    currency = inv.currency or "ARS"
    if currency == "USD":
        return ticker
    if "." not in ticker:
        return f"{ticker}.BA"
    return ticker


def fetch_yahoo_history(ticker: str, range_str: str, interval: str) -> list[dict]:
    """Fetch historical closes from Yahoo Finance."""
    import requests as _req

    yf_headers = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"}
    url = f"https://query2.finance.yahoo.com/v8/finance/chart/{ticker}"
    params = {"interval": interval, "range": range_str}
    try:
        resp = _req.get(url, params=params, headers=yf_headers, timeout=10)
        if resp.status_code != 200:
            return []
        result = resp.json().get("chart", {}).get("result", [])
        if not result:
            return []
        quotes = result[0].get("indicators", {}).get("quote", [{}])
        timestamps = result[0].get("timestamp", [])
        closes = quotes[0].get("close", []) if quotes else []
        if not timestamps or not closes:
            return []
        formatted = []
        for ts, close in zip(timestamps, closes, strict=False):
            if close is None:
                continue
            dt = datetime.fromtimestamp(ts)
            formatted.append(
                {
                    "date": dt.strftime("%Y-%m-%d"),
                    "close": round(float(close), 2),
                }
            )
        return formatted
    except Exception:
        return []
