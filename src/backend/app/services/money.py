"""Single money notation for every user-facing surface.

Pesos keep the local "$" and dollars use "U$S", so a message or table that
mixes both can never be read as if every amount were in the same currency.
The number body always uses Argentine separators: thousands with "." and
decimals with ",".

Keep this in sync with the frontend formatter in
``src/frontend/src/utils/money.ts``.
"""

from __future__ import annotations

from collections.abc import Iterable

NumberRow = tuple[float, str | None]


def _normalize_currency(currency: str | None) -> str:
    return (currency or "ARS").upper()


def _prefix(currency: str) -> str:
    return "U$S" if currency == "USD" else "$"


def _number(amount: float) -> str:
    # 30000.5 -> "30,000.50" -> "30.000,50"
    formatted = f"{abs(float(amount)):,.2f}"
    return formatted.replace(",", "\x00").replace(".", ",").replace("\x00", ".")


def format_money(amount: float, currency: str | None = None) -> str:
    """Format one amount as ``$ 30.000,00`` or ``U$S 7,00``."""
    currency_code = _normalize_currency(currency)
    sign = "-" if amount < 0 else ""
    return f"{sign}{_prefix(currency_code)} {_number(amount)}"


def format_totals(items: Iterable[NumberRow]) -> str:
    """Format a total without ever adding different currencies together.

    Example: ``"$ 30.000,00 + U$S 7,00"``.
    """
    totals: dict[str, float] = {}
    for amount, currency in items:
        code = _normalize_currency(currency)
        totals[code] = totals.get(code, 0.0) + float(amount)

    if not totals:
        return format_money(0, "ARS")

    codes = sorted(totals, key=lambda code: (code != "ARS", code))
    return " + ".join(format_money(totals[code], code) for code in codes)
