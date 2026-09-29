# Oikonomia

Personal finance management with intelligent bank statement import, AI auto-categorization, and messaging bots.

> **[Technical Documentation](docs/Home.md)** — Architecture, API reference, data model, and more.

## Stack

| Layer | Tech |
|-------|------|
| Backend | FastAPI + SQLAlchemy 2 + Pydantic v2 + PostgreSQL |
| Frontend | React 18 + TypeScript + Vite + TanStack Query v5 + React Router DOM v7 |
| Charts | Recharts |
| LLM | Google Gemini Flash |
| PDF parsing | pdfplumber |
| Task queue | Celery + Redis |
| Telegram | python-telegram-bot |
| WhatsApp | Meta Cloud API |
| Onboarding | React Joyride |
| Email | Resend |

## Features

- **Smart Import**: PDF (LLM-powered) and CSV/XLSX bank statement import
- **Card Management**: Credit/debit card CRUD with bank and holder tracking
- **Account Management**: Cash and bank accounts for tracking transfers
- **Auto-categorization**: Keyword-based and AI-powered (Gemini Flash) categorization with hierarchical category tree
- **Installments**: Track installment purchases with automatic expansion; bots divide total by installment count
- **Investments**: Sync with IOL and Portfolio Personal via Yahoo Finance
- **AI Analysis**: Chat with AI to query expenses and get trend analysis
- **Budgets**: 50/30/20 macro groups with category-level budgets and temporal events
- **Family Groups**: Share expenses with your family via invite codes
- **Telegram Bot**: Log expenses via Telegram (@NikoFin_bot) with natural language parsing
- **WhatsApp Bot**: Log expenses via WhatsApp (Meta Cloud API)
- **Google OAuth**: Login with Google
- **MFA**: TOTP-based two-factor authentication
- **Onboarding Tour**: First-time guided walkthrough of all features
- **User Guide**: Comprehensive guide at /guide with 8 chapters
- **Landing Page**: GNOME HIG-inspired design with visual mockups at oikonomia.ar
- **Multi-Domain**: Landing page at oikonomia.ar, app at platform.oikonomia.ar
- **Terms & Privacy**: TOS at /tos, privacy policy at /privacy
- **Field-level Encryption**: AES encryption for PII fields with HMAC-indexed lookups
- **Data Deletion**: Meta-compliant WhatsApp data deletion callback

## Architecture

```
User → Landing (oikonomia.ar) → React SPA (platform.oikonomia.ar)
                                        ↓
                                    Nginx (SSL + proxy)
                                        ↓
                    Telegram Bot ←→ FastAPI (22 routers) → PostgreSQL
                    WhatsApp Bot ←→         ↓              → Redis → Celery Worker
                                        Gemini Flash      → Resend (email)
```

> **[Interactive Architecture Diagram](.archify/oikonomia-architecture.html)** — Open in browser for a visual, interactive system overview with component relationships.

## Requirements

- Python 3.11+
- Node.js 18+
- PostgreSQL 14+
- Redis 7+
- Docker or Podman

## Local Development

```bash
# Clone
git clone https://github.com/cheloim/perExp.git
cd perExp

# Copy and edit environment file
cp .env.example .env

# Start with Podman
podman-compose up -d

# Run migrations
podman-compose run --rm backend_dev python /app/scripts/migrate_db_structure.py

# Access
# Frontend: http://localhost:8082
# Backend:  http://localhost:8001
# API docs: http://localhost:8001/docs
```

### Services

| Service | Port | Description |
|---------|------|-------------|
| `backend_dev` | 8001 | FastAPI backend |
| `celery_worker_dev` | - | Background task processor |
| `frontend_dev` | 8082 | Vite dev server |
| `db` | 5432 | PostgreSQL database |
| `redis` | 6379 | Redis (Celery broker) |

## Telegram Bot

The bot is available at [@NikoFin_bot](https://t.me/NikoFin_bot).

1. Open the bot in Telegram
2. Send `/start`
3. Go to the app → Settings → Telegram Bot
4. Copy the key and paste it in the bot

### Logging Expenses

Just send a message describing your expense:
- "gasté 1500 en farmacity"
- "uber 3200 ayer"
- "Netflix USD 5"
- "compré una laptop en 4 cuotas de 15000"

## License

GPLv3
