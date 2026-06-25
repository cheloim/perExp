import os

from celery import Celery

celery_app = Celery(
    "credit_card_analyzer",
    broker=os.getenv("REDIS_URL", "redis://localhost:6379/0"),
    backend=os.getenv("REDIS_URL", "redis://localhost:6379/0"),
)
celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="America/Argentina/Buenos_Aires",
    enable_utc=True,
    task_track_started=True,
    task_time_limit=600,
    # Memory protection: restart worker after 100 tasks to reclaim leaked memory
    worker_max_tasks_per_child=100,
    # Expire task results after 1 hour to prevent Redis memory accumulation
    result_expires=3600,
    # Prefetch 1 task at a time (heavy import tasks can use 10MB+ memory each)
    prefetch_multiplier=1,
    # Acknowledge tasks only after completion (enables retry on worker failure)
    task_acks_late=True,
    task_reject_on_worker_lost=True,
)
celery_app.autodiscover_tasks(["app.tasks"])

import app.celery_schedule  # noqa: F401 - loads beat schedule
