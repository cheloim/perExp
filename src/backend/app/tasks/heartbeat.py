"""Celery Beat heartbeat — writes timestamp to Redis so health checks can verify beat is alive."""

import os
from datetime import UTC, datetime

import redis

from app.celery_app import celery_app


@celery_app.task(name="celery-beat-heartbeat")
def beat_heartbeat():
    """Write current timestamp to Redis.

    Health check reads this key — if older than 2 minutes, beat is considered down.
    """
    try:
        r = redis.from_url(os.getenv("REDIS_URL", "redis://localhost:6379/0"))
        r.set("celery_beat:heartbeat", datetime.now(UTC).isoformat(), ex=120)
        r.close()
    except Exception:
        pass  # Best effort — don't fail the beat scheduler