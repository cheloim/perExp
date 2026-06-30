# Investments

## Overview

NikoFin tracks investment portfolios with manual CRUD and automated sync from Argentine brokers (IOL and PPI). Prices are refreshed automatically every 15 minutes during BYMA trading hours via Yahoo Finance.

## Manual CRUD

Users can add investments with:

| Field      | Description                                        |
| ---------- | -------------------------------------------------- |
| `ticker`   | Stock ticker (e.g., "GGAL", "YPF", "AAPL")         |
| `name`     | Company/fund name                                  |
| `type`     | Accion, Cedear, Bono, Letra, ON, FCI, Caucion, ETF |
| `broker`   | IOL, PPI, or manual                                |
| `quantity` | Shares/units held                                  |
| `avg_cost` | Average cost per unit                              |
| `currency` | ARS or USD                                         |
| `notes`    | Optional notes                                     |

Current price is fetched via Yahoo Finance API.

## Broker Sync

### InvertirOnline (IOL)

**Authentication**: OAuth2 with username + password (stored in Settings)

**Sync flow**:

1. Authenticate via IOL OAuth2
2. Fetch portfolio from bCBA, nYSE, cFondos markets
3. For each position:
   - Look up by ticker
   - Update quantity, avg_cost, current_price, type
   - Skip if ticker not found in user's investments
4. Deduplicate by ticker

**Settings keys**:

- `{user_id}:iol_user`: IOL username
- `{user_id}:iol_pass`: IOL password

### Portfolio Personal (PPI)

**Authentication**: API Key + API Secret (stored in Settings)

**Sync flow**:

1. Authenticate via PPI API
2. Get account number
3. Fetch balance and positions
4. For each position:
   - Look up by ticker
   - Update quantity, current_price, type
   - Preserve user-set avg_cost (don't overwrite)
5. Deduplicate by ticker

**Settings keys**:

- `{user_id}:ppi_key`: PPI API key
- `{user_id}:ppi_secret`: PPI API secret

## Price Refresh Scheduler

**Runs**: Every 15 minutes during BYMA trading hours

**Schedule**:

- Days: Monday–Friday
- Hours: 11:00–17:00 (Argentina time)
- Skips Argentine public holidays (hardcoded calendar)

**What it refreshes**:

1. IOL investment prices (via IOL API)
2. PPI investment prices (via PPI API)
3. Manual investment prices (via Yahoo Finance)

**What it updates**:

- `current_price`: Current market price
- `updated_at`: Timestamp
- Does NOT touch quantities or avg_cost

## Yahoo Finance

Used for:

- Initial price lookup when adding manual investments
- Price refresh for manual investments
- USD/ARS rate calculation

**API**: `yfinance` library or direct Yahoo Finance API

## USD/ARS Rate

Multiple sources attempted in order:

1. **BNA official rate**: Via dolarapi.com
2. **ADR-implied rate**: BCBA price / NYSE ADR price (via Yahoo Finance)
3. **BCRA official rate**: Fallback

Used for:

- Converting USD investments to ARS equivalent
- Displaying portfolio value in both currencies

## Investment Types

| Type    | Description                                  |
| ------- | -------------------------------------------- |
| Accion  | Argentine stock                              |
| Cedear  | Argentine depository receipt (foreign stock) |
| Bono    | Bond                                         |
| Letra   | Short-term government note                   |
| ON      | Corporate bond (Obligación Negociable)       |
| FCI     | Mutual fund (Fondo Común de Inversión)       |
| Caucion | Reverse repo (short-term lending)            |
| ETF     | Exchange-traded fund                         |

## Investment Assistant

Separate AI chat for investment queries:

- Uses `INVESTMENTS_LLM_API_KEY` (falls back to `LLM_API_KEY`)
- SSE streaming responses
- Portfolio data formatted into context
- Can answer questions about holdings, performance, market conditions

## API Endpoints

| Method   | Endpoint                      | Description             |
| -------- | ----------------------------- | ----------------------- |
| `GET`    | `/investments`                | List all investments    |
| `POST`   | `/investments`                | Create investment       |
| `PUT`    | `/investments/{id}`           | Update investment       |
| `DELETE` | `/investments/{id}`           | Delete investment       |
| `POST`   | `/investments/sync/iol`       | Sync with IOL           |
| `POST`   | `/investments/sync/ppi`       | Sync with PPI           |
| `POST`   | `/investments/refresh-prices` | Manual price refresh    |
| `GET`    | `/investments/usd-rate`       | Get USD/ARS rate        |
| `GET`    | `/investments/settings`       | Get broker settings     |
| `PUT`    | `/investments/settings`       | Update broker settings  |
| `POST`   | `/investments/assistant`      | AI chat (SSE streaming) |
