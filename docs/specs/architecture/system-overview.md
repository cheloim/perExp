# System Architecture — Oikonomia (Credit Card Analyzer)

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                           USERS                                     │
│  (Browser / Telegram Bot / WhatsApp Bot / Mobile)                   │
└────────┬──────────────────┬──────────────────┬──────────────────────┘
         │                  │                  │
         ▼                  ▼                  ▼
┌────────────────┐  ┌───────────────┐  ┌───────────────┐
│   Frontend     │  │  Telegram Bot │  │ WhatsApp Bot  │
│  Vite + React  │  │  (daemon thd) │  │ (daemon thd)  │
│   :8082        │  │               │  │               │
└───────┬────────┘  └──────┬────────┘  └──────┬────────┘
        │                  │                  │
        │     HTTP/SSE     │    python-tg-bot  │   HTTP webhook
        ▼                  ▼                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      BACKEND (FastAPI :8001)                         │
│                                                                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │
│  │  19 API  │ │ 20 Svc   │ │ Telegram │ │ WhatsApp │ │Scheduler │  │
│  │ Routers  │ │ Modules  │ │   Bot    │ │   Bot    │ │  (APSch) │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘  │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  SharedWorker (cross-tab SSE notifications)                  │   │
│  └──────────────────────────────────────────────────────────────┘   │
└───────┬──────────────────┬──────────────────┬───────────────────────┘
        │                  │                  │
        ▼                  ▼                  ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐
│ PostgreSQL   │  │    Redis     │  │   Celery Workers     │
│     16       │  │      7       │  │   + Celery Beat      │
│  :5432       │  │   :6379      │  │   (12 scheduled)     │
└──────────────┘  └──────────────┘  └──────────────────────┘
```

## Container Architecture (Development)

```
podman-compose.yml
├── db              → postgres:16-alpine    :5432
├── redis           → redis:7-alpine        :6379
├── backend_dev     → FastAPI + uvicorn     :8001 → :8000
│   └── Telegram bot runs as daemon thread inside backend
├── frontend_dev    → Vite dev server       :8082 → :5173
├── celery_worker_dev → Celery worker       (concurrency=2)
└── celery_beat_dev   → Celery beat         (task scheduler)
```

## API Routers (19)

| Router | Prefix | Purpose |
|---|---|---|
| `auth` | `/auth` | Login, register, OAuth (Google), password recovery, email verification |
| `mfa` | `/mfa` | TOTP setup, enable/disable, QR generation |
| `accounts` | `/accounts` | Bank accounts, digital wallets CRUD |
| `cards` | `/cards` | Credit/debit cards CRUD |
| `categories` | `/categories` | Expense categories hierarchy |
| `card_closings` | `/card-closings` | Card closing/due dates |
| `expenses` | `/expenses` | Expense CRUD, filtering, bulk operations |
| `investments` | `/investments` | Portfolio management, price tracking |
| `import_jobs` | `/import-jobs` | CSV/PDF import pipeline |
| `dashboard` | `/dashboard` | Aggregated stats, charts data |
| `analysis` | `/analysis` | AI-powered spending analysis |
| `groups` | `/groups` | Family group management |
| `notifications` | `/notifications` | In-app notifications, SSE stream |
| `scheduled_expenses` | `/scheduled-expenses` | Installment tracking, future expenses |
| `budgets` | `/budgets` | Budget limits, alerts, events |
| `suggestions` | `/suggestions` | AI category suggestions |
| `recurring` | `/recurring` | Recurring expense detection/management |
| `admin` | `/x/admin` | User management, impersonation, platform logs |
| `whatsapp_webhook` | `/whatsapp` | WhatsApp Business API webhook |

## Services (20)

| Service | Purpose |
|---|---|
| `auth` | JWT tokens, password hashing, current user dependency |
| `budget_helpers` | Budget calculation, rollover, alerts |
| `categorization` | LLM + keyword-based expense categorization |
| `csv_parser` | Bank statement CSV parsing |
| `date_utils` | Argentine date parsing, relative dates |
| `email` | Resend integration, templates |
| `encryption` | AES-256 field encryption, HMAC for searchable fields |
| `import_utils` | Import validation, preview generation |
| `mfa` | TOTP secret generation, verification |
| `normalizers` | Merchant name normalization, dedup keys |
| `pdf` | PDF extraction with pdfplumber |
| `pdf_report` | Playwright-based report rendering |
| `platform_log_handler` | Python logging → DB PlatformLog |
| `price_refresh` | IOL + PPI + manual price fetching |
| `rate_limit` | slowapi configuration |
| `smart_import_core` | Smart bank statement detection |
| `task_tracker` | Celery task progress tracking |
| `weekly_report` | Weekly summary generation |

## Celery Tasks (12 Scheduled)

| Task | Schedule | Purpose |
|---|---|---|
| `execute_due_installments` | Daily 02:00 | Create expenses from scheduled installments |
| `cleanup_expired_import_jobs` | Daily 03:30 | Remove old import job files |
| `daily_uncategorized_check` | Daily 11:00 | Notify users about uncategorized expenses |
| `send_weekly_reports` | Monday 01:30 | Email weekly spending summaries |
| `generate_monthly_reports` | 1st of month 03:00 | Generate monthly PDF reports |
| `suggest_uncategorized_categories` | Daily 02:00 | AI category suggestions for uncategorized |
| `detect_recurring_expenses` | Daily 03:00 | Auto-detect recurring patterns |
| `check_upcoming_recurring` | Daily 08:00 | Alert about upcoming recurring charges |
| `cleanup_old_records` | Daily 04:00 | Purge old audit logs |
| `process_import_job` | On-demand | Process uploaded CSV/PDF imports |
| `generate_single_report` | On-demand | Generate report for specific user/month |
| Budget tasks | Various | Budget recalculation and alerts |

## Investment Price Refresh (APScheduler)

```
┌─────────────────────────────────────────────┐
│  APScheduler Loop (inside FastAPI process)   │
│                                              │
│  Every 60s: check is_trading_now()           │
│    ├── Weekday? Mon-Fri                      │
│    ├── Market hours? 11:00-17:00 ART         │
│    └── Not a holiday? (BYMA calendar)        │
│                                              │
│  If trading: refresh every 15 min            │
│    ├── IOL prices (httpx → IOL API)          │
│    ├── PPI prices (ppi-client)               │
│    └── Manual prices (user-entered)          │
└─────────────────────────────────────────────┘
```

## Telegram Bot Architecture

```
┌─────────────────────────────────────────────────┐
│  Telegram Bot (daemon thread in backend)         │
│                                                  │
│  python-telegram-bot 21+                         │
│  ├── ConversationHandler                         │
│  │   ├── WAITING_PAYMENT → method selection      │
│  │   ├── WAITING_CARD_BANK → bank selection      │
│  │   ├── WAITING_CARD_TYPE → card selection      │
│  │   ├── WAITING_CARD_CREATE_* → new card flow   │
│  │   └── WAITING_CONFIRM → expense confirmation  │
│  ├── /start → link account via telegram_key      │
│  ├── /gastos → view recent expenses              │
│  └── /resumen → monthly summary                  │
│                                                  │
│  Maps to: POST /expenses, GET /cards, etc.       │
└─────────────────────────────────────────────────┘
```

## SharedWorker (Cross-Tab SSE)

```
┌─────────────────────────────────────────────┐
│  Browser Tab 1 ──┐                          │
│  Browser Tab 2 ──┼── SharedWorker ── SSE ── Backend /notifications/stream
│  Browser Tab 3 ──┘                          │
│                                             │
│  Single SSE connection shared across tabs   │
│  Broadcasts notifications to all tabs       │
└─────────────────────────────────────────────┘
```

## Data Flows

### Import Pipeline

```
User uploads CSV/PDF
       │
       ▼
