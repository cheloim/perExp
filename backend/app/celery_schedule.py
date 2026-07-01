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
    "send-weekly-summary-sunday": {
        "task": "app.tasks.weekly_summary.send_weekly_summaries",
        "schedule": crontab(hour=20, minute=0, day_of_week="sunday"),
    },
    "generate-monthly-reports": {
        "task": "app.tasks.monthly_report.generate_monthly_reports",
        "schedule": crontab(hour=23, minute=0, day_of_month="1"),  # 20:00 UTC-3 = 23:00 UTC
    },
}
