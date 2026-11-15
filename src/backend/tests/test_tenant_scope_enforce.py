"""Enforced tenant scope: budgets, import categories and suggestions (#524b)."""

from datetime import date

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.database import get_db
from app.models import (
    Category,
    CategorySuggestion,
    Expense,
    Group,
    GroupMember,
    ImportJob,
    User,
)
from app.routers.suggestions import (
    approve_all_suggestions,
    approve_suggestion,
    get_pending_suggestions,
)
from app.services import budget_helpers
from app.services.auth import get_current_user, get_password_hash
from app.services.encryption import compute_hmac
from main import app


def _user(db, email: str) -> User:
    user = User(
        email=email,
        full_name=email,
        hashed_password=get_password_hash("testpassword"),
        email_verified=True,
    )
    db.add(user)
    db.flush()
    return user


def _group(db, owner: User, members: list[tuple[User, str]]) -> Group:
    group = Group(name="Familia", created_by=owner.id)
    db.add(group)
    db.flush()
    for user, status in members:
        db.add(
            GroupMember(
                group_id=group.id,
                user_id=user.id,
                status=status,
                role="owner" if user.id == owner.id else "member",
            )
        )
    db.flush()
    return group


def _category(db, user: User, name: str) -> Category:
    category = Category(name=name, user_id=user.id)
    db.add(category)
    db.flush()
    return category


def _expense(db, user: User, description: str = "Compra") -> Expense:
    expense = Expense(
        user_id=user.id,
        date=date.today(),
        amount=100.0,
        currency="ARS",
        description=description,
        description_hmac=compute_hmac(description),
    )
    db.add(expense)
    db.flush()
    return expense


def test_budget_scope_excludes_pending_members(db):
    owner = _user(db, "enforce-owner@example.com")
    accepted = _user(db, "enforce-accepted@example.com")
    pending = _user(db, "enforce-pending@example.com")
    _group(db, owner, [(owner, "accepted"), (accepted, "accepted"), (pending, "pending")])

    assert budget_helpers.get_group_user_ids(owner.id, db) == sorted([owner.id, accepted.id])


def test_import_confirm_does_not_assign_a_foreign_category(db):
    user = _user(db, "import-a@example.com")
    other = _user(db, "import-b@example.com")
    foreign = _category(db, other, "Foreign Cat")
    job = ImportJob(user_id=user.id, filename="resumen.pdf", status="READY_PREVIEW")
    db.add(job)
    db.flush()

    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    try:
        response = TestClient(app).post(
            f"/import-jobs/{job.id}/confirm",
            json={
                "rows": [
                    {
                        "date": "15-11-2026",
                        "amount": "100.00",
                        "description": "Compra importada",
                        "currency": "ARS",
                        "suggested_category": "Foreign Cat",
                    }
                ]
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    expense = (
        db.query(Expense).filter(Expense.user_id == user.id).order_by(Expense.id.desc()).first()
    )
    assert expense is not None
    assert expense.category_id is None
    assert expense.category_id != foreign.id


def test_suggestion_approve_cross_tenant_is_404(db):
    owner = _user(db, "suggest-owner@example.com")
    other = _user(db, "suggest-other@example.com")
    own_category = _category(db, owner, "Propia")
    foreign_expense = _expense(db, other, "Compra ajena")
    suggestion = CategorySuggestion(
        expense_id=foreign_expense.id,
        user_id=owner.id,
        suggested_category_id=own_category.id,
        confidence=0.9,
        status="pending",
    )
    db.add(suggestion)
    db.flush()

    with pytest.raises(HTTPException) as exc:
        approve_suggestion(suggestion.id, db=db, current_user=owner)

    assert exc.value.status_code == 404


def test_approve_all_skips_foreign_expenses(db):
    owner = _user(db, "batch-owner@example.com")
    other = _user(db, "batch-other@example.com")
    own_category = _category(db, owner, "Propia")
    own_expense = _expense(db, owner, "Compra propia")
    foreign_expense = _expense(db, other, "Compra ajena")
    for expense in (own_expense, foreign_expense):
        db.add(
            CategorySuggestion(
                expense_id=expense.id,
                user_id=owner.id,
                suggested_category_id=own_category.id,
                confidence=0.9,
                status="pending",
            )
        )
    db.flush()

    result = approve_all_suggestions(min_confidence=0.0, db=db, current_user=owner)

    assert result["count"] == 1
    assert own_expense.category_id == own_category.id
    assert foreign_expense.category_id is None


def test_pending_suggestions_hides_foreign_expenses(db):
    owner = _user(db, "list-owner@example.com")
    other = _user(db, "list-other@example.com")
    own_category = _category(db, owner, "Propia")
    foreign_expense = _expense(db, other, "Compra ajena")
    db.add(
        CategorySuggestion(
            expense_id=foreign_expense.id,
            user_id=owner.id,
            suggested_category_id=own_category.id,
            confidence=0.9,
            status="pending",
        )
    )
    db.flush()

    assert get_pending_suggestions(status="pending", db=db, current_user=owner) == []
