"""Unauthenticated health check endpoint for load balancers and orchestrators."""

import logging

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import get_db

logger = logging.getLogger(__name__)

router = APIRouter(tags=["health"])


@router.get("/health", summary="Liveness / readiness check")
def health_check(db: Session = Depends(get_db)):
    """Lightweight health check — no auth required.

    Returns 200 if DB and Redis are reachable, 503 otherwise.
    """
    checks = {"database": False, "redis": False}
    ok = True

    # Database
    try:
        db.execute(text("SELECT 1"))
        checks["database"] = True
    except Exception as e:
        logger.warning("Health check: DB unreachable: %s", e)
        ok = False

    # Redis
    try:
        from app.services.rate_limit import _get_redis

        r = _get_redis()
        r.ping()
        checks["redis"] = True
    except Exception as e:
        logger.warning("Health check: Redis unreachable: %s", e)
        ok = False

    status_code = 200 if ok else 503
    return JSONResponse(
        content={"status": "healthy" if ok else "degraded", "checks": checks},
        status_code=status_code,
    )
