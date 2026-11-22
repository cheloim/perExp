"""Import-jobs API: happy path, scoping, TTL and validation (#561)."""

import json
from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.database import get_db
from app.models import Card, Expense, ImportJob, Notification, ScheduledExpense, User
from app.routers import import_jobs
from app.services.auth import get_current_user
from main import app


@pytest.fixture(autouse=True)
def _overrides():
    yield
    app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def _rate_limit_ok(monkeypatch):
    monkeypatch.setattr(import_jobs, "check_rate_limit", lambda *_a, **_k: (True, 0))


def _client(db, user) -> TestClient:
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def _job(db, user, **overrides) -> ImportJob:
    data = {
        "user_id": user.id,
        "filename": "resumen.csv",
        "status": "READY_PREVIEW",
    }
    data.update(overrides)
    job = ImportJob(**data)
    db.add(job)
    db.flush()
    return job


def test_create_import_job_enqueues_the_file(db, test_user, monkeypatch):
    enqueued = []
    monkeypatch.setattr(
        import_jobs,
        "process_import_job",
        SimpleNamespace(delay=lambda job_id: enqueued.append(job_id)),
    )

    response = _client(db, test_user).post(
        "/import-jobs",
        files={"file": ("resumen.csv", b"date,amount\n2026-11-15,100\n", "text/csv")},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["filename"] == "resumen.csv"
    assert body["status"] == "PROCESSING"
    assert enqueued == [body["id"]]
    job = db.query(ImportJob).filter(ImportJob.id == body["id"]).one()
    assert job.file_content is not None


def test_create_import_job_rejects_oversized_and_unsupported_files(db, test_user, monkeypatch):
    enqueued = []
    monkeypatch.setattr(
        import_jobs,
        "process_import_job",
        SimpleNamespace(delay=lambda job_id: enqueued.append(job_id)),
    )
    client = _client(db, test_user)

    too_big = client.post(
        "/import-jobs",
        files={"file": ("big.csv", b"x" * (10 * 1024 * 1024 + 1), "text/csv")},
    )
    unsupported = client.post(
        "/import-jobs",
        files={"file": ("notas.txt", b"hola", "text/plain")},
    )

    assert too_big.status_code == 400
    assert unsupported.status_code == 415
    assert enqueued == []


def test_list_import_jobs_filters_and_parses_preview(db, test_user):
    _job(
        db,
        test_user,
        filename="ready.csv",
        status="READY_PREVIEW",
        preview_data=json.dumps({"rows": []}),
    )
    _job(db, test_user, filename="failed.csv", status="FAILED", error_message="boom")
    other = User(
        email="import-other@example.com",
        full_name="Other",
        hashed_password="x",
        email_verified=True,
    )
    db.add(other)
    db.flush()
    _job(db, other, filename="other.csv")
    client = _client(db, test_user)

    listed = client.get("/import-jobs")
    ready = client.get("/import-jobs", params={"status": "READY_PREVIEW"})
    limited = client.get("/import-jobs", params={"limit": 1})

    assert listed.status_code == 200
    assert {row["filename"] for row in listed.json()} == {"ready.csv", "failed.csv"}
    assert [row["filename"] for row in ready.json()] == ["ready.csv"]
    assert ready.json()[0]["preview_data"] == {"rows": []}
    assert len(limited.json()) == 1


def test_get_import_job_is_scoped_and_hides_other_users_rows(db, test_user):
    job = _job(db, test_user, preview_data=json.dumps({"rows": [{"amount": 10}]}))
    other = User(
        email="intruder@example.com",
        full_name="Intruder",
        hashed_password="x",
        email_verified=True,
    )
    db.add(other)
    db.flush()
    other_job = _job(db, other)
    client = _client(db, test_user)

    own = client.get(f"/import-jobs/{job.id}")
    foreign = client.get(f"/import-jobs/{other_job.id}")
    missing = client.get("/import-jobs/999999")

    assert own.status_code == 200
    assert own.json()["preview_data"] == {"rows": [{"amount": 10}]}
    assert foreign.status_code == 404
    assert missing.status_code == 404


def test_get_import_job_expires_after_the_ttl(db, test_user):
    job = _job(db, test_user, created_at=datetime.utcnow() - timedelta(hours=25))

    response = _client(db, test_user).get(f"/import-jobs/{job.id}")

    assert response.status_code == 410
    assert db.query(ImportJob).filter(ImportJob.id == job.id).first() is None


def test_update_preview_rejects_missing_expired_and_wrong_status(db, test_user):
    expired = _job(db, test_user, created_at=datetime.utcnow() - timedelta(hours=25))
    completed = _job(db, test_user, status="COMPLETED")
    client = _client(db, test_user)

    missing = client.put("/import-jobs/999999/preview", json={"rows": []})
    gone = client.put(f"/import-jobs/{expired.id}/preview", json={"rows": []})
    wrong_status = client.put(f"/import-jobs/{completed.id}/preview", json={"rows": []})

    assert missing.status_code == 404
    assert gone.status_code == 410
    assert wrong_status.status_code == 400


def test_update_preview_persists_the_edited_rows(db, test_user):
    job = _job(db, test_user)
    payload = {"rows": [{"description": "Editada", "amount": 123}]}

    response = _client(db, test_user).put(f"/import-jobs/{job.id}/preview", json=payload)

    assert response.status_code == 200
    db.refresh(job)
    assert json.loads(job.preview_data) == payload


def test_confirm_rejects_missing_expired_wrong_status_and_bad_rows(db, test_user):
    expired = _job(db, test_user, created_at=datetime.utcnow() - timedelta(hours=25))
    completed = _job(db, test_user, status="COMPLETED")
    ready = _job(db, test_user)
    client = _client(db, test_user)

    missing = client.post("/import-jobs/999999/confirm", json={"rows": []})
    gone = client.post(f"/import-jobs/{expired.id}/confirm", json={"rows": []})
    wrong_status = client.post(f"/import-jobs/{completed.id}/confirm", json={"rows": []})
    bad_date = client.post(
        f"/import-jobs/{ready.id}/confirm",
        json={"rows": [{"date": "not-a-date", "amount": "10", "description": "Compra"}]},
    )
    bad_amount = client.post(
        f"/import-jobs/{ready.id}/confirm",
        json={"rows": [{"date": "15-11-2026", "amount": "nope", "description": "Compra"}]},
    )

    assert missing.status_code == 404
    assert gone.status_code == 410
    assert wrong_status.status_code == 400
    assert bad_date.status_code == 400
    assert bad_amount.status_code == 400


def test_confirm_skips_flagged_duplicates_and_rechecks_the_database(db, test_user):
    job = _job(db, test_user)
    rows = [
        {"date": "15-11-2026", "amount": "10", "description": "Flagged", "is_duplicate": True},
        {
            "date": "15-11-2026",
            "amount": "20",
            "description": "Saved twice",
            "transaction_id": "000123",
        },
        {
            "date": "15-11-2026",
            "amount": "20",
            "description": "Saved twice",
            "transaction_id": "123",
        },
    ]

    response = _client(db, test_user).post(f"/import-jobs/{job.id}/confirm", json={"rows": rows})

    assert response.status_code == 200
    assert response.json() == {"imported": 1, "skipped": 2, "scheduled": 0}
    db.refresh(job)
    assert job.status == "COMPLETED"


def test_confirm_creates_a_scheduled_installment_with_a_mapped_card(db, test_user):
    job = _job(db, test_user)
    payload = {
        "rows": [
            {
                "date": "15-11-2026",
                "amount": "1.500,50",
                "description": "Cuota futura",
                "currency": "ARS",
                "is_scheduled": True,
                "card_header": "Galicia Visa",
                "installment_number": 2,
                "installment_total": 3,
                "installment_group_id": "group-1",
            }
        ],
        "cards_mapping": {
            "Galicia Visa": {"bank": "Galicia", "card_name": "Visa", "holder": "Test"}
        },
    }

    response = _client(db, test_user).post(f"/import-jobs/{job.id}/confirm", json=payload)

    assert response.status_code == 200
    assert response.json() == {"imported": 0, "skipped": 0, "scheduled": 1}
    scheduled = db.query(ScheduledExpense).filter(ScheduledExpense.user_id == test_user.id).one()
    assert scheduled.amount == pytest.approx(1500.50)
    assert scheduled.installment_number == 2
    card = db.query(Card).filter(Card.user_id == test_user.id).one()
    assert scheduled.card_id == card.id
    assert card.bank == "Galicia"


def test_confirm_uses_an_existing_card_id_from_the_mapping(db, test_user):
    card = Card(
        card_name="Visa",
        bank="Galicia",
        holder="Test",
        card_type="credito",
        user_id=test_user.id,
    )
    db.add(card)
    job = _job(db, test_user)
    db.flush()

    response = _client(db, test_user).post(
        f"/import-jobs/{job.id}/confirm",
        json={
            "rows": [
                {
                    "date": "15-11-2026",
                    "amount": "100",
                    "description": "Compra",
                    "card_header": "Galicia Visa",
                }
            ],
            "cards_mapping": {"Galicia Visa": {"card_id": card.id}},
        },
    )

    assert response.status_code == 200
    expense = db.query(Expense).one()
    assert expense.card_id == card.id


def test_confirm_removes_the_ready_notification_for_the_job(db, test_user):
    job = _job(db, test_user)
    wanted = Notification(
        user_id=test_user.id,
        type="import_ready",
        title="Lista",
        data=json.dumps({"job_id": job.id}),
    )
    unrelated = Notification(
        user_id=test_user.id,
        type="import_ready",
        title="Otra",
        data=json.dumps({"job_id": 999999}),
    )
    db.add_all([wanted, unrelated])
    db.flush()

    response = _client(db, test_user).post(f"/import-jobs/{job.id}/confirm", json={"rows": []})

    assert response.status_code == 200
    remaining = db.query(Notification).filter(Notification.user_id == test_user.id).all()
    assert [n.title for n in remaining] == ["Otra"]


def test_delete_import_job_is_scoped_and_removes_its_notification(db, test_user):
    job = _job(db, test_user)
    notification = Notification(
        user_id=test_user.id,
        type="import_failed",
        title="Error",
        data=json.dumps({"job_id": job.id}),
    )
    other = User(
        email="delete-other@example.com",
        full_name="Other",
        hashed_password="x",
        email_verified=True,
    )
    db.add_all([notification, other])
    db.flush()
    other_job = _job(db, other)
    client = _client(db, test_user)

    missing = client.delete("/import-jobs/999999")
    foreign = client.delete(f"/import-jobs/{other_job.id}")
    deleted = client.delete(f"/import-jobs/{job.id}")

    assert missing.status_code == 404
    assert foreign.status_code == 404
    assert deleted.status_code == 200
    assert db.query(ImportJob).filter(ImportJob.id == job.id).first() is None
    assert db.query(Notification).filter(Notification.id == notification.id).first() is None
