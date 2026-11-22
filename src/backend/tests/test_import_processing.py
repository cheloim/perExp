"""Import processing: helpers, installment expansion and the Celery task (#561)."""

import io
import json
from datetime import date, datetime, timedelta

import pandas as pd
import pytest

from app.models import Expense, ImportJob, Notification, User
from app.services import import_utils, smart_import_core
from app.services.encryption import compute_hmac
from app.tasks import import_processor


class _SessionProxy:
    def __init__(self, session):
        self._session = session

    def __getattr__(self, name):
        return getattr(self._session, name)

    def close(self) -> None:
        pass


def _user(db, email: str = "import-processing@example.com") -> User:
    user = User(email=email, full_name="Import User", email_verified=True)
    db.add(user)
    db.flush()
    return user


# ── import_utils ─────────────────────────────────────────────


def test_normalize_text_strips_pending_and_uppercases():
    assert import_utils._normalize_text(None) == ""
    assert import_utils._normalize_text("  compra - Pendiente ") == "COMPRA"
    assert import_utils._normalize_text("netflix") == "NETFLIX"


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("LA SEGUNDA COO0951898-03/06-000-314", "LA SEGUNDA COO0951898"),
        ("KEL EDICIONES SA03/03", "KEL EDICIONES SA"),
        ("TIENDA C.01/12", "TIENDA"),
        ("TIENDA 01/12", "TIENDA"),
        ("Sin cuotas", "Sin cuotas"),
    ],
)
def test_strip_installment_suffix(raw, expected):
    assert import_utils._strip_installment_suffix(raw) == expected


@pytest.mark.parametrize(
    "description,expected",
    [
        ("Compra C.02/06", (2, 6)),
        ("Cta 3/12", (3, 12)),
        ("KEL EDICIONES SA03/03", (3, 3)),
        ("Cuota 2/6 ", (2, 6)),
        ("Sin cuotas", None),
        ("", None),
        ("Pago 1/1", None),
    ],
)
def test_detect_installment_pattern(description, expected):
    assert import_utils._detect_installment_pattern(description) == expected


def test_detect_col_prefers_a_hint_and_falls_back_to_the_first_column():
    assert import_utils._detect_col(["Fecha", "Monto"], ["monto"]) == "Monto"
    assert import_utils._detect_col(["A", "B"], ["missing"]) == "A"
    assert import_utils._detect_col([], ["monto"]) == ""


def test_load_dataframe_reads_csv_and_excel():
    csv = import_utils._load_dataframe(b"a,b\n1,2\n", "data.csv")
    assert csv.to_dict("records") == [{"a": 1, "b": 2}]

    buffer = io.BytesIO()
    pd.DataFrame({"a": [1], "b": [2]}).to_excel(buffer, index=False)
    excel = import_utils._load_dataframe(buffer.getvalue(), "data.xlsx")
    assert excel.to_dict("records") == [{"a": 1, "b": 2}]


def test_expand_installments_generates_past_expenses_and_future_scheduled(db, test_user):
    parsed = [
        {
            "date": "15-11-2026",
            "_date_obj": date(2026, 11, 15),
            "description": "TIENDA C.02/03",
            "amount": 300.0,
            "currency": "ARS",
            "card_header": "Visa Galicia",
            "transaction_id": "txn-1",
            "installment_number": 2,
            "installment_total": 3,
            "installment_group_id": None,
        }
    ]

    expenses, scheduled = import_utils._expand_installments(parsed, db, test_user.id)

    assert len(expenses) == 2
    assert expenses[0]["installment_group_id"]
    assert expenses[1]["installment_number"] == 1
    assert expenses[1]["_auto_generated"] is True
    assert len(scheduled) == 1
    assert scheduled[0]["installment_number"] == 3
    assert scheduled[0]["status"] == "PENDING"


def test_is_scheduled_duplicate_matches_the_same_pending_installment(db, test_user):
    from app.models import ScheduledExpense

    scheduled = ScheduledExpense(
        user_id=test_user.id,
        installment_group_id="group-dup",
        installment_number=2,
        installment_total=3,
        scheduled_date=date(2027, 1, 15),
        amount=100.0,
        description="Cuota",
        description_hmac=compute_hmac("Cuota"),
        status="PENDING",
    )
    db.add(scheduled)
    db.flush()

    assert (
        import_utils._is_scheduled_duplicate(
            db, date(2027, 1, 15), 100.0, "Cuota", 2, 3, test_user.id, "group-dup"
        )
        is True
    )
    assert (
        import_utils._is_scheduled_duplicate(
            db, date(2027, 1, 15), 100.0, "Cuota", 2, 3, test_user.id, "other-group"
        )
        is False
    )


