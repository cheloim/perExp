"""The single spending definition (#509): expenses exclude income."""

from datetime import date

from fastapi.testclient import TestClient

from app.database import get_db
from app.models import Category, Expense, User
from app.services.aggregation import income_totals, spending_totals
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


def _expense(
    db,
    user: User,
    amount: float,
    *,
    currency: str = "ARS",
    is_income: bool = False,
    category: Category | None = None,
) -> Expense:
    description = f"{'income' if is_income else 'expense'} {amount} {currency}"
    expense = Expense(
        user_id=user.id,
        date=date.today(),
        amount=amount,
        currency=currency,
        is_income=is_income,
        category_id=category.id if category else None,
        description=description,
        description_hmac=compute_hmac(description),
    )
    db.add(expense)
    db.flush()
    return expense


def test_spending_totals_excludes_income_and_groups_by_currency(db):
    user = _user(db, "spending@example.com")
    _expense(db, user, 100.0, currency="ARS")
    _expense(db, user, 20.0, currency="USD")
    _expense(db, user, 500.0, currency="ARS", is_income=True)

    assert spending_totals(db, [user.id]) == {"ARS": 100.0, "USD": 20.0}
    assert income_totals(db, [user.id]) == {"ARS": 500.0}


def test_expense_stats_excludes_income(db):
    user = _user(db, "stats@example.com")
    _expense(db, user, 100.0)
    _expense(db, user, 500.0, is_income=True)

    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    try:
        response = TestClient(app).get("/expenses/stats")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json()["total"] == 100.0
    assert response.json()["count"] == 1


def test_by_category_excludes_income(db):
    user = _user(db, "category-stats@example.com")
    category = Category(name="Comida", user_id=user.id)
    db.add(category)
    db.flush()
    _expense(db, user, 100.0, category=category)
    _expense(db, user, 500.0, is_income=True, category=category)

    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    try:
        response = TestClient(app).get("/expenses/by-category")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json() == [
        {
            "category_id": category.id,
            "category_name": "Comida",
            "category_color": category.color,
            "total": 100.0,
            "count": 1,
        }
    ]
