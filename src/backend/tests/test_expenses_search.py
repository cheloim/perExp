"""Tests for free-text search on GET /expenses (issue #420).

description, notes and category name are EncryptedType columns, so search
matches at application level: decrypt, normalize with tokenize_description
(case- and accent-insensitive) and substring-match.
"""

from app.services.expense_search import expense_matches

# ── Pure matcher ──────────────────────────────────────────────


class TestExpenseMatches:
    def test_search_matches_description(self):
        assert expense_matches("super", "Compra Supermercado", "", None) is True

    def test_search_matches_notes(self):
        assert expense_matches("regalo", "Compra", "regalo de cumple", None) is True

    def test_search_matches_category_name(self):
        assert expense_matches("super", "Algo", "", "Supermercado") is True

    def test_search_is_accent_and_case_insensitive(self):
        assert expense_matches("farmacia", "FARMACÍA central", "", None) is True

    def test_search_no_match_returns_false(self):
        assert expense_matches("viaje", "Compra Supermercado", "", None) is False

    def test_empty_search_matches_everything(self):
        assert expense_matches("", "x", "", None) is True
        assert expense_matches("   ", "x", "", None) is True

    def test_match_does_not_span_fields(self):
        # "ia super" would only match across the description/category boundary
        assert expense_matches("ia super", "farmacia", "", "supermercado") is False


# ── GET /expenses?search= ─────────────────────────────────────


def _make_expense(db, user_id, description, notes="", category_id=None):
    from app.models import Expense

    expense = Expense(
        amount=100.0,
        description=description,
        notes=notes,
        date="2026-10-01",
        user_id=user_id,
        category_id=category_id,
    )
    db.add(expense)
    db.flush()
    return expense


class TestSearchFilter:
    def test_search_matches_description_without_notes_or_category(self, db, test_user):
        from app.routers.expenses import get_expenses

        expense = _make_expense(db, test_user.id, "Farmacía Central", notes=None)

        results = get_expenses(search="farm", db=db, current_user=test_user)

        assert [e.id for e in results] == [expense.id]

    def test_search_matches_category_name(self, db, test_user):
        from app.models import Category
        from app.routers.expenses import get_expenses

        category = Category(name="Supermercado", user_id=test_user.id)
        db.add(category)
        db.flush()
        expense = _make_expense(db, test_user.id, "Compra semanal", category_id=category.id)
        _make_expense(db, test_user.id, "Nafta")

        results = get_expenses(search="super", db=db, current_user=test_user)

        assert [e.id for e in results] == [expense.id]

    def test_search_no_match_returns_empty(self, db, test_user):
        from app.routers.expenses import get_expenses

        _make_expense(db, test_user.id, "Compra Supermercado")

        assert get_expenses(search="viaje", db=db, current_user=test_user) == []

    def test_search_scoped_to_current_user_group(self, db, test_user):
        from app.models import User
        from app.routers.expenses import get_expenses
        from app.services.auth import get_password_hash

        other_user = User(
            email="other@example.com",
            full_name="Other User",
            hashed_password=get_password_hash("password"),
            email_verified=True,
        )
        db.add(other_user)
        db.flush()
        mine = _make_expense(db, test_user.id, "Farmacia del barrio")
        _make_expense(db, other_user.id, "Farmacia otro usuario")

        results = get_expenses(search="farmacia", db=db, current_user=test_user)

        assert [e.id for e in results] == [mine.id]

    def test_empty_search_returns_all(self, db, test_user):
        from app.routers.expenses import get_expenses

        _make_expense(db, test_user.id, "Compra Supermercado")
        _make_expense(db, test_user.id, "Nafta")

        assert len(get_expenses(search="", db=db, current_user=test_user)) == 2
        assert len(get_expenses(db=db, current_user=test_user)) == 2


class TestSearchPagination:
    def test_search_respects_skip_and_limit(self, db, test_user):
        from app.routers.expenses import get_expenses

        made = [_make_expense(db, test_user.id, f"Farmacia {i}") for i in range(5)]
        _make_expense(db, test_user.id, "Nafta")

        pages = [
            get_expenses(search="farmacia", db=db, current_user=test_user, limit=2, skip=skip)
            for skip in (0, 2, 4)
        ]
        flat = [e.id for page in pages for e in page]

        # pages partition the matches: complete coverage, no duplicates
        assert sorted(flat) == sorted(e.id for e in made)
        assert len(set(flat)) == 5
        assert len(pages[2]) == 1

    def test_search_skip_beyond_results_returns_empty(self, db, test_user):
        from app.routers.expenses import get_expenses

        _make_expense(db, test_user.id, "Farmacia Central")

        assert get_expenses(search="farmacia", db=db, current_user=test_user, skip=10) == []
