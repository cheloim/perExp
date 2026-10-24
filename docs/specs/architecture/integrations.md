# External Integrations

## Telegram Bot

Library: **python-telegram-bot** (v20+, async)

### Architecture

- Runs as a **daemon thread** inside the `backend_dev` container (no separate container)
- Started from `main.py`:
  ```python
  from app.telegram_bot import start_bot
  threading.Thread(target=start_bot, args=(token,), daemon=True).start()
  ```
- Module-level `_bot_app` reference allows proactive messaging from the web backend
- Uses `ConversationHandler` with callback query states for multi-step flows

### Conversation States

| State | Constant                        | Purpose                              |
|-------|---------------------------------|--------------------------------------|
| 0     | `WAITING_AUTH`                  | Waiting for Telegram key to link     |
| 1     | `WAITING_PAYMENT`               | Select payment method (card/cash)    |
| 2     | `WAITING_CARD_BANK`             | Select card by bank                  |
| 3     | `WAITING_CARD_TYPE`             | Select card type (credit/debit)      |
| 4     | `WAITING_CONFIRM`               | Confirm expense details              |
| 5     | `WAITING_CARD_MANUAL`           | Manual card entry                    |
| 6     | `WAITING_INSTALLMENT_QUESTION`  | Ask if expense is installment        |
| 7     | `WAITING_INSTALLMENT_NUMBER`    | Enter installment count              |
| 8     | `WAITING_ACCOUNT_SELECT`        | Select account for cash/transfer     |
| 9     | `WAITING_ACCOUNT_CREATE_NAME`   | Enter new account name               |
| 10    | `WAITING_ACCOUNT_CREATE_TYPE`   | Select new account type              |
| 11    | `WAITING_CARD_CREATE_CHOICE`    | Choose to create new card            |
| 12    | `WAITING_CARD_CREATE_TYPE`      | Select new card type                 |
| 13    | `WAITING_CARD_CREATE_NAME`      | Enter new card name + bank           |
| 14    | `WAITING_CARD_CREATE_CONFIRM`   | Confirm new card details             |
| 15    | `WAITING_EVENT_CONFIRM`         | Confirm budget event expense         |

### LLM Integration

Uses the provider-neutral LLM layer (`app/services/llm`) for natural language parsing:
- `EXPENSE_PARSE_PROMPT` — extracts date, amount, description from free text
- `CARD_EXTRACT_PROMPT` — extracts card_name and bank from user input
- Model: `LLM_MODEL_NAME` (see the LLM Provider Layer section)
- API key: `MESSAGES_BOT_LLM_API_KEY`
- Metric labels: `telegram_expense`, `telegram_card`, `telegram_bank`

### Commands

| Command     | Description                              |
|-------------|------------------------------------------|
| `/start`    | Link Telegram account using Telegram key |
| `/gasto`    | Log expense via text (e.g. `/gasto 1500 supermercado`) |
| `/resumen`  | Monthly spending summary                 |
| `/tarjetas` | List linked cards                        |
| `/cuenta`   | Manage accounts                          |

### Key Flows

1. **Auth**: User sends Telegram key → bot looks up `User.telegram_key` → stores `telegram_chat_id` (encrypted)
2. **Expense logging**: Free text → LLM parses → card selection → confirm → saved as `Expense`
3. **Card creation**: Inline keyboard flow through card type → bank/name → confirm → `Card` created

## WhatsApp Bot

Status: **Planned / Partial**

Integration point: `app/routers/whatsapp_webhook.py`

Will use either:
- **Meta Cloud API** (direct WhatsApp Business API)
- **Twilio WhatsApp API**

Env vars reserved:
- `WHATSAPP_TOKEN` — API access token
- `WHATSAPP_PHONE_ID` — WhatsApp Business phone number ID
- `WHATSAPP_VERIFY_TOKEN` — Webhook verification token

User model already has `whatsapp_phone` (encrypted) and `whatsapp_phone_hash` (HMAC) fields.

## LLM Provider Layer

The app never talks to a vendor SDK directly. Everything goes through
`app/services/llm/`, so a provider swap is a configuration change.

