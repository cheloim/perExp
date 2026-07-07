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
    "daily-uncategorized-expenses": {
        "task": "app.tasks.daily_uncategorized.daily_uncategorized_check",
        "schedule": crontab(hour=11, minute=0),  # 08:00 UTC-3 = 11:00 UTC
    },
    "send-weekly-reports-sunday": {
        "task": "app.tasks.weekly_summary.send_weekly_reports",
        "schedule": crontab(hour=23, minute=0, day_of_week="sunday"),  # 20:00 UTC-3 = 23:00 UTC
    },
    "generate-monthly-reports": {
        "task": "app.tasks.monthly_report.generate_monthly_reports",
        "schedule": crontab(hour=23, minute=0, day_of_month="1"),  # 20:00 UTC-3 = 23:00 UTC
    },
}
