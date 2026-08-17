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

Uses **Google Gemini Flash** for natural language parsing:
- `EXPENSE_PARSE_PROMPT` — extracts date, amount, description from free text
- `CARD_EXTRACT_PROMPT` — extracts card_name and bank from user input
- Model: `gemini-flash-latest` (configurable via `LLM_MODEL_NAME`)
- API key: `MESSAGES_BOT_LLM_API_KEY`

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
2. **Expense logging**: Free text → Gemini parses → card selection → confirm → saved as `Expense`
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

## Google Gemini Flash

Library: **google-genai** (`from google import genai`)

### Use Cases

| Use Case                  | Prompt / Location              | Model                    |
|---------------------------|--------------------------------|--------------------------|
| Expense text parsing      | `EXPENSE_PARSE_PROMPT`         | `gemini-flash-latest`    |
| Card info extraction      | `CARD_EXTRACT_PROMPT`          | `gemini-flash-latest`    |
| Category suggestion       | `app/services/categorization.py` | `gemini-flash-latest`  |
| Spending analysis         | `app/routers/analysis.py`      | `gemini-flash-latest`    |
| PDF report text extraction| `app/services/pdf_parser.py`   | `gemini-flash-latest`    |

### API Keys

| Env Var                      | Purpose                    |
|------------------------------|----------------------------|
| `LLM_API_KEY`                | General LLM (analysis, PDF)|
| `INVESTMENTS_LLM_API_KEY`    | Investment analysis        |
| `MESSAGES_BOT_LLM_API_KEY`   | Telegram/WhatsApp bot LLM  |

### Client Pattern

```python
from google import genai

def _gemini_client() -> genai.Client:
    return genai.Client(api_key=os.getenv("MESSAGES_BOT_LLM_API_KEY", ""))

response = client.models.generate_content(
    model=os.getenv("LLM_MODEL_NAME", "gemini-flash-latest"),
    contents=prompt,
)
result = json.loads(response.text.strip())
```

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
