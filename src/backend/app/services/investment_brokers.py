"""IOL and PPI broker adapters for the investments feature.

The adapters only talk to the brokers and normalize their payloads. Persistence
and transaction boundaries belong to ``investment_sync`` / ``investment_cash``.
"""

from __future__ import annotations

from fastapi import HTTPException

IOL_TYPE_MAP = {
    "ACCIONES": "Acción",
    "CEDEARS": "Cedear",
    "BONOS": "Bono",
    "LETRAS": "Letra",
    "OBLIGACIONES_NEGOCIABLES": "ON",
    "FONDOS_COMUNES_INVERSION": "FCI",
    "CAUCIONES": "Caución",
    "OPCIONES": "Otro",
    "FUTUROS": "Otro",
}

IOL_CURRENCY_MAP = {
    "pesos_argentinos": "ARS",
    "dolares_estadounidenses": "USD",
    "dolares_cable": "USD",
}

PPI_CURRENCY_MAP = {"Pesos": "ARS", "Dólares": "USD", "Dolares": "USD", "USD": "USD"}

PPI_TYPE_MAP = {
    "ACCIONES": "Acción",
    "CEDEARS": "Cedear",
    "BONOS": "Bono",
    "LETRAS": "Letra",
    "ON": "ON",
    "FCI": "FCI",
    "CAUCIONES": "Caución",
    "ETF": "Cedear",
    "ACCIONES-USA": "Cedear",
    "FCI-EXTERIOR": "FCI",
    "NOBAC": "Bono",
    "LEBAC": "Letra",
    "OPCIONES": "Otro",
    "FUTUROS": "Otro",
}

IOL_MARKETS = ("bCBA", "nYSE", "cFondos")


def _post_iol_token(username: str, password: str):
    """Raw IOL token request. Raises the underlying ``requests`` error."""
    import requests as _req

    auth = _req.post(
        "https://api.invertironline.com/token",
        data={"username": username, "password": password, "grant_type": "password"},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        timeout=20,
    )
    auth.raise_for_status()
    return auth


def authenticate_iol(username: str, password: str) -> str:
    """Authenticate against IOL and return an access token."""
    import requests as _req

    try:
        auth = _post_iol_token(username, password)
    except _req.exceptions.HTTPError as e:
        status = e.response.status_code if e.response is not None else "?"
        if status in (400, 401):
            raise HTTPException(
                401, "Credenciales de IOL incorrectas. Verificá usuario y contraseña."
            )
        raise HTTPException(502, f"IOL respondió con error {status}. Intentá de nuevo más tarde.")
    except _req.exceptions.ConnectionError:
        raise HTTPException(502, "No se pudo conectar con IOL. Verificá tu conexión a internet.")
    except _req.exceptions.Timeout:
        raise HTTPException(504, "La conexión con IOL tardó demasiado. Intentá de nuevo.")
    except Exception as e:
        raise HTTPException(502, f"Error autenticando con IOL: {e}")

    token = auth.json().get("access_token")
    if not token:
        raise HTTPException(502, "IOL no devolvió access_token")
    return token


def fetch_iol_portfolio(username: str, password: str) -> tuple[list[dict], list[str]]:
    """Fetch and normalize the IOL portfolio.

    Returns the raw positions and the markets that answered successfully; the
    caller only prunes stale rows when every market answered.
    """
    import requests as _req

    token = authenticate_iol(username, password)
    headers = {"Authorization": f"Bearer {token}"}

    raw: list[dict] = []
    successful_markets: list[str] = []
    for mercado in IOL_MARKETS:
        try:
            resp = _req.get(
                f"https://api.invertironline.com/api/v2/portafolio/{mercado}",
                headers=headers,
                timeout=20,
            )
            if resp.status_code != 200:
                continue
            successful_markets.append(mercado)
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

                raw.append(
                    {
                        "ticker": titulo.get("simbolo", ""),
                        "name": titulo.get("descripcion", ""),
                        "type": IOL_TYPE_MAP.get(tipo_raw, "Otro"),
                        "currency": IOL_CURRENCY_MAP.get(moneda_raw, "ARS"),
                        "quantity": cantidad,
                        "avg_cost": effective_avg_cost,
                        "current_price": effective_price,
                    }
                )
        except Exception:
            continue

    return raw, successful_markets


