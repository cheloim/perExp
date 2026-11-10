"""Integration test: an imported statement row reconciles a recurring projection."""

import os
from datetime import date, datetime

os.environ.setdefault("SECRET_KEY", "test-secret-key-that-is-at-least-32-chars-long-for-testing")

from fastapi.testclient import TestClient

from app.database import get_db
from app.models import Card, Expense, ImportJob, RecurringExpense
from app.services.auth import get_current_user
from main import app


def test_confirm_import_reconciles_projection_with_card(db, test_user):
    card = Card(
        card_name="Visa",
        bank="Galicia",
        holder="Test",
        card_type="credito",
        user_id=test_user.id,
    )
    recurring = RecurringExpense(
        user_id=test_user.id,
        merchant_key="NETFLIX",
        description="NETFLIX",
        amount=6990.0,
        currency="ARS",
        frequency="monthly",
        next_charge_date=date(2026, 12, 1),
        is_active=True,
        source="manual",
    )
    db.add_all([card, recurring])
    db.flush()

    projection = Expense(
        user_id=test_user.id,
        date=date(2026, 11, 1),
        description="NETFLIX",
        amount=6990.0,
        currency="ARS",
        recurring_expense_id=recurring.id,
        is_recurring_projection=True,
    )
    job = ImportJob(
        user_id=test_user.id,
        filename="resumen.pdf",
        status="READY_PREVIEW",
        created_at=datetime.utcnow(),
    )
    db.add_all([projection, job])
    db.flush()

    payload = {
        "rows": [
            {
                "date": "03-11-2026",
                "description": "NETFLIX.COM",
                "amount": 6990.0,
                "currency": "ARS",
                "card_header": "Galicia Visa",
                "transaction_id": "123456",
                "is_scheduled": False,
                "is_duplicate": False,
            }
        ],
        "cards_mapping": {"Galicia Visa": {"card_id": card.id}},
    }

    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: test_user
    try:
        response = TestClient(app).post(f"/import-jobs/{job.id}/confirm", json=payload)
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json() == {"imported": 1, "skipped": 0, "scheduled": 0}

    db.refresh(projection)
    assert projection.is_recurring_projection is False
    assert projection.date == date(2026, 11, 3)
    assert projection.description == "NETFLIX.COM"
    assert projection.transaction_id == "123456"
    assert projection.card_id == card.id
    assert projection.recurring_expense_id == recurring.id
    assert db.query(Expense).filter(Expense.user_id == test_user.id).count() == 1