Library: **openai** (default) or **google-genai** (fallback), selected per call.

### Layout

| File | Responsibility |
|------|----------------|
| `app/services/llm/types.py` | `LLMMessage`, `LLMResult`, `parse_json_block` |
| `app/services/llm/client.py` | The facade: `complete` / `complete_json` / `stream`, plus async variants |
| `app/services/llm/openai_adapter.py` | OpenAI: chat completions, JSON mode, streaming + usage |
| `app/services/llm/google_adapter.py` | Gemini: `generate_content`, `system_instruction`, streaming |
| `app/services/llm/pricing.py` | USD per 1M tokens, for the cost metric |
| `app/services/llm/metrics.py` | Usage accounting → Prometheus |

### Provider selection

`LLM_PROVIDER` wins when set (`openai` | `google`). Otherwise the provider is
inferred from the key shape: `sk-...` is OpenAI, anything else is Google. That
is what makes replacing the value of `LLM_API_KEY` enough to move providers.

`LLM_MODEL_NAME` defaults to `gpt-6-luna` (OpenAI) or `gemini-flash-latest`
(Google). Note that Google's `-latest` aliases are floating and move without
notice; OpenAI and Anthropic have no equivalent, so upgrades there are manual.

### Call sites

Every call passes a `feature` label — that is how the dashboard attributes cost.

| Feature | Use case | Location |
|---------|----------|----------|
| `telegram_expense` | Free-text expense parsing | `app/telegram_bot.py` |
| `telegram_card` | Card name/bank extraction | `app/telegram_bot.py` |
| `telegram_bank` | Bank notification parsing | `app/telegram_bot.py` |
| `categorization` | Category suggestion + confidence | `app/services/categorization.py` |
| `smart_import` | Statement/PDF extraction (JSON) | `app/services/smart_import_core.py` |
| `analysis_chat` | Financial analysis chat (streaming) | `app/routers/analysis.py` |
| `analysis_summary` | Chat session summary (streaming) | `app/routers/analysis.py` |
| `investments_chat` | Investments assistant (streaming) | `app/routers/investments.py` |
| `dashboard_monthly` | Monthly analysis (JSON) | `app/routers/dashboard.py` |
| `dashboard_trends` | Trends and projections (JSON) | `app/routers/dashboard.py` |
| `weekly_summary` | Weekly report analysis | `app/tasks/weekly_summary.py` |
| `monthly_report` | Monthly report analysis (JSON) | `app/tasks/monthly_report.py` |

Conversation history is turned into provider-neutral turns by
`app/services/chat_context.to_llm_messages`, which also caps how much of a
thread reaches the model.

### API Keys

| Env Var                      | Purpose                    |
|------------------------------|----------------------------|
| `LLM_API_KEY`                | General LLM (analysis, PDF)|
| `INVESTMENTS_LLM_API_KEY`    | Investment analysis        |
| `MESSAGES_BOT_LLM_API_KEY`   | Telegram/WhatsApp bot LLM  |

The last two fall back to `LLM_API_KEY` when unset. Each call site may use its
own key, which is why cost can be split per feature without extra keys.

### Client Pattern

```python
from app.services.llm import LLMMessage, get_client

client = get_client()                       # provider from env / key shape
result = client.complete(
    [LLMMessage(role="user", text=prompt)],
    feature="telegram_expense",
)

data = client.complete_json([...], feature="categorization", temperature=0.3)

async for delta in client.astream([...], feature="analysis_chat", system=PROMPT):
    ...
```

`complete_json` sets the provider's JSON mode and unwraps markdown fences, so
callers get a dict or a `ValueError`. A missing key raises `LLMError`, and
`is_configured()` lets a call site degrade gracefully instead.

### Usage and cost metrics

Every call records tokens, latency, request status and an estimated cost. The
records live in Redis rather than in process memory: Celery tasks call the LLM
from a worker whose Prometheus registry is never scraped, and Redis is already
shared by both processes. A custom collector turns those records into series at
scrape time (`/metrics`).