def fetch_iol_cash(username: str, password: str) -> dict | None:
    """Return uninvested IOL cash as ``{"ars": float, "usd": float}``.

    ``None`` means the broker did not return a usable snapshot, so the caller
    keeps the balances as unknown instead of reporting zero.
    """
    import requests as _req

    auth = _post_iol_token(username, password)
    token = auth.json().get("access_token", "")
    if not token:
        return None

    headers = {"Authorization": f"Bearer {token}"}
    r = _req.get(
        "https://api.invertironline.com/api/v2/estadocuenta",
        headers=headers,
        timeout=20,
    )
    if r.status_code != 200:
        return None

    data = r.json()
    # IOL returns a list of accounts or a single object depending on version
    cuentas = data if isinstance(data, list) else data.get("cuentas", [data])
    ars_total = 0.0
    usd_total = 0.0
    for cuenta in cuentas:
        moneda = str(cuenta.get("moneda", cuenta.get("currency", ""))).lower()
        disponible = float(
            cuenta.get("disponible", cuenta.get("disponibleOperar", cuenta.get("saldo", 0))) or 0
        )
        if "dolar" in moneda or "usd" in moneda or "dollar" in moneda:
            usd_total += disponible
        else:
            ars_total += disponible
    return {"ars": ars_total, "usd": usd_total}


def _ppi_client(api_key: str, api_secret: str):
    from ppi_client.ppi import PPI

    ppi = PPI(sandbox=False)
    ppi.account.login_api(api_key, api_secret)
    return ppi


def _ppi_account_number(accounts: list[dict]) -> str:
    return (
        accounts[0].get("comitente")
        or accounts[0].get("accountNumber")
        or accounts[0].get("numeroCuenta")
        or str(accounts[0].get("id", ""))
    )


def fetch_ppi_positions(api_key: str, api_secret: str) -> dict:
    """Fetch the raw PPI balance-and-positions payload."""
    try:
        ppi = _ppi_client(api_key, api_secret)
        accounts = ppi.account.get_accounts()
        if not accounts:
            raise HTTPException(502, "PPI no devolvió ninguna cuenta")
        account_number = _ppi_account_number(accounts)
        if not account_number:
            raise HTTPException(502, f"No se pudo leer el número de cuenta de PPI: {accounts[0]}")
        return ppi.account.get_balance_and_positions(account_number)
    except HTTPException:
        raise
    except PermissionError:
        raise HTTPException(401, "Credenciales de PPI incorrectas. Verificá tu API Key y Secret.")
    except Exception as e:
        msg = str(e)
        if "401" in msg or "unauthorized" in msg.lower() or "forbidden" in msg.lower():
            raise HTTPException(
                401, "Credenciales de PPI rechazadas. Verificá tu API Key y Secret."
            )
        raise HTTPException(502, f"Error conectando con PPI: {e}")


def fetch_ppi_cash(api_key: str, api_secret: str) -> dict | None:
    """Return immediate-settlement PPI cash as ``{"ars": float, "usd": float}``.

    ``None`` means the broker returned no accounts, so the caller keeps the
    balances as unknown instead of reporting zero.
    """
    ppi = _ppi_client(api_key, api_secret)
    accounts = ppi.account.get_accounts()
    if not accounts:
        return None

    account_number = _ppi_account_number(accounts)
    # get_available_balance returns [{name, symbol, amount, settlement}]
    availability = ppi.account.get_available_balance(account_number)
    ars_total = usd_total = 0.0
    for entry in availability or []:
        if entry.get("settlement") != "INMEDIATA":
            continue
        symbol = (entry.get("symbol") or "").upper()
        amount = float(entry.get("amount") or 0)
        if symbol == "ARS":
            ars_total += amount
        elif symbol == "USD":
            usd_total += amount
    return {"ars": ars_total, "usd": usd_total}
