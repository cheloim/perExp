"""
Background task processor for import jobs.
Processes uploaded files asynchronously and creates notifications when ready.
"""
import asyncio
import json
from datetime import datetime

from app.database import SessionLocal

_log = lambda msg: print(f"{datetime.now().isoformat()} {msg}")
from app.models import ImportJob, Notification
from app.services.smart_import_core import run_smart_import
from app.celery_app import celery_app


@celery_app.task(name="app.tasks.import_processor.process_import_job")
def process_import_job(job_id: int):
    """
    Process an import job in the background:
    1. Loads file from job.file_content
    2. Runs smart import (PDF/CSV extraction + LLM + installment expansion)
    3. Saves preview in job.preview_data
    4. Creates notification for user
    """
    db = SessionLocal()
    try:
        job = db.query(ImportJob).filter(ImportJob.id == job_id).first()
        if not job:
            _log(f"[IMPORT JOB] Job {job_id} not found")
            return

        _log(f"[IMPORT JOB] Processing job {job_id}: {job.filename}")

        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        preview = loop.run_until_complete(run_smart_import(
            file_content=job.file_content,
            filename=job.filename,
            db=db,
            user_id=job.user_id
        ))
        loop.close()

        job.preview_data = json.dumps(preview, default=str)
        job.status = "READY_PREVIEW"
        job.completed_at = datetime.utcnow()

        notification = Notification(
            user_id=job.user_id,
            type="import_ready",
            title=f"Importación lista: {job.filename}",
            body=f"{len(preview['rows'])} transacciones encontradas",
            data=json.dumps({
                "job_id": job.id,
                "filename": job.filename,
                "row_count": len(preview['rows'])
            }),
            read=False
        )
        db.add(notification)
        db.commit()

        _log(f"[IMPORT JOB] Job {job_id} completed successfully: {len(preview['rows'])} rows")

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
            data=json.dumps({
                "job_id": job.id,
                "filename": job.filename,
                "error": str(e)
            }),
            read=False
        )
        db.add(notification)
        db.commit()

    finally:
        db.close()


async def _async_process_import_job(job_id: int):
    """
    Async version for direct invocation (not via Celery).
    """
    db = SessionLocal()
    try:
        job = db.query(ImportJob).filter(ImportJob.id == job_id).first()
        if not job:
            _log(f"[IMPORT JOB] Job {job_id} not found")
            return

        _log(f"[IMPORT JOB] Processing job {job_id}: {job.filename}")

        preview = await run_smart_import(
            file_content=job.file_content,
            filename=job.filename,
            db=db,
            user_id=job.user_id
        )

        job.preview_data = json.dumps(preview, default=str)
        job.status = "READY_PREVIEW"
        job.completed_at = datetime.utcnow()

        notification = Notification(
            user_id=job.user_id,
            type="import_ready",
            title=f"Importación lista: {job.filename}",
            body=f"{len(preview['rows'])} transacciones encontradas",
            data=json.dumps({
                "job_id": job.id,
                "filename": job.filename,
                "row_count": len(preview['rows'])
            }),
            read=False
        )
        db.add(notification)
        db.commit()

        _log(f"[IMPORT JOB] Job {job_id} completed successfully: {len(preview['rows'])} rows")

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
            data=json.dumps({
                "job_id": job.id,
                "filename": job.filename,
                "error": str(e)
            }),
            read=False
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
