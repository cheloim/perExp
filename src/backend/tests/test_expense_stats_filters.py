"""Stats and breakdowns honor the same filters as the list (issue #477).

The cards and charts on /expenses showed month totals while the table
honored every filter (including the text search): numbers above and rows
below disagreed. They now share apply_expense_filters, so what the cards
say matches what the table shows.
"""

from datetime import date


def _make_expense(db, user_id, description, amount=100.0, cat=None):
    from app.models import Expense

    expense = Expense(
        amount=amount,
        description=description,
        date=date(2026, 10, 1),
        user_id=user_id,
        category_id=cat.id if cat else None,
    )
    db.add(expense)
    db.flush()
    return expense


class TestStatsHonorFilters:
    def test_stats_honor_search(self, db, test_user):
        from app.routers.expenses import get_expense_stats

        _make_expense(db, test_user.id, "Farmacia Central", amount=200.0)
        _make_expense(db, test_user.id, "Nafta", amount=500.0)

        stats = get_expense_stats(search="farmacia", db=db, current_user=test_user)

        assert stats.count == 1
        assert stats.total == 200.0

    def test_stats_honor_date_range(self, db, test_user):
        from app.models import Expense
        from app.routers.expenses import get_expense_stats

        _make_expense(db, test_user.id, "Octubre", amount=100.0)
        old = Expense(
            amount=300.0,
            description="Agosto",
            date=date(2026, 8, 1),
            user_id=test_user.id,
        )
        db.add(old)
        db.flush()

        stats = get_expense_stats(date_from=date(2026, 10, 1), db=db, current_user=test_user)

        assert stats.count == 1
        assert stats.total == 100.0

    def test_stats_scoped_to_group(self, db, test_user):
        from app.models import User
        from app.routers.expenses import get_expense_stats
        from app.services.auth import get_password_hash

        other = User(
            email="other-stats@example.com",
            full_name="Other",
            hashed_password=get_password_hash("password"),
            email_verified=True,
        )
        db.add(other)
        db.flush()
        _make_expense(db, test_user.id, "Farmacia mia", amount=100.0)
        _make_expense(db, other.id, "Farmacia ajena", amount=900.0)

        stats = get_expense_stats(search="farmacia", db=db, current_user=test_user)

        assert stats.count == 1
        assert stats.total == 100.0


class TestBreakdownsHonorFilters:
    def test_by_category_honors_search(self, db, test_user):
        from app.models import Category
        from app.routers.expenses import get_expenses_by_category

        cat = Category(name="Salud", user_id=test_user.id)
        db.add(cat)
        db.flush()
        _make_expense(db, test_user.id, "Farmacia", amount=200.0, cat=cat)
        _make_expense(db, test_user.id, "Nafta", amount=500.0, cat=cat)

        rows = get_expenses_by_category(search="farmacia", db=db, current_user=test_user)

        assert [(r.category_name, r.total, r.count) for r in rows] == [("Salud", 200.0, 1)]

    def test_by_person_honors_search(self, db, test_user):
        from app.routers.expenses import get_expenses_by_person

        _make_expense(db, test_user.id, "Farmacia", amount=200.0)
        _make_expense(db, test_user.id, "Nafta", amount=500.0)

        rows = get_expenses_by_person(search="farmacia", db=db, current_user=test_user)

        assert len(rows) == 1
        assert rows[0].total == 200.0
        assert rows[0].count == 1


class TestStatsAgreeWithList:
    def test_search_count_matches_list_length(self, db, test_user):
        """The card above and the table below must tell the same story."""
        from app.routers.expenses import get_expense_stats, get_expenses

        _make_expense(db, test_user.id, "Farmacia 1", amount=100.0)
        _make_expense(db, test_user.id, "Farmacia 2", amount=200.0)
        _make_expense(db, test_user.id, "Nafta", amount=500.0)

        rows = get_expenses(search="farmacia", db=db, current_user=test_user)
        stats = get_expense_stats(search="farmacia", db=db, current_user=test_user)

        assert stats.count == len(rows) == 2
        assert stats.total == sum(e.amount for e in rows) == 300.0
