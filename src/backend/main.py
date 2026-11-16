import asyncio
import logging
import os
import threading
from contextlib import asynccontextmanager

from dotenv import load_dotenv

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BACKEND_DIR, ".env"))

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


from app.log_filters import RedactPiiFilter, RedactQueryFilter, SuppressHealthFilter

# Keep internal probe noise and user content (query strings) out of the
# uvicorn access log
logging.getLogger("uvicorn.access").addFilter(RedactQueryFilter())
logging.getLogger("uvicorn.access").addFilter(SuppressHealthFilter())
for _root_handler in logging.getLogger().handlers:
    _root_handler.addFilter(RedactPiiFilter())

from app.services.platform_log_handler import PlatformLogHandler

_platform_log_handler = PlatformLogHandler()
logging.getLogger().addHandler(_platform_log_handler)

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

import app.models  # noqa: F401 — runs migrations on import
from app.database import SessionLocal
from app.metrics import install_metrics
from app.models import Category, User
from app.routers import (
    accounts,
    admin,
    admin_categorization,
    analysis,
    auth,
    budgets,
    capture,
    card_closings,
    cards,
    categories,
    dashboard,
    expenses,
    fx,
    groups,
    health,
    import_jobs,
    investments,
    mfa,
    notifications,
    recurring,
    scheduled_expenses,
    suggestions,
    tags,
    whatsapp_webhook,
)
from app.scheduler import price_refresh_loop
from app.seed import _apply_base_hierarchy


@asynccontextmanager
async def lifespan(application: FastAPI):
    # El esquema lo maneja Alembic (`alembic upgrade head`), no el arranque de
    # la app: create_all no altera columnas existentes y hace DDL en cada boot.
    # En dev lo corre docker-entrypoint.sh con RUN_MIGRATIONS_ON_START=1.

    # Validate SECRET_KEY length
    secret_key = os.getenv("SECRET_KEY", "")
    if len(secret_key) < 32:
        raise RuntimeError(
            "SECRET_KEY must be at least 32 characters. "
            'Generate one with: python -c "import secrets; print(secrets.token_urlsafe(64))"'
        )

    # Verify SECRET_KEY can encrypt/decrypt (fail fast)
    from app.services.encryption import verify_key_works

    if not verify_key_works():
        logger.error("SECRET_KEY cannot encrypt/decrypt! Check that the key hasn't changed.")
        raise RuntimeError("SECRET_KEY is invalid - cannot encrypt/decrypt data. Aborting.")

    # An unsigned WhatsApp webhook lets anyone forge incoming messages. In
    # production the Meta app secret is mandatory whenever WhatsApp is enabled.
    if os.getenv("APP_ENV") == "production":
        whatsapp_enabled = bool(
            os.getenv("WHATSAPP_TOKEN") or os.getenv("WHATSAPP_VERIFY_TOKEN")
        )
        if whatsapp_enabled and not os.getenv("WHATSAPP_APP_SECRET"):
            raise RuntimeError(
                "WHATSAPP_APP_SECRET is required when WhatsApp is enabled in production"
            )

    db = SessionLocal()
    if db.query(Category).count() == 0:
        _apply_base_hierarchy(db)

    # No default administrator is created on boot. A known default credential
    # in the lifespan is a backdoor on every fresh install; admins are created
    # explicitly with `python -m scripts.create_admin`.
    db.commit()

    # Auto-verify existing users created before email verification was added
    unverified = db.query(User).filter(User.email_verified == False).all()  # noqa: E712
    if unverified:
        for u in unverified:
            u.email_verified = True
        db.commit()
        logging.getLogger(__name__).info(f"Auto-verified {len(unverified)} existing users")

    db.close()

    task = asyncio.create_task(price_refresh_loop())

    telegram_token = os.getenv("TELEGRAM_BOT_TOKEN")
    bot_enabled = os.getenv("TELEGRAM_BOT_ENABLED", "true").lower() in ("true", "1", "yes")
    if telegram_token and bot_enabled:
        from app.telegram_bot import start_bot

        threading.Thread(
            target=start_bot, args=(telegram_token,), daemon=True, name="telegram-bot"
        ).start()
        logging.getLogger(__name__).info("Telegram bot thread started")
    elif telegram_token and not bot_enabled:
        logging.getLogger(__name__).info("Telegram bot disabled via TELEGRAM_BOT_ENABLED=false")
    else:
        logging.getLogger(__name__).warning("TELEGRAM_BOT_TOKEN not set — bot disabled")

    yield

    task.cancel()
    import contextlib

    with contextlib.suppress(asyncio.CancelledError):
        await task


