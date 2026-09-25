"""In-memory metrics middleware and Prometheus exposition for the admin panel."""

import logging
import threading
import time
from collections import deque
from datetime import UTC, datetime, timedelta

from fastapi import FastAPI, Request
from prometheus_client import (
    CONTENT_TYPE_LATEST,
    REGISTRY,
    Counter,
    Gauge,
    Histogram,
    generate_latest,
)
from starlette.responses import Response

logger = logging.getLogger(__name__)

# ── Prometheus counters / histograms ──────────────────────────

REQUEST_COUNT = Counter(
    "http_requests_total",
    "Total HTTP requests",
    ["method", "endpoint", "status"],
)

REQUEST_LATENCY = Histogram(
    "http_request_duration_seconds",
    "Request latency in seconds",
    ["method", "endpoint"],
    buckets=(0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0),
)

# ── Business metrics (gauges updated on scrape) ──────────────

USERS_TOTAL = Gauge("oikonomia_users_total", "Total registered users")
ACTIVE_USERS = Gauge("oikonomia_active_users_total", "Active users in last 24h")
EXPENSES_TOTAL = Gauge("oikonomia_expenses_total", "Total expenses", ["user_id"])
ACCOUNTS_TOTAL = Gauge("oikonomia_accounts_total", "Total accounts", ["user_id", "type"])
CARDS_TOTAL = Gauge("oikonomia_cards_total", "Total cards", ["user_id", "type"])
CATEGORIES_TOTAL = Gauge("oikonomia_categories_total", "Total categories")
INVESTMENTS_TOTAL = Gauge("oikonomia_investments_total", "Total investments", ["user_id"])
IMPORT_JOBS_TOTAL = Gauge("oikonomia_import_jobs_total", "Import jobs by status", ["status"])
SCHEDULED_EXPENSES_TOTAL = Gauge(
    "oikonomia_scheduled_expenses_total", "Scheduled expenses by status", ["status"]
)
RECURRING_EXPENSES_TOTAL = Gauge(
    "oikonomia_recurring_expenses_total", "Recurring expenses", ["user_id"]
)
BUDGET_GROUPS_TOTAL = Gauge("oikonomia_budget_groups_total", "Budget groups", ["user_id", "group"])

# ── Service health metrics ─────────────────────────────────

TELEGRAM_BOT_HEALTH = Gauge(
    "oikonomia_telegram_bot_healthy",
    "Whether the Telegram bot thread is running (1=healthy, 0=down)",
)

CELERY_WORKER_HEALTH = Gauge(
    "oikonomia_celery_worker_healthy",
    "Whether celery workers are reachable (1=healthy, 0=down)",
)

# ── Business counters (incremented on events) ────────────────

LOGIN_ATTEMPTS = Counter(
    "oikonomia_login_attempts_total",
    "Login attempts",
    ["method", "status"],
)

EXPENSES_CREATED = Counter(
    "oikonomia_expenses_created_total",
    "Expenses created",
    ["user_id"],
)

TELEGRAM_MESSAGES = Counter(
    "oikonomia_telegram_messages_total",
    "Telegram messages",
    ["direction"],
)

WHATSAPP_MESSAGES = Counter(
    "oikonomia_whatsapp_messages_total",
    "WhatsApp messages",
    ["direction"],
)

IMPORT_ROWS_PROCESSED = Counter(
    "oikonomia_import_rows_processed_total",
    "Import rows processed",
    ["user_id"],
)

# ── Business metrics update (on scrape) ──────────────────────

_business_metrics_lock = threading.Lock()
_business_metrics_last_update = 0.0
_BUSINESS_METRICS_TTL = 15.0  # seconds


