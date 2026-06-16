from celery.schedules import crontab

from app.celery_app import celery_app

celery_app.conf.beat_schedule = {
    "execute-due-installments-daily": {
        "task": "app.tasks.scheduled_expenses.execute_due_installments",
        "schedule": crontab(hour=2, minute=0),
    },
    "cleanup-expired-import-jobs-daily": {
        "task": "app.tasks.cleanup_import_jobs.cleanup_expired_import_jobs",
        "schedule": crontab(hour=3, minute=30),
    },
}
