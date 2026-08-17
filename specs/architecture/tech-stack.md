# Technology Stack — Oikonomia (Credit Card Analyzer)

## Backend

| Technology | Version | Purpose | Why Chosen |
|---|---|---|---|
| **FastAPI** | 0.115.4 | Web framework / API server | Async support, auto OpenAPI docs, Pydantic integration, high performance |
| **Uvicorn** | 0.32.0 | ASGI server | Native async, hot reload for dev, production-grade |
| **SQLAlchemy** | 2.0.36 | ORM + database toolkit | Mature, powerful query builder, migration support via Alembic |
| **Pydantic** | 2.9.2 | Data validation / serialization | Type-safe schemas, FastAPI native integration, v2 performance |
| **PostgreSQL** | 16 (Alpine) | Primary database | ACID compliance, JSON support, encryption at rest, proven reliability |
| **Redis** | 7 (Alpine) | Cache + Celery broker + SSE | In-memory speed, pub/sub for SSE, reliable message broker |
| **Celery** | 5.4+ | Distributed task queue | Async imports, scheduled reports, background processing |
| **APScheduler** | 3.11.2 | Investment price refresh scheduler | Lightweight, cron-like scheduling inside FastAPI process |
| **python-telegram-bot** | 21+ | Telegram bot integration | Async API, conversation handler, well-maintained |
| **pdfplumber** | 0.11+ | PDF parsing for bank statements | Extracts tables from credit card PDFs accurately |
| **Playwright** | 1.61+ | PDF report generation | Renders Jinja2 HTML templates to PDF/PNG via headless browser |
| **Jinja2** | 3.1+ | HTML template engine | Monthly/weekly report templates, email templates |
| **Resend** | 2.0+ | Transactional email delivery | Simple API, good deliverability, password recovery emails |
| **PyJWT** | (via python-jose 3.3+) | JWT token management | Stateless auth, API tokens, impersonation tokens |
| **bcrypt** | 4.0+ | Password hashing | Industry standard, adaptive cost factor |
| **pyotp** | 2.9+ | TOTP MFA | RFC 6238 compliant, Google Authenticator compatible |
| **slowapi** | 0.1.9+ | API rate limiting | Prevents brute force, per-endpoint limits |
| **google-genai** | 1.0+ | LLM integration (Gemini) | Expense analysis, category suggestions, AI chat |
| **ppi-client** | 1.2.4+ | PPI broker API | Investment price fetching for ARS market |
| **Alembic** | 1.13+ | Database migrations | Version-controlled schema changes |
| **pandas** | 2.2.3+ | Data processing | CSV/Excel parsing, data transformation for imports |
| **python-dotenv** | 1.0.1 | Environment variable loading | `.env` file support for local development |
| **httpx** | 0.27+ | Async HTTP client | IOL broker API, external service calls |
| **qrcode** | 7.4+ | QR code generation | MFA setup QR codes for authenticator apps |
| **email-validator** | 2.0+ | Email validation | Pydantic email field validation |

## Frontend

| Technology | Version | Purpose | Why Chosen |
|---|---|---|---|
| **React** | 18.3.1 | UI framework | Component model, ecosystem, concurrent features |
| **Vite** | 5.4+ | Build tool / dev server | Instant HMR, fast builds, native ESM |
| **TypeScript** | 5.6+ | Type system | Catch errors at compile time, better IDE support |
| **TanStack Query** | 5.59+ | Server state management | Caching, background refetch, optimistic updates |
| **Axios** | 1.7.7 | HTTP client | Interceptors for auth, request/response transformation |
| **Recharts** | 2.13.3 | Charting library | Declarative charts, responsive, React-native API |
| **React Router** | 7.14+ | Client-side routing | SPA navigation, nested routes, lazy loading |
| **date-fns** | 4.1+ | Date utilities | Tree-shakeable, immutable, locale support (es) |
| **Tailwind CSS** | 3.4+ | Utility-first CSS | Rapid UI development, consistent design system |
| **Prettier** | 3.8.4 | Code formatter | Consistent style across team |
| **ESLint** | 10.5+ | Linter | Catches bugs, enforces rules |
| **d3-hierarchy** | 3.1.2 | Treemap / sunburst layouts | Category spending visualization |
| **react-day-picker** | 9.14+ | Date picker component | Accessible, customizable calendar |
| **react-joyride** | 3.2+ | Onboarding tours | Guided first-use experience |
| **autoprefixer** | 10.5+ | CSS vendor prefixes | Browser compatibility |
| **PostCSS** | 8.5+ | CSS processing | Tailwind integration, CSS transforms |

## Infrastructure

| Technology | Version | Purpose | Why Chosen |
|---|---|---|---|
| **Podman** | latest | Container runtime (dev) | Rootless containers, Docker-compatible, daemonless |
| **PostgreSQL** | 16 Alpine | Database container | Minimal image size, production-ready |
| **Redis** | 7 Alpine | Cache/broker container | Minimal image, persistent volumes |
| **GitHub Actions** | — | CI/CD pipeline | Native GitHub integration, free for public repos |
| **Linode** | — | VPS hosting | Cost-effective, reliable, simple deployment |
| **nginx** | — | Reverse proxy + static files | SSL termination, frontend serving, rate limiting |
| **certbot** | — | Let's Encrypt SSL | Automated certificate renewal |
| **Podman Compose** | — | Multi-container orchestration | Dev environment, volume mounts for hot reload |

## CI/CD Pipeline

| Workflow | Trigger | Purpose |
|---|---|---|
| `ci.yml` | Push / PR to main | Lint, typecheck, test |
| `deploy.yml` | Push to main | Deploy to Linode via SSH |
| `wiki-sync.yml` | Push to main | Sync docs to GitHub Wiki |

## Development Tools

| Tool | Purpose |
|---|---|
| **pre-commit** | Git hooks for linting/formatting |
| **ruff** | Python linter (fast, Rust-based) |
| **mypy** | Python type checking |
| **Podman secrets** | Secure credential management in containers |
