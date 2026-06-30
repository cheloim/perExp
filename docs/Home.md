# NikoFin — Technical Documentation

**NikoFin** is a personal finance management application with intelligent bank statement import, built primarily for Argentine users. It combines AI-powered expense tracking, investment portfolio monitoring, and family group sharing into a single platform.

## What Problem Does It Solve?

Tracking personal finances across credit cards, bank accounts, and investments is tedious. NikoFin automates this by:

- **Importing bank statements** (PDF, CSV, XLSX) using AI to parse transactions automatically
- **Categorizing expenses** with keyword-based auto-categorization and a hierarchical category tree
- **Tracking investments** synced with Argentine brokers (IOL, PPI) via Yahoo Finance
- **Logging expenses on-the-go** via a Telegram bot that understands natural language
- **Sharing finances** with family members through group invites

## Documentation

| Document                            | Description                                             |
| ----------------------------------- | ------------------------------------------------------- |
| [Architecture](Architecture.md)     | Tech stack, component diagram, how everything connects  |
| [Features](Features.md)             | Full feature list with descriptions                     |
| [Smart Import](Smart-Import.md)     | PDF/CSV/XLSX import pipeline (LLM, Redis queue, Celery) |
| [Telegram Bot](Telegram-Bot.md)     | Bot setup, conversation flow, all 15 states             |
| [Data Model](Data-Model.md)         | All 13 entities, relationships, key fields              |
| [AI Integration](AI-Integration.md) | How Gemini is used: parsing, analysis, trends           |
| [Family Groups](Family-Groups.md)   | Multi-user sharing, invite flow                         |
| [Investments](Investments.md)       | IOL/PPI sync, Yahoo Finance, price refresh scheduler    |
| [Authentication](Authentication.md) | JWT, Google OAuth, Apple Sign-In, password reset        |
| [API Reference](API-Reference.md)   | All 14 routers and key endpoints                        |
| [Deployment](Deployment.md)         | Docker/Podman setup, CI/CD pipeline, secrets            |
| [Frontend](Frontend.md)             | Routes, key components, state management                |

## Quick Start (Development)

```bash
# Clone and start
git clone https://github.com/cheloim/perExp.git
cd perExp

# Create secrets file
cp .env.example .env  # Edit with your values

# Start with Podman
podman-compose up -d

# Access
# Frontend: http://localhost:8082
# Backend:  http://localhost:8001
# API docs: http://localhost:8001/docs
```

## Tech Stack

| Layer        | Technology                                      |
| ------------ | ----------------------------------------------- |
| Backend      | Python 3.13, FastAPI, SQLAlchemy 2, Pydantic v2 |
| Database     | PostgreSQL 16                                   |
| Cache/Broker | Redis 7                                         |
| Frontend     | React 18, TypeScript, Vite, TanStack Query v5   |
| AI/LLM       | Google Gemini Flash                             |
| Task Queue   | Celery + Redis                                  |
| Telegram     | python-telegram-bot                             |
| Charts       | Recharts                                        |
| Email        | Resend API                                      |

## Project Structure

```
creditCardAnalyzer/
├── backend/
│   ├── app/
│   │   ├── models.py          # SQLAlchemy models (13 entities)
│   │   ├── routers/           # 14 API routers
│   │   ├── services/          # Business logic (auth, import, analysis)
│   │   ├── tasks/             # Celery tasks (import, cleanup, scheduled)
│   │   ├── telegram_bot.py    # @NikoFin_bot (15 conversation states)
│   │   └── prompts.py         # LLM prompt templates
│   ├── migrations/            # Alembic DB migrations
│   └── Dockerfile             # Multi-stage production build
├── frontend/
│   ├── src/
│   │   ├── components/        # Reusable UI components
│   │   ├── pages/             # Route-level page components
│   │   ├── context/           # React contexts (Theme, Notifications, etc.)
│   │   ├── api/               # API client functions
│   │   └── types/             # TypeScript interfaces
│   └── Dockerfile             # Multi-stage production build
├── docs/                      # This documentation
├── podman-compose.yml         # Development orchestration
└── .github/workflows/ci.yml   # CI/CD pipeline
```
