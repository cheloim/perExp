"""Unauthenticated health check endpoints for load balancers and orchestrators.

- GET /health       → Liveness (process is alive, always 200)
- GET /health/ready → Readiness (DB, Redis, Celery, Bots — 503 if critical services down)
"""

import logging
import time
from datetime import UTC, datetime

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import get_db

logger = logging.getLogger(__name__)

router = APIRouter(tags=["health"])

# Track when the process started
_start_time = time.time()


# ── Liveness: always 200 if process is alive ──────────────────


@router.get("/health", summary="Liveness check")
def health_check():
    """Liveness probe — always returns 200 if the process is running.

    Use for: container orchestrator liveness probe, uptime monitoring.
    Does NOT check dependencies (DB, Redis, etc).
    """
    from main import app

    return {
        "status": "healthy",
        "version": app.version,
        "uptime_seconds": int(time.time() - _start_time),
        "timestamp": datetime.now(UTC).isoformat(),
    }


# ── Readiness: check critical dependencies ────────────────────


@router.get("/health/ready", summary="Readiness check")
def health_ready(db: Session = Depends(get_db)):
    """Readiness probe — checks if the service can handle requests.

    Returns 200 if all critical services are healthy or degraded.
    Returns 503 if critical services (DB, Redis, Celery) are down.

    Use for: load balancer readiness, blackbox exporter.
    """
    from main import app

    checks = {}
    critical_ok = True

    # Database
    db_start = time.time()
    try:
        db.execute(text("SELECT 1"))
        checks["database"] = {"status": "ok", "latency_ms": int((time.time() - db_start) * 1000)}
    except Exception as e:
        logger.warning("Health check: DB unreachable: %s", e)
        checks["database"] = {"status": "error", "detail": str(e)}
        critical_ok = False

    # Redis
    redis_start = time.time()
    try:
        from app.services.rate_limit import _get_redis

        r = _get_redis()
        r.ping()
        checks["redis"] = {"status": "ok", "latency_ms": int((time.time() - redis_start) * 1000)}
    except Exception as e:
        logger.warning("Health check: Redis unreachable: %s", e)
        checks["redis"] = {"status": "error", "detail": str(e)}
        critical_ok = False

    # Celery workers
    try:
        from app.celery_app import celery_app

        inspector = celery_app.control.inspect(timeout=2.0)
        ping = inspector.ping() or {}
        worker_count = len(ping)
        if worker_count > 0:
            checks["celery_workers"] = {
                "status": "ok",
                "worker_count": worker_count,
                "workers": list(ping.keys()),
            }
        else:
            checks["celery_workers"] = {"status": "error", "worker_count": 0}
            critical_ok = False
    except Exception as e:
        logger.warning("Health check: Celery unreachable: %s", e)
        checks["celery_workers"] = {"status": "error", "detail": str(e)}
        critical_ok = False

    # Celery Beat (via Redis heartbeat)
    try:
        from app.services.rate_limit import _get_redis

        r = _get_redis()
        heartbeat = r.get("celery_beat:heartbeat")
        if heartbeat:
            beat_ts = heartbeat.decode() if isinstance(heartbeat, bytes) else heartbeat
            checks["celery_beat"] = {"status": "ok", "last_heartbeat": beat_ts}
        else:
            checks["celery_beat"] = {"status": "unknown", "detail": "No heartbeat found"}
    except Exception:
        checks["celery_beat"] = {"status": "unknown"}

    # Telegram bot (thread alive or Redis heartbeat)
    bot_alive = any(
        t.name == "telegram-bot" and t.is_alive() for t in __import__("threading").enumerate()
    )
    if bot_alive:
        checks["telegram_bot"] = {"status": "ok", "thread_alive": True}
    else:
        try:
            from app.services.rate_limit import _get_redis

            r = _get_redis()
            heartbeat = r.get("bot:heartbeat")
            if heartbeat:
                checks["telegram_bot"] = {"status": "ok", "source": "redis_heartbeat"}
            else:
                checks["telegram_bot"] = {"status": "down"}
        except Exception:
            checks["telegram_bot"] = {"status": "down"}

    # Determine overall status
    if critical_ok:
        # Check if any optional service is down
        optional_down = any(
            checks.get(s, {}).get("status") in ("down", "unknown")
            for s in ["celery_beat", "telegram_bot"]
        )
        status = "degraded" if optional_down else "healthy"
        status_code = 200
    else:
        status = "unhealthy"
        status_code = 503

    return JSONResponse(
        content={
            "status": status,
            "version": app.version,
            "timestamp": datetime.now(UTC).isoformat(),
            "checks": checks,
        },
        status_code=status_code,
    )
