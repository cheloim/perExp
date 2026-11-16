"""Import reliability (#522): amount formats, chunking and double-confirm."""

import pytest
from fastapi.testclient import TestClient

from app.database import get_db
from app.models import Expense, ImportJob, User
from app.services.amounts import parse_amount
from app.services.auth import get_current_user, get_password_hash
from app.services.smart_import_core import _chunk_text, _dedupe_import_rows
from main import app


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("1.234,56", 1234.56),
        ("1,234.56", 1234.56),
        ("1234,56", 1234.56),
        ("1234.56", 1234.56),
        ("$ 1.234,56", 1234.56),
        ("1.234", 1234.0),
        ("1,234", 1234.0),
        ("(1.234,56)", -1234.56),
        ("-1.234,56", -1234.56),
        (1000, 1000.0),
    ],
)
def test_parse_amount_formats(raw, expected):
    assert parse_amount(raw) == pytest.approx(expected)


@pytest.mark.parametrize("raw", [None, "", "abc", "-", "."])
def test_parse_amount_rejects_garbage(raw):
    assert parse_amount(raw) is None


def test_chunk_text_keeps_a_short_text_whole():
    assert _chunk_text("hola\nmundo") == ["hola\nmundo"]


def test_chunk_text_splits_with_overlap():
    text = "\n".join(f"linea {i} " + "x" * 80 for i in range(600))
    chunks = _chunk_text(text, max_chars=5000, overlap=300)

    assert len(chunks) > 1
    assert all(len(chunk) <= 5000 for chunk in chunks)
    assert chunks[1].startswith(chunks[0][-300:])


def test_dedupe_import_rows_drops_overlap_duplicates():
    row = {"date": "15-11-2026", "amount": "100", "description": "Compra", "transaction_id": "t1"}
    assert _dedupe_import_rows([row, dict(row)]) == [row]


def _user(db) -> User:
    user = User(
        email="import-reliability@example.com",
        full_name="Import",
        hashed_password=get_password_hash("testpassword"),
        email_verified=True,
    )
    db.add(user)
    db.flush()
    return user


def test_double_confirm_does_not_duplicate(db):
    user = _user(db)
    job = ImportJob(user_id=user.id, filename="resumen.pdf", status="READY_PREVIEW")
    db.add(job)
    db.flush()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    payload = {
        "rows": [
            {
                "date": "15-11-2026",
                "amount": "1.234,56",
                "description": "Compra importada",
                "currency": "ARS",
            }
        ]
    }
    try:
        client = TestClient(app)
        first = client.post(f"/import-jobs/{job.id}/confirm", json=payload)
        second = client.post(f"/import-jobs/{job.id}/confirm", json=payload)
    finally:
        app.dependency_overrides.clear()

    assert first.status_code == 200
    assert second.status_code == 400
    expenses = db.query(Expense).filter(Expense.user_id == user.id).all()
    assert len(expenses) == 1
    assert expenses[0].amount == pytest.approx(1234.56)
