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
)
celery_app.autodiscover_tasks(["app.tasks"])

import app.celery_schedule  # noqa: F401 - loads beat schedule