"""Aggregations for manually recorded current-installment series."""

from datetime import date

from app.models import Category, Expense, User
from app.routers.dashboard import get_credit_card_pasivos, get_installments_dashboard
from app.services.auth import get_password_hash
from app.services.encryption import compute_hmac


def _user(db, email):
    user = User(
        email=email,
        full_name="Installment Aggregation",
        hashed_password=get_password_hash("testpassword"),
        email_verified=True,
    )
    db.add(user)
    db.flush()
    return user


def _expense(db, user, *, number, total, amount=10000, group="group-1"):
    category = Category(name="Streaming", user_id=user.id)
    db.add(category)
    db.flush()
    expense = Expense(
        date=date.today(),
        description="Netflix",
        description_hmac=compute_hmac("Netflix"),
        amount=amount,
        currency="ARS",
        installment_number=number,
        installment_total=total,
        installment_group_id=group,
        category_id=category.id,
        user_id=user.id,
    )
    db.add(expense)
    db.flush()
    return expense


def test_current_installment_series_reports_the_real_remaining_count(db):
    user = _user(db, "agg-current@test.com")
    _expense(db, user, number=3, total=12)

    groups = get_installments_dashboard(db=db, current_user=user)

    assert len(groups) == 1
    assert groups[0]["remaining_installments"] == 9


def test_last_installment_has_nothing_remaining(db):
    user = _user(db, "agg-last@test.com")
    _expense(db, user, number=12, total=12)

    groups = get_installments_dashboard(db=db, current_user=user)

    assert len(groups) == 1
    assert groups[0]["remaining_installments"] == 0


def test_pasivos_projects_from_the_highest_recorded_installment(db):
    user = _user(db, "agg-pasivos@test.com")
    _expense(db, user, number=3, total=12)

    result = get_credit_card_pasivos(db=db, current_user=user)

    assert result["total_pasivos"] == 90000
    assert len(result["pasivos"]) == 9
    assert [row["installment_number"] for row in result["pasivos"]] == list(range(4, 13))
