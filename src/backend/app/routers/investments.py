"""HTTP layer for the investments feature.

Broker adapters, Yahoo quotes, settings/encryption and portfolio use cases live
in ``app.services.investment_*``; this module only binds them to routes.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User
from app.schemas import InvestmentCreate
from app.services import fx as fx_service
from app.services import (
    investment_cash,
    investment_chat,
    investment_portfolio,
    investment_prices,
    investment_settings,
    investment_sync,
)
from app.services.auth import get_current_user
from app.services.price_refresh import refresh_manual_prices

router = APIRouter(tags=["investments"])


# ─── Settings ────────────────────────────────────────────────────────────────


@router.get(
    "/settings",
    summary="Get user investment settings",
    description="Retrieve all investment-related settings for the current user or a family group member, including broker credentials configuration status.",
)
def get_settings(
    user_id: int | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Allow family group members to view other member's settings
    target_user_id = investment_settings.resolve_target_user_id(
        db, current_user.id, user_id, deny_message=investment_settings.DENY_SETTINGS_VIEW
    )
    return investment_settings.load_user_settings(db, target_user_id)


@router.put(
    "/settings/{key}",
    summary="Update a setting",
    description="Create or update a single investment setting by key for the current user or a family group member.",
)
def put_setting(
    key: str,
    payload: dict,
    user_id: int | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Allow family group members to update other member's settings
    target_user_id = investment_settings.resolve_target_user_id(
        db, current_user.id, user_id, deny_message=investment_settings.DENY_SETTINGS_WRITE
    )

    value = payload.get("value", "")
    investment_settings.set_setting(db, key, value, user_id=target_user_id)
    return {"ok": True}


@router.delete(
    "/settings/{key}",
    summary="Delete a setting",
    description="Delete a single investment setting by key for the current user or a family group member.",
)
def delete_setting(
    key: str,
    user_id: int | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a single setting by key."""
    target_user_id = investment_settings.resolve_target_user_id(
        db, current_user.id, user_id, deny_message=investment_settings.DENY_SETTINGS_WRITE
    )
    return {"ok": True, "deleted": investment_settings.delete_setting(db, target_user_id, key)}


