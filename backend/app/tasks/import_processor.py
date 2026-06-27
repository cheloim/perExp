"""
Background task processor for import jobs.
Processes uploaded files asynchronously and creates notifications when ready.
Uses Redis lock per user to ensure sequential processing per user (FIFO).
Different users can process in parallel.
"""

import asyncio
import gc
import json
import os
import warnings
from contextlib import suppress
from datetime import datetime

import redis

from app.database import SessionLocal

_log = lambda msg: print(f"{datetime.now().isoformat()} {msg}")
from app.celery_app import celery_app
from app.models import ImportJob, Notification
from app.services.smart_import_core import run_smart_import

# Redis client for per-user locks
redis_client = redis.from_url(os.getenv("REDIS_URL", "redis://localhost:6379/0"))

# Lock timeout: 10 minutes (matches task_time_limit)
LOCK_TIMEOUT = 600


@celery_app.task(name="app.tasks.import_processor.process_import_job")
def process_import_job(job_id: int):
    """
    Process an import job in the background.
    Uses Redis lock per user to ensure sequential processing per user.
    Different users can process in parallel.
    """
    db = SessionLocal()
    try:
        job = db.query(ImportJob).filter(ImportJob.id == job_id).first()
        if not job:
            _log(f"[IMPORT JOB] Job {job_id} not found")
            return

        _log(f"[IMPORT JOB] Processing job {job_id}: {job.filename}")

        # Acquire lock for this user (blocks if another job is running for same user)
        lock_key = f"import_lock:user:{job.user_id}"
        lock = redis_client.lock(lock_key, timeout=LOCK_TIMEOUT)

        if not lock.acquire(blocking=True, blocking_timeout=LOCK_TIMEOUT):
            _log(f"[IMPORT JOB] Job {job_id} timed out waiting for lock for user {job.user_id}")
            job.status = "FAILED"
            job.error_message = "Timeout: another import is still processing for this user"
            job.completed_at = datetime.utcnow()
            db.commit()
            return

        try:
            file_content = job.file_content
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            preview = loop.run_until_complete(
                run_smart_import(
                    file_content=file_content, filename=job.filename, db=db, user_id=job.user_id
                )
            )
            # Suppress RuntimeError from async GenAI client cleanup after loop close
            with suppress(RuntimeError):
                loop.close()
            # Also suppress deferred cleanup warnings from GC
            warnings.filterwarnings("ignore", message=".*Event loop is closed.*")
            del file_content
            job.file_content = None

            job.preview_data = json.dumps(preview, default=str)
            job.status = "READY_PREVIEW"
            job.completed_at = datetime.utcnow()

            notification = Notification(
                user_id=job.user_id,
                type="import_ready",
                title=f"Importación lista: {job.filename}",
                body=f"{len(preview['rows'])} transacciones encontradas",
                data=json.dumps(
                    {"job_id": job.id, "filename": job.filename, "row_count": len(preview["rows"])}
                ),
                read=False,
            )
            db.add(notification)
            db.commit()

            row_count = len(preview["rows"])
            del preview
            gc.collect()

            _log(f"[IMPORT JOB] Job {job_id} completed successfully: {row_count} rows")

        finally:
            lock.release()

    except Exception as e:
        _log(f"[IMPORT JOB] Job {job_id} failed: {e}")
        import traceback

        traceback.print_exc()

        job.status = "FAILED"
        job.error_message = str(e)
        job.completed_at = datetime.utcnow()

        notification = Notification(
            user_id=job.user_id,
            type="import_failed",
            title=f"Error al importar: {job.filename}",
            body=f"Error: {str(e)[:100]}",
            data=json.dumps({"job_id": job.id, "filename": job.filename, "error": str(e)}),
            read=False,
        )
        db.add(notification)
        db.commit()

    finally:
        db.close()


def sync_process_import_job(job_id: int):
    """
    Synchronous wrapper for background task execution.
    Used by FastAPI BackgroundTasks when Celery is not configured.
    """
    process_import_job.delay(job_id)
