"""Tests for multi-level budget alerts (issue #171).

Levels default to [0.75, 0.90, 1.0]. Alerts fire once per level per month.
"""

from datetime import date


def _make_user(db, email):
    from app.models import User
    from app.services.auth import get_password_hash

    user = User(
        email=email,
        full_name="Alert User",
        hashed_password=get_password_hash("testpassword"),
        email_verified=True,
    )
    db.add(user)
    db.flush()
    return user


def _make_category(db, user, name):
    from app.models import Category

    cat = Category(name=name, user_id=user.id, budget_group="necesidades")
    db.add(cat)
    db.flush()
    return cat


def _make_expense(db, user, amount, category_id, date_):
    from app.models import Expense
    from app.services.encryption import compute_hmac

    desc = f"alert {amount} {date_.isoformat()} {category_id}"
    expense = Expense(
        date=date_,
        description=desc,
        description_hmac=compute_hmac(desc),
        amount=amount,
        category_id=category_id,
        user_id=user.id,
        is_income=False,
    )
    db.add(expense)
    db.flush()
    return expense


class TestAlertLevelsHelper:
    def test_default_levels(self):
        from app.services.budget_helpers import DEFAULT_ALERT_LEVELS

        assert DEFAULT_ALERT_LEVELS == [0.75, 0.90, 1.0]

    def test_get_levels_from_budget_json(self, db):
        from app.models import Budget
        from app.services.budget_helpers import get_alert_levels

        user = _make_user(db, "levels1@test.com")
        cat = _make_category(db, user, "Supermercado")
        budget = Budget(
            user_id=user.id,
            category_id=cat.id,
            amount=100000,
            alert_thresholds="[0.75, 0.9, 1.0]",
        )
        assert get_alert_levels(budget) == [0.75, 0.9, 1.0]

    def test_get_levels_fallback_to_legacy_threshold(self, db):
        from app.models import Budget
        from app.services.budget_helpers import get_alert_levels

        user = _make_user(db, "levels2@test.com")
        cat = _make_category(db, user, "Taxi")
        budget = Budget(user_id=user.id, category_id=cat.id, amount=50000, alert_threshold=0.8)
        assert get_alert_levels(budget) == [0.8]

    def test_levels_crossed(self):
        from app.services.budget_helpers import levels_crossed

        assert levels_crossed(0.5, [0.75, 0.9, 1.0]) == []
        assert levels_crossed(0.8, [0.75, 0.9, 1.0]) == [0.75]
        assert levels_crossed(0.95, [0.75, 0.9, 1.0]) == [0.75, 0.9]
        assert levels_crossed(1.2, [0.75, 0.9, 1.0]) == [0.75, 0.9, 1.0]


class TestEscalatedNotifications:
    def test_first_cross_creates_one_notification_per_level(self, db):
        from app.models import Budget, Notification
        from app.services.budget_helpers import check_budget_threshold_on_expense

        user = _make_user(db, "esc1@test.com")
        cat = _make_category(db, user, "Delivery")
        budget = Budget(
            user_id=user.id,
            category_id=cat.id,
            amount=10000,
            alert_thresholds="[0.75, 0.9, 1.0]",
        )
        db.add(budget)
        db.flush()

        today = date.today()
        _make_expense(db, user, 8000, cat.id, today)  # 80% -> crosses 0.75 only
        check_budget_threshold_on_expense(db, user.id, cat.id, 8000)
        db.commit()

        notifs = (
            db.query(Notification)
            .filter(
                Notification.user_id == user.id,
                Notification.type == "budget_warning",
            )
            .all()
        )
        assert len(notifs) == 1
        assert '"level": 0.75' in notifs[0].data

    def test_second_level_creates_second_notification(self, db):
        from app.models import Budget, Notification
        from app.services.budget_helpers import check_budget_threshold_on_expense

        user = _make_user(db, "esc2@test.com")
        cat = _make_category(db, user, "Restaurantes")
        budget = Budget(
            user_id=user.id,
            category_id=cat.id,
            amount=10000,
            alert_thresholds="[0.75, 0.9, 1.0]",
        )
        db.add(budget)
        db.flush()

        today = date.today()
        _make_expense(db, user, 8000, cat.id, today)
        check_budget_threshold_on_expense(db, user.id, cat.id, 8000)
        db.commit()
        _make_expense(db, user, 2000, cat.id, today)  # total 100% -> crosses 0.9 + 1.0
        check_budget_threshold_on_expense(db, user.id, cat.id, 2000)
        db.commit()

        notifs = (
            db.query(Notification)
            .filter(
                Notification.user_id == user.id,
                Notification.type == "budget_warning",
            )
            .all()
        )
        levels = sorted(
            __import__("json").loads(n.data)["level"] for n in notifs if "level" in n.data
        )
        assert levels == [0.75, 0.9, 1.0]

    def test_no_duplicate_for_same_level(self, db):
        from app.models import Budget, Notification
        from app.services.budget_helpers import check_budget_threshold_on_expense

        user = _make_user(db, "esc3@test.com")
        cat = _make_category(db, user, "Combustible")
        budget = Budget(
            user_id=user.id,
            category_id=cat.id,
            amount=10000,
            alert_thresholds="[0.75, 0.9, 1.0]",
        )
        db.add(budget)
        db.flush()

        today = date.today()
        _make_expense(db, user, 8000, cat.id, today)
        check_budget_threshold_on_expense(db, user.id, cat.id, 8000)
        db.commit()
        _make_expense(db, user, 100, cat.id, today)  # still 81%, same level
        check_budget_threshold_on_expense(db, user.id, cat.id, 100)
        db.commit()

        notifs = (
            db.query(Notification)
            .filter(
                Notification.user_id == user.id,
                Notification.type == "budget_warning",
            )
            .all()
        )
        assert len(notifs) == 1