def update_business_metrics() -> None:
    """Update business gauge metrics from the database. Called on /metrics scrape."""
    global _business_metrics_last_update

    now = time.time()
    if now - _business_metrics_last_update < _BUSINESS_METRICS_TTL:
        return
    if not _business_metrics_lock.acquire(blocking=False):
        return

    try:
        from sqlalchemy import func

        from app.database import SessionLocal
        from app.models import (
            Account,
            BudgetGroup,
            Card,
            Category,
            Expense,
            ImportJob,
            Investment,
            RecurringExpense,
            ScheduledExpense,
            User,
        )

        db = SessionLocal()
        try:
            cutoff_24h = datetime.now(UTC) - timedelta(hours=24)

            # Users
            USERS_TOTAL.set(db.query(User).count())
            ACTIVE_USERS.set(
                db.query(User)
                .filter(User.last_login.isnot(None), User.last_login > cutoff_24h)
                .count()
            )

            # Categories
            CATEGORIES_TOTAL.set(db.query(Category).count())

            # Per-user metrics
            users = db.query(User.id).all()
            for (user_id,) in users:
                uid = str(user_id)

                EXPENSES_TOTAL.labels(user_id=uid).set(
                    db.query(Expense).filter(Expense.user_id == user_id).count()
                )
                INVESTMENTS_TOTAL.labels(user_id=uid).set(
                    db.query(Investment).filter(Investment.user_id == user_id).count()
                )
                RECURRING_EXPENSES_TOTAL.labels(user_id=uid).set(
                    db.query(RecurringExpense).filter(RecurringExpense.user_id == user_id).count()
                )

                # Accounts by type
                account_types = (
                    db.query(Account.type, func.count())
                    .filter(Account.user_id == user_id)
                    .group_by(Account.type)
                    .all()
                )
                for atype, count in account_types:
                    ACCOUNTS_TOTAL.labels(user_id=uid, type=atype or "unknown").set(count)

                # Cards by type
                card_types = (
                    db.query(Card.card_type, func.count())
                    .filter(Card.user_id == user_id)
                    .group_by(Card.card_type)
                    .all()
                )
                for ctype, count in card_types:
                    CARDS_TOTAL.labels(user_id=uid, type=ctype or "unknown").set(count)

                # Budget groups
                budget_groups = (
                    db.query(BudgetGroup.name, func.count())
                    .filter(BudgetGroup.user_id == user_id)
                    .group_by(BudgetGroup.name)
                    .all()
                )
                for bname, count in budget_groups:
                    BUDGET_GROUPS_TOTAL.labels(user_id=uid, group=bname).set(count)

            # Import jobs by status
            import_statuses = (
                db.query(ImportJob.status, func.count()).group_by(ImportJob.status).all()
            )
            for istatus, count in import_statuses:
                IMPORT_JOBS_TOTAL.labels(status=istatus).set(count)

            # Scheduled expenses by status
            sched_statuses = (
                db.query(ScheduledExpense.status, func.count())
                .group_by(ScheduledExpense.status)
                .all()
            )
            for sstatus, count in sched_statuses:
                SCHEDULED_EXPENSES_TOTAL.labels(status=sstatus).set(count)

            # Service health checks
            # Telegram bot: check if the bot thread is alive
            bot_thread_alive = any(
                t.name == "telegram-bot" and t.is_alive() for t in threading.enumerate()
            )
            TELEGRAM_BOT_HEALTH.set(1 if bot_thread_alive else 0)

            # Celery: check if workers respond (ping is lighter than active)
            try:
                from app.celery_app import celery_app

                inspect = celery_app.control.inspect(timeout=5.0)
                ping = inspect.ping()
                CELERY_WORKER_HEALTH.set(1 if ping else 0)
            except Exception:
                CELERY_WORKER_HEALTH.set(0)

            _business_metrics_last_update = time.time()
        finally:
            db.close()
    except Exception:
        logger.exception("Failed to update business metrics")
    finally:
        _business_metrics_lock.release()


# ── In-memory ring buffer for admin UI ────────────────────────

_MAX_HISTORY = 1000  # last N requests kept


class _MetricsState:
    """Thread-safe in-memory metrics ring buffer (no persistence, no per-user data)."""

    def __init__(self, maxlen: int = _MAX_HISTORY) -> None:
        self.lock = threading.Lock()
        self.history: deque[dict] = deque(maxlen=maxlen)
        self.total = 0
        self.errors = 0  # 4xx + 5xx

    def record(self, method: str, path: str, status: int, duration_ms: float) -> None:
        ts = int(time.time())
        with self.lock:
            self.history.append({"m": method, "p": path, "s": status, "d": duration_ms, "t": ts})
            self.total += 1
            if status >= 400:
                self.errors += 1

    def summary(self, window: int = 300) -> dict:
        """Return aggregated counts for the last *window* seconds."""
        cutoff = int(time.time()) - window
        with self.lock:
            recent = [e for e in self.history if e["t"] >= cutoff]
        count = len(recent)
        errs = sum(1 for e in recent if e["s"] >= 400)
        latencies = sorted(e["d"] for e in recent)
        p50 = latencies[len(latencies) // 2] if latencies else 0
        p95 = latencies[int(len(latencies) * 0.95)] if latencies else 0
        p99 = latencies[int(len(latencies) * 0.99)] if latencies else 0
        return {
            "window_seconds": window,
            "request_count": count,
            "error_count": errs,
            "error_rate": round(errs / count * 100, 2) if count else 0,
            "p50_ms": round(p50, 2),
            "p95_ms": round(p95, 2),
            "p99_ms": round(p99, 2),
            "throughput_rpm": round(count / window * 60, 1) if window else 0,
        }


_metrics = _MetricsState()

# ── Middleware (injected in main.py) ──────────────────────────

_PATH_EXCLUDES = ("/metrics", "/health", "/docs", "/openapi.json", "/redoc")


def _metrics_middleware_factory():
    """Return an ASGI middleware that records request metrics."""

    async def _middleware(request: Request, call_next):
        # Skip noisy internal paths
        path = request.url.path
        if any(path.startswith(ex) for ex in _PATH_EXCLUDES):
            return await call_next(request)

        method = request.method
        start = time.perf_counter()
        response = await call_next(request)
        duration = (time.perf_counter() - start) * 1000  # ms
        status = response.status_code

        # Prometheus
        endpoint = path
        REQUEST_COUNT.labels(method=method, endpoint=endpoint, status=status).inc()
        REQUEST_LATENCY.labels(method=method, endpoint=endpoint).observe(duration / 1000)

        # In-memory buffer (for admin UI)
        _metrics.record(method, path, status, duration)
        return response

    return _middleware


def install_metrics(app: FastAPI) -> None:
    """Mount the metrics middleware and /metrics endpoint on *app*."""
    from starlette.middleware.base import BaseHTTPMiddleware

    app.add_middleware(BaseHTTPMiddleware, dispatch=_metrics_middleware_factory())

    @app.get("/metrics", include_in_schema=False)
    async def prometheus_metrics():
        update_business_metrics()
        return Response(content=generate_latest(REGISTRY), media_type=CONTENT_TYPE_LATEST)


# ── Admin helpers (used by admin.py) ─────────────────────────


def get_usage_stats(window: int = 86400) -> dict:
    """Aggregated request/error stats for the last *window* seconds."""
    return _metrics.summary(window=window)