def test_fix_missing_installments_links_and_creates_the_missing_rows(db, test_user):
    first = Expense(
        user_id=test_user.id,
        date=date(2026, 12, 1),
        description="TIENDA 01/05",
        amount=500.0,
        currency="ARS",
    )
    third = Expense(
        user_id=test_user.id,
        date=date(2027, 2, 1),
        description="TIENDA 02/05",
        amount=500.0,
        currency="ARS",
    )
    db.add_all([first, third])
    db.flush()

    result = import_utils.fix_missing_installments(db, test_user.id)

    assert result["groups_fixed"] == 1
    assert result["expenses_created"] == 0
    assert result["scheduled_created"] >= 1
    db.refresh(first)
    db.refresh(third)
    assert first.installment_group_id == third.installment_group_id
    assert first.installment_number == 1
    assert third.installment_number == 2


# ── smart_import_core ────────────────────────────────────────


def test_parse_and_match_helpers_cover_common_headers():
    assert smart_import_core._parse_card_header("Visa Galicia") == ("Galicia", "Visa")
    assert smart_import_core._parse_card_header("Visa terminada en 8130") == ("", "Visa")
    assert smart_import_core._parse_card_header("") == ("", "")
    assert smart_import_core._parse_full_name("Mendoza, Marcelo") == ("Marcelo", "Mendoza")
    assert smart_import_core._parse_full_name("Marcelo Mendoza") == ("Marcelo", "Mendoza")
    assert smart_import_core._parse_full_name("") == ("", "")
    assert smart_import_core._holder_matches_user("MARCELO IGN MENDOZA", "Marcelo", "Mendoza")
    assert not smart_import_core._holder_matches_user("", "Marcelo", "Mendoza")
    assert smart_import_core._chunk_text("hola") == ["hola"]


def _fake_llm(rows):
    class FakeClient:
        async def acomplete_json(self, *_args, **_kwargs):
            return rows

    return FakeClient()


def test_run_smart_import_builds_rows_and_closing_summary(db, test_user, monkeypatch):
    rows = [
        {
            "date": "15-11-2026",
            "description": "Compra",
            "amount": "100",
            "currency": "usd",
            "transaction_id": "0001",
            "card_header": "Visa Galicia",
            "closing_date": "2026-11-20",
            "bank": "Galicia",
            "card_type": "credito",
            "total_ars": "1000",
        },
        {"date": "", "description": "Segunda", "amount": "50", "card_header": "Visa Galicia"},
        {"description": "", "amount": "10"},
        {"date": "16-11-2026", "description": "Cero", "amount": "0"},
    ]
    monkeypatch.setattr(smart_import_core, "is_configured", lambda: True)
    monkeypatch.setattr(smart_import_core, "get_client", lambda: _fake_llm(rows))
    monkeypatch.setattr(smart_import_core, "_clean_text_for_llm", lambda text: text)

    result = __import__("asyncio").run(
        smart_import_core.run_smart_import(b"date,amount\n", "resumen.csv", db, test_user.id)
    )

    assert len(result["rows"]) == 2
    assert result["rows"][0]["currency"] == "USD"
    assert result["rows"][1]["date"] == "15-11-2026"
    assert result["summary"]["bank"] == "Galicia"
    assert result["summary"]["closing_date"] == "2026-11-20"
    assert result["summary"]["total_ars"] == 1000.0
    assert result["detected_cards"][0]["detected_bank"] == "Galicia"
    assert result["raw_count"] == 4


def test_run_smart_import_rejects_missing_configuration_and_formats(db, test_user, monkeypatch):
    monkeypatch.setattr(smart_import_core, "is_configured", lambda: False)
    with pytest.raises(ValueError, match="LLM_API_KEY"):
        __import__("asyncio").run(
            smart_import_core.run_smart_import(b"x", "resumen.csv", db, test_user.id)
        )

    monkeypatch.setattr(smart_import_core, "is_configured", lambda: True)
    with pytest.raises(ValueError, match="Formato no soportado"):
        __import__("asyncio").run(
            smart_import_core.run_smart_import(b"x", "resumen.txt", db, test_user.id)
        )


def test_run_smart_import_rejects_invalid_model_responses(db, test_user, monkeypatch):
    monkeypatch.setattr(smart_import_core, "is_configured", lambda: True)
    monkeypatch.setattr(smart_import_core, "_clean_text_for_llm", lambda text: text)
    monkeypatch.setattr(smart_import_core, "get_client", lambda: _fake_llm({"not": "a list"}))
    with pytest.raises(ValueError, match="Error interno"):
        __import__("asyncio").run(
            smart_import_core.run_smart_import(b"date,amount\n", "resumen.csv", db, test_user.id)
        )

    class BrokenClient:
        async def acomplete_json(self, *_args, **_kwargs):
            raise ValueError("not json")

    monkeypatch.setattr(smart_import_core, "get_client", lambda: BrokenClient())
    with pytest.raises(ValueError, match="Respuesta inválida"):
        __import__("asyncio").run(
            smart_import_core.run_smart_import(b"date,amount\n", "resumen.csv", db, test_user.id)
        )