| Series | Type | Labels |
|--------|------|--------|
| `oikonomia_llm_requests_total` | counter | provider, model, feature, status |
| `oikonomia_llm_tokens_total` | counter | provider, model, feature, direction |
| `oikonomia_llm_cost_usd_total` | counter | provider, model, feature |
| `oikonomia_llm_latency_seconds` | summary | provider, model, feature |
| `oikonomia_llm_spend_usd_month_to_date` | gauge | — |
| `oikonomia_llm_budget_used_ratio` | gauge | — |
| `oikonomia_llm_budget_usd` | gauge | — |
| `oikonomia_llm_credit_balance_usd` | gauge | — |
| `oikonomia_llm_credit_amount_usd` | gauge | — |
| `oikonomia_llm_credit_expires_timestamp_seconds` | gauge | — |

Dashboard: **Oikonomia - LLM** (`docker/grafana/dashboards/llm.json`).
Alerts: `docker/grafana/provisioning/alerting/rules.yml` (Grafana-managed, so
they actually notify — see `docs/Deployment.md`).

Budget and credit come from `LLM_MONTHLY_BUDGET_USD`, `LLM_CREDIT_AMOUNT_USD`
and `LLM_CREDIT_EXPIRES_AT`. There is no official OpenAI endpoint for a prepaid
balance, so those gauges are a configured purchase minus recorded spend. Prepaid
credits expire 12 months after purchase — that is what the expiry gauge tracks.

### Adding a provider

Implement the four raw calls (`_complete`, `_acomplete`, `_stream`, `_astream`)
on `LLMClient`, return `LLMResult` with whatever `usage` the vendor reports, and
add its price to `pricing.py`. No call site changes.

## Resend (Email)

Library: **resend** (Python SDK)

Used for transactional emails:

| Email Type           | Function                      | Trigger                    |
|----------------------|-------------------------------|----------------------------|
| Password reset       | `send_password_reset_email()` | `POST /auth/forgot-password` |
| Email verification   | `send_verification_email()`   | `POST /auth/register`      |
| Admin notifications  | `send_admin_notification()`   | New user registration      |

Configuration:
- `EMAIL_API_KEY` — Resend API key
- `SMTP_FROM` — Sender name (default: "NikoFin")
- `SMTP_FROM_ADDRESS` — Sender address (default: "noreply@resend.dev")
- `ADMIN_EMAIL` — Admin notification recipient

## Investment Price Data

### Yahoo Finance

Used for fetching current prices of stocks, ETFs, and international tickers.

### IOL (InvertirOnline) / PPI (Portfolio Personal de Inversiones)

Used for Argentine market data (CEDEARs, bonos, obligaciones negociables).

Price data is cached in `investments.current_price` column and refreshed periodically.

## Playwright (PDF Reports)

Library: **playwright** (Python, Chromium)

Used for generating PDF/PNG monthly reports:
- Renders an HTML template with expense data
- Chromium captures to PDF or PNG
- Stored in `monthly_reports.pdf_data` / `monthly_reports.png_data`

Installed in the Docker image via:
```dockerfile
RUN playwright install chromium
```

System dependencies for headless Chromium are installed in `Dockerfile.dev` (libnss3, libatk, etc.).

## Redis

Library: **redis-py**

| Use Case            | Key Pattern                        | TTL        |
|---------------------|------------------------------------|------------|
| Rate limiting       | `rate_limit:{type}:{key}`          | 60-300s    |
| Account lockout     | `lockout:{user_id}`                | 900s       |
| Failed login count  | `failed_login:{user_id}`           | 900s       |
| Celery broker       | (default DB 0)                     |            |
| Celery result backend | (default DB 1)                   |            |

Connection: `REDIS_URL` env var (default: `redis://localhost:6379/0`)

## Celery

Used for background tasks (scheduled expense execution, recurring detection, report generation).

- **Worker**: `celery -A app.celery_app worker --loglevel=info --concurrency=2`
- **Beat**: `celery -A app.celery_app beat --loglevel=info`
- Both run as separate containers (`celery_worker_dev`, `celery_beat_dev`)
