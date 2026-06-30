# Architecture

## System Overview

NikoFin follows a classic three-tier architecture with async background processing:

```
┌──────────────────────────────────────────────────────────┐
│                     CLIENTS                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │  React SPA   │  │ Telegram Bot │  │  Mobile Web  │   │
│  │  (Vite)      │  │  (@NikoFin)  │  │  (Responsive)│   │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘   │
└─────────┼─────────────────┼─────────────────┼────────────┘
          │                 │                 │
          ▼                 ▼                 ▼
┌──────────────────────────────────────────────────────────┐
│                    FastAPI (port 8001)                    │
│  ┌────────────────────────────────────────────────────┐  │
│  │  14 Routers │ Auth │ LLM Services │ SSE Streams   │  │
│  └────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Telegram Bot (daemon thread) │ Scheduler (APScheduler) │
│  └────────────────────────────────────────────────────┘  │
└──────┬──────────────────┬──────────────────┬─────────────┘
       │                  │                  │
       ▼                  ▼                  ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  PostgreSQL  │  │    Redis     │  │   Celery     │
│  (port 5432) │  │  (port 6379) │  │   Worker     │
│  └─ Data     │  │  └─ Broker   │  │  └─ Imports  │
│  └─ Migrations│ │  └─ Locks    │  │  └─ Cleanup  │
│              │  │  └─ Cache    │  │  └─ Scheduled │
└──────────────┘  └──────────────┘  └──────────────┘
```

## Component Responsibilities

### FastAPI Backend

- REST API (14 routers, ~60 endpoints)
- JWT authentication with Google OAuth and Apple Sign-In
- SSE notification streaming (SharedWorker-based)
- LLM integration (Google Gemini Flash)
- Telegram bot (runs as daemon thread)
- Investment price scheduler (APScheduler, every 15 min during trading hours)

### Celery Worker

- Import processing (PDF/CSV/XLSX → LLM parsing → preview)
- Scheduled expense execution (daily at 2:00 AM)
- Import job cleanup (daily at 3:30 AM, 24h TTL)

### PostgreSQL

- All application data (13 tables)
- Alembic migrations for schema versioning

### Redis

- Celery message broker
- Per-user import locks (FIFO queue)
- SSE connection state

### React Frontend

- SPA with React Router v7
- TanStack Query v5 for server state
- Recharts for data visualization
- SharedWorker for cross-tab SSE
- CSS variables for theming (GNOME HIG-inspired)

## Data Flow: Import Pipeline

```
User uploads PDF
       │
       ▼
POST /import-jobs (stores file as LargeBinary)
       │
       ▼
Celery task dispatched ──► Redis lock acquired (per-user FIFO)
       │
       ▼
pdfplumber extracts text
       │
       ▼
Gemini LLM parses transactions (JSON)
       │
       ▼
Post-processing: expand installments, detect duplicates, auto-categorize
       │
       ▼
Job status → READY_PREVIEW + Notification created
       │
       ▼
SSE pushes notification to frontend (toast + bell icon)
       │
       ▼
User reviews preview → confirms → Expenses created in DB
```

## Data Flow: Telegram Bot

```
User sends "gasté 1500 en farmacity"
       │
       ▼
Gemini parses → {amount: 1500, description: "farmacity", date: "today"}
       │
       ▼
Bot shows confirmation with category, payment method
       │
       ▼
User selects payment (card/account) → confirms
       │
       ▼
Expense saved → confirmation message with details
```

## Development vs Production

| Aspect   | Development                     | Production                               |
| -------- | ------------------------------- | ---------------------------------------- |
| Backend  | uvicorn --reload, volume mounts | uvicorn (no reload), compiled image      |
| Frontend | Vite dev server (HMR)           | nginx serving built static files         |
| Database | PostgreSQL container            | PostgreSQL container (persistent volume) |
| Celery   | Single worker                   | Single worker                            |
| Secrets  | Local .env file                 | Docker secrets (base64-encoded JSON)     |
| Ports    | 8001 (API), 8082 (UI)           | 8001 (API), 80 (UI via nginx)            |

## Key Design Decisions

1. **LLM for all import formats** — PDF, CSV, and XLSX all go through Gemini for unified parsing (cost: ~$0.003/import). Simpler than maintaining separate parsers.

2. **Per-user FIFO queue** — Redis locks ensure one import at a time per user, but different users process in parallel.

3. **SSE + SharedWorker** — Single SSE connection shared across browser tabs via BroadcastChannel.

4. **Telegram bot inside FastAPI** — Runs as a daemon thread in the same process. No separate container needed.

5. **CSS variables for theming** — Light/dark mode via CSS custom properties, GNOME HIG-inspired design.
