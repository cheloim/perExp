"""Import jobs fail loudly when the Celery broker is unavailable (#554)."""

from datetime import datetime, timedelta
from types import SimpleNamespace

from fastapi.testclient import TestClient

from app.database import get_db
from app.models import ImportJob, User
from app.routers import import_jobs
from app.services.auth import get_current_user, get_password_hash
from app.tasks import cleanup_import_jobs
from main import app


class _SessionProxy:
    """Let the cleanup task commit without closing the test session."""

    def __init__(self, session):
        self._session = session

    def __getattr__(self, name):
        return getattr(self._session, name)

    def close(self) -> None:
        pass


def _user(db) -> User:
    user = User(
        email="broker-down@example.com",
        full_name="Broker Down",
        hashed_password=get_password_hash("testpassword"),
        email_verified=True,
    )
    db.add(user)
    db.flush()
    return user


def test_create_import_job_marks_failed_when_broker_is_down(db, monkeypatch):
    user = _user(db)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    monkeypatch.setattr(import_jobs, "check_rate_limit", lambda *_args, **_kwargs: (True, 0))

    def broker_down(job_id: int) -> None:
        raise ConnectionError("broker down")

    monkeypatch.setattr(import_jobs, "process_import_job", SimpleNamespace(delay=broker_down))

    try:
        client = TestClient(app)
        response = client.post(
            "/import-jobs",
            files={
                "file": (
                    "resumen.csv",
                    b"date,amount,description\n2026-11-15,100,Compra\n",
                    "text/csv",
                )
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 503
    job = db.query(ImportJob).filter(ImportJob.user_id == user.id).one()
    assert job.status == "FAILED"
    assert "encolar" in (job.error_message or "").lower()
    assert job.completed_at is not None


def test_cleanup_marks_stale_processing_jobs_failed(db, monkeypatch):
    user = _user(db)
    job = ImportJob(
        user_id=user.id,
        filename="stale.csv",
        status="PROCESSING",
        created_at=datetime.utcnow() - timedelta(hours=2),
    )
    db.add(job)
    db.flush()

    monkeypatch.setattr(cleanup_import_jobs, "SessionLocal", lambda: _SessionProxy(db))
    cleanup_import_jobs.cleanup_expired_import_jobs()

    db.refresh(job)
    assert job.status == "FAILED"
    assert job.error_message == "Procesamiento interrumpido"
    assert job.completed_at is not None
