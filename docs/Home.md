# Oikonomia — Technical Documentation

**Oikonomia** is a personal finance management application with intelligent bank statement import, built primarily for Argentine users. It combines AI-powered expense tracking, investment portfolio monitoring, and family group sharing into a single platform, accessible via web, Telegram, and WhatsApp.

## What Problem Does It Solve?

Tracking personal finances across credit cards, bank accounts, and investments is tedious. Oikonomia automates this by:

- **Importing bank statements** (PDF, CSV, XLSX) using AI to parse transactions automatically
- **Categorizing expenses** with keyword-based auto-categorization and a hierarchical category tree
- **Tracking investments** synced with Argentine brokers (IOL, PPI) via Yahoo Finance
- **Logging expenses on-the-go** via Telegram and WhatsApp bots that understand natural language
- **Sharing finances** with family members through group invites
- **Managing budgets** with 50/30/20 macro groups and category-level limits

## Documentation

| Document                            | Description                                             |
| ----------------------------------- | ------------------------------------------------------- |
| [Architecture](Architecture.md)     | Tech stack, component diagram, how everything connects  |
| [Features](Features.md)             | Full feature list with descriptions                     |
| [Smart Import](Smart-Import.md)     | PDF/CSV/XLSX import pipeline (LLM, Redis queue, Celery) |
| [Telegram Bot](Telegram-Bot.md)     | Bot setup, conversation flow, all states                |
| [Data Model](Data-Model.md)         | All entities, relationships, key fields                 |
| [AI Integration](AI-Integration.md) | Proveedor LLM, parsing, análisis y costos                |
| [Family Groups](Family-Groups.md)   | Multi-user sharing, invite flow                         |
| [Investments](Investments.md)       | IOL/PPI sync, Yahoo Finance, price refresh scheduler    |
| [Authentication](Authentication.md) | JWT, Google OAuth, MFA, password reset                  |
| [Budgets](Budgets.md)               | 50/30/20 groups, temporal events, category budgets      |
| [API Reference](API-Reference.md)   | All routers and key endpoints                           |
| [Deployment](Deployment.md)         | Docker/Podman setup, CI/CD pipeline, secrets            |
| [Frontend](Frontend.md)             | Routes, key components, state management                |
| [Security](Security.md)             | Encryption, rate limiting, MFA, advisories              |
| [Configuración](Configuration.md)   | Variables de entorno, secretos, entornos                |
| [Design System](Design-System.md)   | Tokens, primitivas y reglas de UI                       |
| [Accesibilidad](Accessibility.md)   | Contrato WCAG 2.2 AA                                    |
| [Migraciones](Migrations.md)        | Política de esquema y expand/contract                   |
| [Matriz de autoridad](README.md)    | Qué documento es canónico por tema                      |
| [Auditoría 2026-10](https://github.com/cheloim/perExp/blob/main/docs/analysis/audit-2026-10/index.html) | Diagnóstico completo y plan de evolución |

## Quick Start (Development)

```bash
# Clone and start
git clone https://github.com/cheloim/perExp.git
cd perExp

# Configuración no secreta
cp .env.example .env  # completá POSTGRES_PASSWORD y POSTGRES_PASSWORD_DEV

# Secretos reales
./scripts/setup-secrets.sh dev

# Levantar
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
| AI/LLM       | OpenAI (default), Google para texto             |
| Task Queue   | Celery + Redis                                  |
| Telegram     | python-telegram-bot                             |
| WhatsApp     | Meta Cloud API                                  |
| Charts       | Recharts                                        |
| Email        | Resend API                                      |

## Project Structure

```
creditCardAnalyzer/
├── src/
│   ├── backend/
│   │   ├── app/
│   │   │   ├── models/            # SQLAlchemy models (28 tablas)
│   │   │   ├── routers/           # 23 API routers
│   │   │   ├── services/          # Business logic (auth, import, analysis, deletion)
│   │   │   ├── tasks/             # Celery tasks (import, cleanup, scheduled)
│   │   │   ├── telegram_bot.py    # @NikoFin_bot
│   │   │   ├── whatsapp_bot.py    # WhatsApp bot (Meta Cloud API)
│   │   │   └── prompts.py         # LLM prompt templates
│   │   ├── scripts/               # Migration and utility scripts
│   │   └── Dockerfile             # Multi-stage production build
│   └── frontend/
│       ├── src/
│       │   ├── components/        # Reusable UI components
│       │   ├── pages/             # Route-level page components
│       │   ├── context/           # React contexts (Theme, Notifications, etc.)
│       │   ├── api/               # API client functions
│       │   ├── hooks/             # Custom React hooks
│       │   └── types/             # TypeScript interfaces
│       └── Dockerfile             # Multi-stage production build
├── docs/                          # This documentation
├── .archify/                      # Architecture diagrams
├── podman-compose.yml             # Development orchestration
└── .github/workflows/ci.yml      # CI/CD pipeline
```