app = FastAPI(
    title="Oikonomia API",
    version="1.0.0",
    description=(
        "Personal/family finance management API. "
        "Features: expense tracking, card/account management, hierarchical categories, "
        "AI-powered import (PDF/CSV/XLSX), investment portfolio, budgets, "
        "Telegram/WhatsApp bots, family groups, and more."
    ),
    servers=[
        {"url": "http://localhost:8001", "description": "Development"},
        {"url": "https://platform.oikonomia.ar", "description": "Production"},
    ],
    openapi_tags=[
        {"name": "auth", "description": "Authentication, registration, OAuth, password reset"},
        {"name": "mfa", "description": "Multi-factor authentication (TOTP)"},
        {"name": "accounts", "description": "Cash and bank account CRUD"},
        {"name": "cards", "description": "Credit and debit card CRUD"},
        {"name": "categories", "description": "Hierarchical expense category management"},
        {"name": "card-closings", "description": "Card billing period closing/due dates"},
        {"name": "expenses", "description": "Expense CRUD, bulk operations, filtering"},
        {"name": "investments", "description": "Investment portfolio tracking (IOL/PPI)"},
        {"name": "fx", "description": "USD/ARS exchange rate resolution"},
        {"name": "import-jobs", "description": "PDF/CSV/XLSX bank statement import pipeline"},
        {"name": "dashboard", "description": "Dashboard summaries, charts, and reports"},
        {"name": "analysis", "description": "AI-powered spending analysis"},
        {"name": "capture", "description": "AI voice transcription and payment-proof extraction"},
        {"name": "groups", "description": "Family group management and invite system"},
        {"name": "notifications", "description": "SSE real-time notification streaming"},
        {"name": "scheduled-expenses", "description": "Recurring and scheduled expense management"},
        {"name": "budgets", "description": "Budget management with 50/30/20 groups"},
        {"name": "suggestions", "description": "AI category auto-suggestions"},
        {"name": "recurring", "description": "Auto-detected recurring expense patterns"},
        {"name": "admin", "description": "Admin panel: user management, audit logs, impersonation"},
        {"name": "whatsapp", "description": "WhatsApp webhook for expense logging"},
    ],
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        origin.strip()
        for origin in os.getenv(
            "CORS_ORIGINS", "http://localhost:5173,http://localhost:8082"
        ).split(",")
        if origin.strip()
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type", "X-ImpersonationToken"],
)


@app.middleware("http")
async def security_and_seo_headers(request: Request, call_next):
    response = await call_next(request)
    # Security headers on all responses
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["X-XSS-Protection"] = "0"  # Modern browsers: CSP instead
    # Admin SEO headers
    if request.url.path.startswith("/x/"):
        response.headers["X-Robots-Tag"] = "noindex"
        response.headers["Cache-Control"] = "no-store"
    return response


install_metrics(app)

app.include_router(health.router)
app.include_router(auth.router)
app.include_router(mfa.router)
app.include_router(accounts.router)
app.include_router(cards.router)
app.include_router(categories.router)
app.include_router(card_closings.router)
app.include_router(expenses.router)
app.include_router(investments.router)
app.include_router(fx.router)
app.include_router(import_jobs.router)
app.include_router(dashboard.router)
app.include_router(analysis.router)
app.include_router(capture.router)
app.include_router(groups.router)
app.include_router(notifications.router)
app.include_router(scheduled_expenses.router)
app.include_router(budgets.router)
app.include_router(suggestions.router)
app.include_router(recurring.router)
app.include_router(tags.router)
app.include_router(admin.router)
app.include_router(admin_categorization.router)
app.include_router(whatsapp_webhook.router)
