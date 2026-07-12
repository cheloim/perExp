# Tasks package — import all task modules so celery autodiscovers them
import app.tasks.cleanup_import_jobs  # noqa: F401
import app.tasks.daily_uncategorized  # noqa: F401
import app.tasks.import_processor  # noqa: F401
import app.tasks.monthly_report  # noqa: F401
import app.tasks.scheduled_expenses  # noqa: F401
import app.tasks.suggest_uncategorized  # noqa: F401
import app.tasks.weekly_summary  # noqa: F401