@router.delete(
    "/settings/broker/{broker}",
    summary="Delete all broker settings and investments",
    description="Remove all settings and investment records for a given broker (iol or ppi) for the current user.",
)
def delete_broker_settings(
    broker: str,
    user_id: int | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete all settings for a broker (iol or ppi)."""
    target_user_id = investment_settings.resolve_target_user_id(
        db, current_user.id, user_id, deny_message=investment_settings.DENY_SETTINGS_WRITE
    )
    return investment_portfolio.delete_broker_data(db, target_user_id, broker)


# ─── Investments CRUD ─────────────────────────────────────────────────────────


@router.get(
    "/investments",
    summary="List investments",
    description="Retrieve all investments for the user's family group, optionally filtered by broker.",
)
def get_investments(
    broker: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return investment_portfolio.list_investments(db, current_user.id, broker)


@router.post(
    "/investments",
    status_code=201,
    summary="Create or add to an investment",
    description="Create a new investment or increase quantity of an existing one with the same ticker and broker. Fetches current price from Yahoo Finance.",
)
def create_investment(
    data: InvestmentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return investment_portfolio.create_or_add_investment(db, current_user.id, data)


@router.put(
    "/investments/{inv_id}",
    summary="Update an investment",
    description="Update all fields of an existing investment. Refreshes the current price from Yahoo Finance.",
)
def update_investment(
    inv_id: int,
    data: InvestmentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return investment_portfolio.update_investment(db, current_user.id, inv_id, data)


@router.patch(
    "/investments/{inv_id}/price",
    summary="Update investment price",
    description="Manually update only the current price of an investment.",
)
def update_investment_price(
    inv_id: int,
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return investment_portfolio.update_investment_price(
        db, current_user.id, inv_id, payload.get("current_price")
    )


@router.delete(
    "/investments/{inv_id}",
    summary="Delete an investment",
    description="Permanently delete an investment record by ID.",
)
def delete_investment(
    inv_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    investment_portfolio.delete_investment(db, current_user.id, inv_id)
    return {"ok": True}


@router.post(
    "/investments/deduplicate",
    summary="Deduplicate investments",
    description="Remove duplicate investment entries with the same ticker and broker, keeping the one with the best data.",
)
def deduplicate_investments(
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    return investment_portfolio.deduplicate_investments(db, current_user.id)


# ─── Broker Sync ─────────────────────────────────────────────────────────────


@router.post(
    "/investments/sync/iol",
    summary="Sync investments from IOL",
    description="Fetch and synchronize investment portfolio from InvertirOnline (IOL) broker into the local database.",
)
def sync_iol(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return investment_sync.sync_iol(db, current_user.id)


@router.post(
    "/investments/sync/ppi",
    summary="Sync investments from PPI",
    description="Fetch and synchronize investment portfolio from Portfolio Personal Inversiones (PPI) broker into the local database.",
)
def sync_ppi(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return investment_sync.sync_ppi(db, current_user.id)


# ─── USD Rate ─────────────────────────────────────────────────────────────────


@router.get(
    "/investments/usd-rate",
    summary="Get USD/ARS exchange rate",
    description="Deprecated alias of GET /fx/usd-rate?purpose=display.",
)
def get_usd_rate_alias(current_user: User = Depends(get_current_user)):
    try:
        return fx_service.get_usd_rate(purpose="display")
    except fx_service.FxUnavailableError as exc:
        raise HTTPException(502, str(exc))


# ─── Cash Balances ────────────────────────────────────────────────────────────


@router.get(
    "/investments/cash-balances",
    summary="Get broker cash balances",
    description="Retrieve uninvested cash balances (ARS and USD) from configured IOL and PPI broker accounts.",
)
def get_cash_balances(
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    """Returns uninvested cash balances from IOL and PPI."""
    return investment_cash.get_cash_balances(db, current_user.id)


@router.post(
    "/investments/refresh-manual-prices",
    summary="Refresh manual investment prices",
    description="Trigger a background refresh of current prices for investments that were entered manually.",
)
def refresh_manual_prices_endpoint(
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    updated = refresh_manual_prices(db, user_id=current_user.id)
    return {"updated": updated}


# ─── Manual cash balances ─────────────────────────────────────────────────────


@router.get(
    "/investments/manual-cash-balances",
    summary="Get manual cash balances",
    description="Retrieve manually entered cash balances per broker stored in settings.",
)
def get_manual_cash_balances(
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    return investment_cash.get_manual_cash_balances(db, current_user.id)


@router.put(
    "/investments/manual-cash-balances/{broker}",
    summary="Update manual cash balance",
    description="Create or update a manually tracked cash balance (ARS/USD) for a specific broker.",
)
def put_manual_cash_balance(
    broker: str,
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return investment_cash.put_manual_cash_balance(db, current_user.id, broker, body)


@router.delete(
    "/investments/manual-cash-balances/{broker}",
    summary="Delete manual cash balance",
    description="Remove the manually tracked cash balance for a specific broker.",
)
def delete_manual_cash_balance(
    broker: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    return investment_cash.delete_manual_cash_balance(db, current_user.id, broker)


# ─── Investments Chat ─────────────────────────────────────────────────────────
# The system prompt lives in app.prompts, beside ANALYSIS_SYSTEM_PROMPT, so both
# assistants' prompts can be reviewed and tested in one place.


@router.post(
    "/investments/chat/stream",
    summary="Investments chat assistant",
    description="SSE streaming chat endpoint for the investments assistant. Answers questions about portfolios, markets, and financial analysis.",
)
async def investments_chat_stream(
    body: dict,
    current_user: User = Depends(get_current_user),
):
    """SSE chat endpoint for the investments assistant. Uses INVESTMENTS_LLM_API_KEY if set, else LLM_API_KEY."""
    return investment_chat.investments_chat_response(body)


# ─── Symbol Lookup ─────────────────────────────────────────────────────────────


@router.get(
    "/investments/lookup",
    summary="Lookup a stock symbol",
    description="Search Yahoo Finance for a single stock symbol and return its name and current price.",
)
def lookup_symbol(
    symbol: str,
    current_user: User = Depends(get_current_user),
):
    """
    Busca un símbolo en Yahoo Finance y retorna nombre y precio actual.
    """
    return investment_prices.lookup_symbol(symbol)


@router.get(
    "/investments/lookup-batch",
    summary="Lookup multiple stock symbols",
    description="Search Yahoo Finance for multiple comma-separated symbols and return their names and prices.",
)
def lookup_symbols(
    symbols: str,
    current_user: User = Depends(get_current_user),
):
    """
    Busca múltiples símbolos en Yahoo Finance y retorna un dict {symbol: {name, price, currency}}.
    """
    return investment_prices.lookup_symbols(symbols)


# ─── Investment History ─────────────────────────────────────────────────────────


@router.get(
    "/investments/{inv_id}/history",
    summary="Get investment price history",
    description="Retrieve historical price data for an investment from Yahoo Finance with configurable range (1d, 7d, 30d).",
)
def get_investment_history(
    inv_id: int,
    range: str = "7d",
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Returns price history for an investment.
    range: 1d, 7d, 30d (maps to Yahoo Finance range)
    Returns current price and array of {date, close} entries.
    """
    return investment_portfolio.get_investment_history(db, current_user.id, inv_id, range)