def test_run_smart_import_rejects_an_empty_statement(db, test_user, monkeypatch):
    monkeypatch.setattr(smart_import_core, "is_configured", lambda: True)
    monkeypatch.setattr(smart_import_core, "_clean_text_for_llm", lambda text: text)
    monkeypatch.setattr(smart_import_core, "get_client", lambda: _fake_llm([]))

    with pytest.raises(ValueError, match="No se encontraron transacciones"):
        __import__("asyncio").run(
            smart_import_core.run_smart_import(b"date,amount\n", "resumen.csv", db, test_user.id)
        )


# ── background task ─────────────────────────────────────────


class _FakeLock:
    def __init__(self, acquired: bool = True):
        self.acquired = acquired
        self.released = False

    def acquire(self, **_kwargs) -> bool:
        return self.acquired

    def release(self) -> None:
        self.released = True


class _FakeRedis:
    def __init__(self, lock: _FakeLock, exists: bool = False):
        self._lock = lock
        self._exists = exists
        self.lock_key = None

    def lock(self, key, timeout=None):
        self.lock_key = key
        return self._lock

    def exists(self, _key) -> bool:
        return self._exists


def _job(db, user, **overrides) -> ImportJob:
    data = {
        "user_id": user.id,
        "filename": "resumen.csv",
        "file_content": b"date,amount\n",
        "status": "PROCESSING",
        "created_at": datetime.utcnow() - timedelta(hours=1),
    }
    data.update(overrides)
    job = ImportJob(**data)
    db.add(job)
    db.flush()
    return job


def test_process_import_job_completes_and_notifies(db, test_user, monkeypatch):
    job = _job(db, test_user)
    lock = _FakeLock()
    monkeypatch.setattr(import_processor, "SessionLocal", lambda: _SessionProxy(db))
    monkeypatch.setattr(import_processor, "redis_client", _FakeRedis(lock))

    async def fake_run(**_kwargs):
        return {"rows": [{"amount": 10}], "summary": {}, "has_missing_data": False}

    monkeypatch.setattr(import_processor, "run_smart_import", fake_run)

    import_processor.process_import_job(job.id)

    db.refresh(job)
    assert job.status == "READY_PREVIEW"
    assert job.completed_at is not None
    assert json.loads(job.preview_data)["rows"] == [{"amount": 10}]
    notification = (
        db.query(Notification)
        .filter(Notification.user_id == test_user.id, Notification.type == "import_ready")
        .one()
    )
    assert json.loads(notification.data)["job_id"] == job.id
    assert lock.released is True


def test_process_import_job_marks_the_job_failed_and_notifies(db, test_user, monkeypatch):
    job = _job(db, test_user)
    lock = _FakeLock()
    monkeypatch.setattr(import_processor, "SessionLocal", lambda: _SessionProxy(db))
    monkeypatch.setattr(import_processor, "redis_client", _FakeRedis(lock))

    async def broken_run(**_kwargs):
        raise RuntimeError("llm exploded")

    monkeypatch.setattr(import_processor, "run_smart_import", broken_run)

    import_processor.process_import_job(job.id)

    db.refresh(job)
    assert job.status == "FAILED"
    assert "llm exploded" in job.error_message
    notification = (
        db.query(Notification)
        .filter(Notification.user_id == test_user.id, Notification.type == "import_failed")
        .one()
    )
    assert json.loads(notification.data)["job_id"] == job.id


def test_process_import_job_queues_when_another_import_holds_the_lock(db, test_user, monkeypatch):
    job = _job(db, test_user)
    lock = _FakeLock()
    monkeypatch.setattr(import_processor, "SessionLocal", lambda: _SessionProxy(db))
    monkeypatch.setattr(import_processor, "redis_client", _FakeRedis(lock, exists=True))

    async def fake_run(**_kwargs):
        return {"rows": [{"amount": 10}], "summary": {}, "has_missing_data": False}

    monkeypatch.setattr(import_processor, "run_smart_import", fake_run)

    import_processor.process_import_job(job.id)

    db.refresh(job)
    assert job.status == "READY_PREVIEW"


def test_process_import_job_fails_when_the_lock_times_out(db, test_user, monkeypatch):
    job = _job(db, test_user)
    lock = _FakeLock(acquired=False)
    monkeypatch.setattr(import_processor, "SessionLocal", lambda: _SessionProxy(db))
    monkeypatch.setattr(import_processor, "redis_client", _FakeRedis(lock))
    called = []
    monkeypatch.setattr(import_processor, "run_smart_import", lambda **_kwargs: called.append(1))

    import_processor.process_import_job(job.id)

    db.refresh(job)
    assert job.status == "FAILED"
    assert "Timeout" in job.error_message
    assert called == []


def test_process_import_job_ignores_a_missing_job(db, monkeypatch):
    monkeypatch.setattr(import_processor, "SessionLocal", lambda: _SessionProxy(db))
    monkeypatch.setattr(import_processor, "redis_client", _FakeRedis(_FakeLock()))
    called = []
    monkeypatch.setattr(import_processor, "run_smart_import", lambda **_kwargs: called.append(1))

    import_processor.process_import_job(999999)

    assert called == []
    assert db.query(Notification).count() == 0
