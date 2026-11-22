"""Admin use cases: platform health, settings, flags, logs and tasks."""

import json
import logging
import os

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.admin.common import _audit_admin, require_step_up
from app.database import engine, get_db
from app.models import Notification, PlatformLog, Setting, User
from app.services.auth import get_current_admin
from app.services.rate_limit import _get_redis

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get(
    "/system/health",
    summary="System health check",
    description="Check connectivity and status of Redis, PostgreSQL, Celery, Telegram bot, and app metrics.",
)
def system_health(admin: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    import time as _time

    from app.routers.health import _start_time

    result = {
        "version": "1.0.0",
        "uptime_seconds": int(_time.time() - _start_time),
        "environment": os.getenv("APP_ENV", "development"),
    }

    # Redis
    redis_ok = False
    redis_latency = 0
    redis_memory = None
    try:
        r = _get_redis()
        start = _time.time()
        r.ping()
        redis_latency = int((_time.time() - start) * 1000)
        redis_ok = True
        info = r.info("memory")
        redis_memory = info.get("used_memory_human")
    except Exception:
        pass

    # DB
    db_ok = False
    users_count = 0
    try:
        db.execute(text("SELECT 1"))
        users_count = db.query(User).count()
        db_ok = True
    except Exception:
        pass

    # Celery workers
    celery_workers = []
    try:
        from app.celery_app import celery_app

        inspector = celery_app.control.inspect(timeout=2.0)
        active = inspector.active() or {}
        celery_workers = list(active.keys())
    except Exception:
        pass

    # Celery Beat
    beat_status = "unknown"
    beat_heartbeat = None
    try:
        r = _get_redis()
        hb = r.get("celery_beat:heartbeat")
        if hb:
            beat_heartbeat = hb.decode() if isinstance(hb, bytes) else hb
            beat_status = "ok"
        else:
            beat_status = "no_heartbeat"
    except Exception:
        beat_status = "error"

    # Telegram bot
    bot_alive = any(
        t.name == "telegram-bot" and t.is_alive() for t in __import__("threading").enumerate()
    )
    bot_status = "running" if bot_alive else "not_running"

    # Metrics summary
    metrics_summary = {}
    try:
        from app.metrics import get_usage_stats

        metrics_summary = get_usage_stats(window=300)
    except Exception:
        pass

    return {
        "redis": {"connected": redis_ok, "latency_ms": redis_latency, "memory": redis_memory},
        "database": {"connected": db_ok, "users_count": users_count},
        "celery": {"workers": celery_workers, "worker_count": len(celery_workers)},
        "celery_beat": {"status": beat_status, "last_heartbeat": beat_heartbeat},
        "telegram_bot": {"status": bot_status, "thread_alive": bot_alive},
        "metrics": metrics_summary,
        **result,
    }


# ──────────────────────────────────────────────
# Metrics (admin-only, no tracking)
# ──────────────────────────────────────────────


@router.get(
    "/metrics/usage",
    summary="Usage stats (first-party, server-side)",
    description="Aggregated request/error metrics from the in-memory ring buffer. No user data.",
)
def metrics_usage(admin: User = Depends(get_current_admin)):
    from app.metrics import get_usage_stats

    return get_usage_stats(window=86400)


@router.get(
    "/metrics/system",
    summary="System metrics (extended health)",
    description="Extended health with request rates, latencies, DB pool, and Celery queue depth.",
)
def metrics_system(admin: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    from app.metrics import get_usage_stats
    from app.services.rate_limit import _get_redis

    usage = get_usage_stats(window=300)

    # DB pool status
    db_pool = {"pool_size": 0, "checked_out": 0, "overflow": 0}
    try:
        pool = engine.pool
        db_pool = {
            "pool_size": pool.size(),
            "checked_out": pool.checkedout(),
            "overflow": pool.overflow(),
        }
    except Exception:
        pass

    # Celery queue depth via Redis LLEN
    queue_depth = 0
    try:
        r = _get_redis()
        queue_depth = r.llen("celery")
    except Exception:
        pass

    # Redis status
    redis_ok = False
    redis_latency = 0
    try:
        r = _get_redis()
        import time

        start = time.time()
        r.ping()
        redis_latency = int((time.time() - start) * 1000)
        redis_ok = True
    except Exception:
        pass

    # Celery workers
    celery_workers = []
    try:
        from app.celery_app import celery_app

        inspector = celery_app.control.inspect(timeout=2.0)
        active = inspector.active() or {}
        celery_workers = list(active.keys())
    except Exception:
        pass

    return {
        "usage": usage,
        "redis": {"connected": redis_ok, "latency_ms": redis_latency},
        "database": {"connected": True, **db_pool},
        "celery": {
            "workers": celery_workers,
            "worker_count": len(celery_workers),
            "queue_depth": queue_depth,
        },
    }


@router.get(
    "/system/tasks",
    summary="List scheduled tasks",
    description="Return the last run time and status for each scheduled background task.",
)
def system_tasks(admin: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    tasks = [
        "execute-due-installments-daily",
        "execute-due-recurring-daily",
        "cleanup-expired-import-jobs-daily",
        "daily-uncategorized-expenses",
        "send-weekly-reports",
        "generate-monthly-reports",
        "suggest-uncategorized-categories-daily",
        "categorization-review-scan-daily",
        "detect-recurring-expenses-daily",
        "check-upcoming-recurring-daily",
        "cleanup-audit-logs-daily",
    ]

    result = []
    for task_name in tasks:
        run_setting = db.query(Setting).filter(Setting.key == f"task_last_run:{task_name}").first()
        status_setting = (
            db.query(Setting).filter(Setting.key == f"task_last_status:{task_name}").first()
        )
        result.append(
            {
                "name": task_name,
                "last_run": run_setting.value if run_setting else "Never",
                "last_status": status_setting.value if status_setting else "unknown",
            }
        )

    return {"tasks": result}


@router.get(
    "/system/settings",
    summary="Get all settings",
    description="Return all key-value settings from the database.",
)
def get_settings(admin: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    settings = db.query(Setting).order_by(Setting.key).all()
    return {"settings": [{"key": s.key, "value": s.value} for s in settings]}


class SettingUpdate(BaseModel):
    key: str
    value: str


@router.put(
    "/system/settings",
    summary="Update a setting",
    description="Create or update a key-value setting in the database.",
)
def update_setting(
    body: SettingUpdate,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    setting = db.query(Setting).filter(Setting.key == body.key).first()
    if setting:
        setting.value = body.value
    else:
        db.add(Setting(key=body.key, value=body.value))
    db.commit()
    return {"ok": True}


# ──────────────────────────────────────────────
# Feature Flags
# ──────────────────────────────────────────────

FEATURE_FLAGS = [
    {
        "key": "ai_suggestions_enabled",
        "label": "Sugerencias IA",
        "description": "Sugerencias automáticas de categorías con IA",
    },
    {
        "key": "weekly_summary_enabled",
        "label": "Resumen semanal",
        "description": "Reporte semanal vía Telegram",
    },
    {
        "key": "categorization_review_enabled",
        "label": "Revisión de categorías",
        "description": (
            "Detección interna de gastos mal categorizados (solo revisión admin, "
            "no se muestra al usuario)"
        ),
    },
]


@router.get(
    "/feature-flags",
    summary="List feature flags",
    description="Return all feature flags with their global override values.",
)
def get_feature_flags(
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    result = []
    for flag in FEATURE_FLAGS:
        global_setting = db.query(Setting).filter(Setting.key == f"flag:{flag['key']}").first()
        result.append(
            {
                "key": flag["key"],
                "label": flag["label"],
                "description": flag["description"],
                "global_override": global_setting.value if global_setting else "",
            }
        )
    return {"flags": result}


class FeatureFlagUpdate(BaseModel):
    value: str  # "on", "off", or "" (empty = respect per-user)


@router.put(
    "/feature-flags/{flag_key}",
    summary="Update a feature flag",
    description="Set the global override value for a feature flag (on, off, or empty for per-user).",
)
def update_feature_flag(
    flag_key: str,
    body: FeatureFlagUpdate,
    request: Request,
    admin: User = Depends(require_step_up),
    db: Session = Depends(get_db),
):
    valid_keys = [f["key"] for f in FEATURE_FLAGS]
    if flag_key not in valid_keys:
        raise HTTPException(404, f"Unknown flag: {flag_key}")

    setting_key = f"flag:{flag_key}"
    setting = db.query(Setting).filter(Setting.key == setting_key).first()
    if setting:
        setting.value = body.value
    else:
        db.add(Setting(key=setting_key, value=body.value))
    db.commit()
    _audit_admin(
        db, admin, "admin_feature_flag", request, details={"key": flag_key, "value": body.value}
    )
    return {"ok": True, "key": flag_key, "value": body.value}


# ──────────────────────────────────────────────
# Platform Logs
# ──────────────────────────────────────────────


@router.get(
    "/platform-logs",
    summary="Get platform logs",
    description="Return paginated platform logs filtered by level, module, or search term.",
)
def get_platform_logs(
    level: str = "",
    module: str = "",
    search: str = "",
    page: int = 1,
    per_page: int = 100,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    query = db.query(PlatformLog)
    if level:
        # Support comma-separated levels: "WARNING,ERROR"
        levels = [l.strip().upper() for l in level.split(",") if l.strip()]
        if levels:
            query = query.filter(PlatformLog.level.in_(levels))
    if module:
        query = query.filter(PlatformLog.module.ilike(f"%{module}%"))
    if search:
        query = query.filter(PlatformLog.message.ilike(f"%{search}%"))

    total = query.count()
    logs = (
        query.order_by(PlatformLog.created_at.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
        .all()
    )

    return {
        "logs": [
            {
                "id": log.id,
                "level": log.level,
                "module": log.module,
                "message": log.message,
                "details": log.details,
                "created_at": log.created_at.isoformat() if log.created_at else "",
            }
            for log in logs
        ],
        "total": total,
        "page": page,
    }


# ──────────────────────────────────────────────
# Task Execution
# ──────────────────────────────────────────────

TASK_NAME_MAP = {
    "execute-due-installments-daily": "app.tasks.scheduled_expenses.execute_due_installments",
    "execute-due-recurring-daily": "app.tasks.recurring_charges.execute_due_recurring",
    "cleanup-expired-import-jobs-daily": "app.tasks.cleanup_import_jobs.cleanup_expired_import_jobs",
    "daily-uncategorized-expenses": "app.tasks.daily_uncategorized.daily_uncategorized_check",
    "send-weekly-reports": "app.tasks.weekly_summary.send_weekly_reports",
    "generate-monthly-reports": "app.tasks.monthly_report.generate_monthly_reports",
    "suggest-uncategorized-categories-daily": "app.tasks.suggest_uncategorized.suggest_uncategorized_categories",
    "categorization-review-scan-daily": "app.tasks.categorization_review.categorization_review_scan",
    "detect-recurring-expenses-daily": "app.tasks.detect_recurring.detect_recurring_expenses",
    "check-upcoming-recurring-daily": "app.tasks.check_upcoming_recurring.check_upcoming_recurring",
    "cleanup-audit-logs-daily": "app.tasks.cleanup_audit_logs.cleanup_old_records",
}


@router.post(
    "/system/tasks/{task_name}/run",
    summary="Run a scheduled task",
    description="Manually trigger a scheduled Celery task by its name.",
)
def run_task(
    task_name: str,
    admin: User = Depends(get_current_admin),
):
    celery_task = TASK_NAME_MAP.get(task_name)
    if not celery_task:
        raise HTTPException(404, f"Task '{task_name}' not found")

    try:
        from app.celery_app import celery_app

        result = celery_app.send_task(celery_task)
        return {"ok": True, "task_id": result.id, "task_name": task_name}
    except Exception as e:
        logger.error(f"Failed to enqueue task {task_name}: {e}")
        raise HTTPException(500, f"Failed to enqueue task: {e}")


# ──────────────────────────────────────────────
# Bulk notify
# ──────────────────────────────────────────────


class BulkNotifyRequest(BaseModel):
    user_ids: list[int]
    title: str
    body: str


@router.post(
    "/bulk/notify",
    summary="Send bulk notifications",
    description="Send a notification to multiple users at once (max 500).",
)
def bulk_notify(
    body: BulkNotifyRequest,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    if not body.user_ids:
        raise HTTPException(400, "No user IDs provided")
    if len(body.user_ids) > 500:
        raise HTTPException(400, "Max 500 users at once")

    created = 0
    for uid in body.user_ids:
        u = db.get(User, uid)
        if u:
            db.add(
                Notification(
                    user_id=uid,
                    type="admin_message",
                    title=body.title,
                    body=body.body,
                    data=json.dumps({"from_admin": admin.id}),
                )
            )
            created += 1
    db.commit()
    return {"ok": True, "sent": created}