POST /import-jobs (multipart)
       │
       ▼
Celery: process_import_job
       │
       ├── Parse file (csv_parser / pdf / smart_import_core)
       ├── Extract transactions
       ├── Normalize merchants (normalizers)
       ├── Auto-categorize (categorization service)
       ├── Match to cards (card_closings)
       └── Generate preview_data (JSON)
              │
              ▼
       Status → READY_PREVIEW
              │
              ▼
User reviews preview → POST /import-jobs/{id}/confirm
              │
              ▼
       Create Expenses + ScheduledExpenses
       Status → COMPLETED
```

### Expense Creation (Direct)

```
User fills form (frontend)
       │
       ▼
POST /expenses
       │
       ├── Validate (Pydantic schema)
       ├── Encrypt sensitive fields (encryption service)
       ├── Compute HMAC for searchable fields
       ├── Auto-categorize if no category (categorization)
       ├── Check budget limits (budget_helpers)
       ├── Create CategorySuggestion if AI-suggested
       └── Insert to DB
              │
              ▼
       Return created expense
       + Trigger notification if budget alert
```

### Bot Interaction Flow

```
User sends message to Telegram bot
       │
       ▼
ConversationHandler routes to state
       │
       ├── /start → validate telegram_key → link account
       ├── Send photo of receipt → OCR → create expense
       ├── Send text → parse amount + description
       └── Select card/account/category via inline keyboard
              │
              ▼
       POST /expenses (internal API call)
              │
              ▼
       Reply with confirmation + remaining budget
```

## Security Architecture

```
┌─────────────────────────────────────────────────┐
│  Layer              │  Implementation            │
├─────────────────────┼────────────────────────────┤
│  Authentication     │  JWT (PyJWT) + bcrypt      │
│  Authorization      │  user_id scoping all queries│
│  MFA                │  TOTP (pyotp) + QR         │
│  Rate Limiting      │  slowapi per-endpoint      │
│  Field Encryption   │  AES-256 (encryption svc)  │
│  Searchable Fields  │  HMAC hashes               │
│  Audit Trail        │  AuditLog model            │
│  Impersonation      │  Admin → user with token   │
│  CORS               │  Configured origins only   │
│  SSL/TLS            │  nginx + certbot           │
│  Secrets            │  Podman secrets (dev)      │
│                     │  Environment vars (prod)   │
└─────────────────────────────────────────────────┘
```
