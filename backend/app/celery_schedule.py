import os

from celery.schedules import crontab

from app.celery_app import celery_app


def _cron_from_env(env_key: str, default_hour: int, default_minute: int, **kwargs):
    """Parse a crontab from env var (format: 'H:M' or 'H:M:dow' or 'H:M:dow:dom')."""
    val = os.getenv(env_key)
    if val:
        parts = val.split(":")
        hour = int(parts[0])
        minute = int(parts[1]) if len(parts) > 1 else 0
        kwargs["day_of_week"] = parts[2] if len(parts) > 2 else None
        kwargs["day_of_month"] = parts[3] if len(parts) > 3 else None
        # Filter out None values
        kwargs = {k: v for k, v in kwargs.items() if v is not None}
        return crontab(hour=hour, minute=minute, **kwargs)
    return crontab(hour=default_hour, minute=default_minute, **kwargs)


celery_app.conf.beat_schedule = {
    "execute-due-installments-daily": {
        "task": "app.tasks.scheduled_expenses.execute_due_installments",
        "schedule": _cron_from_env("SCHEDULE_DUE_INSTALLMENTS", 2, 0),
    },
    "cleanup-expired-import-jobs-daily": {
        "task": "app.tasks.cleanup_import_jobs.cleanup_expired_import_jobs",
        "schedule": _cron_from_env("SCHEDULE_CLEANUP", 3, 30),
    },
    "daily-uncategorized-expenses": {
        "task": "app.tasks.daily_uncategorized.daily_uncategorized_check",
        "schedule": _cron_from_env("SCHEDULE_UNCATEGORIZED", 11, 0),
    },
    "send-weekly-reports-sunday": {
        "task": "app.tasks.weekly_summary.send_weekly_reports",
        "schedule": _cron_from_env("SCHEDULE_WEEKLY_REPORTS", 1, 30, day_of_week="monday"),
    },
    "generate-monthly-reports": {
        "task": "app.tasks.monthly_report.generate_monthly_reports",
        "schedule": _cron_from_env("SCHEDULE_MONTHLY_REPORTS", 3, 0, day_of_month="1"),
    },
    "suggest-uncategorized-categories-daily": {
        "task": "app.tasks.suggest_uncategorized.suggest_uncategorized_categories",
        "schedule": _cron_from_env("SCHEDULE_SUGGEST_CATEGORIES", 2, 0),
    },
}
