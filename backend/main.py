import asyncio
import logging
import os
import threading
from contextlib import asynccontextmanager

from dotenv import load_dotenv

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BACKEND_DIR, ".env"))

logging.basicConfig(level=logging.INFO)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import app.models  # noqa: F401 — runs migrations on import
from app.database import SessionLocal
from app.models import Category, User
from app.scheduler import price_refresh_loop
from app.seed import _apply_base_hierarchy
from app.services.auth import get_password_hash
from app.routers import (
    accounts,
    analysis,
    auth,
    card_closings,
    cards,
    categories,
    dashboard,
    expenses,
    groups,
    import_,
    import_jobs,
    investments,
    notifications,
    scheduled_expenses,
)


@asynccontextmanager
async def lifespan(application: FastAPI):
    # Startup
    db = SessionLocal()
    if db.query(Category).count() == 0:
        _apply_base_hierarchy(db)

    seed_email = os.getenv("SEED_USER_EMAIL", "mmendoza0989@gmail.com")
    if not db.query(User).filter(User.email == seed_email).first():
        seed_user = User(
            email=seed_email,
            full_name=os.getenv("SEED_USER_NAME", "Admin"),
            hashed_password=get_password_hash(os.getenv("SEED_USER_PASSWORD", "changeme123")),
        )
        db.add(seed_user)
        db.flush()
        # Assign all existing rows to seed user
        from sqlalchemy import text as _t
        for _tbl in ("expenses", "investments", "analysis_history", "card_closings"):
            db.execute(_t(f"UPDATE {_tbl} SET user_id = :uid WHERE user_id IS NULL"), {"uid": seed_user.id})

    db.commit()
    db.close()

    task = asyncio.create_task(price_refresh_loop())

    telegram_token = os.getenv("TELEGRAM_BOT_TOKEN")
    if telegram_token:
        from app.telegram_bot import start_bot
        threading.Thread(target=start_bot, args=(telegram_token,), daemon=True, name="telegram-bot").start()
        logging.getLogger(__name__).info("Telegram bot thread started")
    else:
        logging.getLogger(__name__).warning("TELEGRAM_BOT_TOKEN not set — bot disabled")

    # Scheduled jobs
    from apscheduler.schedulers.background import BackgroundScheduler
    from app.tasks.scheduled_expenses import execute_due_installments
    from app.tasks.cleanup_import_jobs import cleanup_expired_import_jobs

    scheduler = BackgroundScheduler()
    scheduler.add_job(execute_due_installments, 'cron', hour=2, minute=0)  # 2:00 AM diario
    scheduler.add_job(cleanup_expired_import_jobs, 'cron', hour=3, minute=30)  # 3:30 AM diario
    scheduler.start()
    logging.getLogger(__name__).info("Scheduler started (scheduled expenses + import cleanup)")

    yield

    # Shutdown
    task.cancel()
    scheduler.shutdown()
    try:
        await task
    except asyncio.CancelledError:
        pass


app = FastAPI(title="Credit Card Analyzer API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:8082", "http://127.0.0.1:5173", "http://127.0.0.1:8082"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(accounts.router)
app.include_router(cards.router)
app.include_router(categories.router)
app.include_router(card_closings.router)
app.include_router(expenses.router)
app.include_router(investments.router)
app.include_router(import_.router)
app.include_router(import_jobs.router)
app.include_router(dashboard.router)
app.include_router(analysis.router)
app.include_router(groups.router)
app.include_router(notifications.router)
app.include_router(scheduled_expenses.router)
