"""Server-side ordering for GET /expenses (issue #512).

Sorting used to happen in the browser over the rows already fetched, so
``sort=amount`` only ordered the first page and "Ver más" appended rows out of
order. Date and amount are plain columns, so the order belongs in SQL and must
be applied before offset/limit.
"""

from datetime import date


def _make_expense(db, user_id, description, when, amount):
    from app.models import Expense

    expense = Expense(
        amount=amount,
        description=description,
        date=when,
        user_id=user_id,
    )
    db.add(expense)
    db.flush()
    return expense


def _make_category(db, user_id, name):
    from app.models import Category

    category = Category(name=name, user_id=user_id)
    db.add(category)
    db.flush()
    return category


def _descriptions(results):
    return [expense.description for expense in results]


class TestExpenseOrdering:
    def test_default_order_is_date_desc(self, db, test_user):
        from app.routers.expenses import get_expenses

        _make_expense(db, test_user.id, "Viejo", date(2026, 9, 1), 100.0)
        _make_expense(db, test_user.id, "Nuevo", date(2026, 11, 1), 100.0)
        _make_expense(db, test_user.id, "Medio", date(2026, 10, 1), 100.0)

        results = get_expenses(db=db, current_user=test_user)

        assert _descriptions(results) == ["Nuevo", "Medio", "Viejo"]

    def test_date_asc(self, db, test_user):
        from app.routers.expenses import get_expenses

        _make_expense(db, test_user.id, "Viejo", date(2026, 9, 1), 100.0)
        _make_expense(db, test_user.id, "Nuevo", date(2026, 11, 1), 100.0)
        _make_expense(db, test_user.id, "Medio", date(2026, 10, 1), 100.0)

        results = get_expenses(sort="date", direction="asc", db=db, current_user=test_user)

        assert _descriptions(results) == ["Viejo", "Medio", "Nuevo"]

    def test_amount_desc(self, db, test_user):
        from app.routers.expenses import get_expenses

        _make_expense(db, test_user.id, "Chico", date(2026, 10, 1), 50.0)
        _make_expense(db, test_user.id, "Grande", date(2026, 10, 2), 900.0)
        _make_expense(db, test_user.id, "Medio", date(2026, 10, 3), 300.0)

        results = get_expenses(sort="amount", direction="desc", db=db, current_user=test_user)

        assert _descriptions(results) == ["Grande", "Medio", "Chico"]

    def test_amount_asc(self, db, test_user):
        from app.routers.expenses import get_expenses

        _make_expense(db, test_user.id, "Chico", date(2026, 10, 1), 50.0)
        _make_expense(db, test_user.id, "Grande", date(2026, 10, 2), 900.0)
        _make_expense(db, test_user.id, "Medio", date(2026, 10, 3), 300.0)

        results = get_expenses(sort="amount", direction="asc", db=db, current_user=test_user)

        assert _descriptions(results) == ["Chico", "Medio", "Grande"]

    def test_pagination_slices_the_ordered_dataset(self, db, test_user):
        from app.routers.expenses import get_expenses

        _make_expense(db, test_user.id, "Chico", date(2026, 10, 1), 50.0)
        _make_expense(db, test_user.id, "Grande", date(2026, 10, 2), 900.0)
        _make_expense(db, test_user.id, "Medio", date(2026, 10, 3), 300.0)

        results = get_expenses(
            sort="amount", direction="asc", skip=1, limit=1, db=db, current_user=test_user
        )

        assert _descriptions(results) == ["Medio"]

    def test_sort_applies_to_the_whole_filtered_dataset(self, db, test_user):
        from app.models import Expense
        from app.routers.expenses import get_expenses

        _make_expense(db, test_user.id, "Octubre chico", date(2026, 10, 1), 50.0)
        _make_expense(db, test_user.id, "Octubre grande", date(2026, 10, 2), 900.0)
        _make_expense(db, test_user.id, "Noviembre", date(2026, 11, 1), 5000.0)
        old = Expense(
            amount=9999.0,
            description="Septiembre",
            date=date(2026, 9, 1),
            user_id=test_user.id,
        )
        db.add(old)
        db.flush()

        results = get_expenses(
            month="2026-10",
            sort="amount",
            direction="desc",
            db=db,
            current_user=test_user,
        )

        assert _descriptions(results) == ["Octubre grande", "Octubre chico"]

    def test_category_sort_orders_the_whole_filtered_dataset(self, db, test_user):
        from app.models import Expense
        from app.routers.expenses import get_expenses

        salud = _make_category(db, test_user.id, "Salud")
        transporte = _make_category(db, test_user.id, "Transporte")
        comida = _make_category(db, test_user.id, "Comida")
        rows = [
            (comida, "Octubre comida", date(2026, 10, 1)),
            (transporte, "Octubre transporte", date(2026, 10, 2)),
            (salud, "Octubre salud", date(2026, 10, 3)),
            (comida, "Noviembre comida", date(2026, 11, 1)),
        ]
        for category, description, when in rows:
            db.add(
                Expense(
                    amount=100.0,
                    description=description,
                    date=when,
                    user_id=test_user.id,
                    category_id=category.id,
                )
            )
        db.flush()

        results = get_expenses(
            month="2026-10",
            sort="category",
            direction="asc",
            db=db,
            current_user=test_user,
        )

        # The other months are filtered out before ordering, and the order is
        # the category name, not the date or the insertion order.
        assert _descriptions(results) == [
            "Octubre comida",
            "Octubre salud",
            "Octubre transporte",
        ]

    def test_category_sort_keeps_uncategorized_last_and_paginates_in_order(self, db, test_user):
        from app.models import Expense
        from app.routers.expenses import get_expenses

        zeta = _make_category(db, test_user.id, "Zeta")
        alfa = _make_category(db, test_user.id, "Alfa")
        for category, description in [
            (zeta, "Zeta"),
            (None, "Sin categoría"),
            (alfa, "Alfa"),
        ]:
            db.add(
                Expense(
                    amount=100.0,
                    description=description,
                    date=date(2026, 10, 1),
                    user_id=test_user.id,
                    category_id=category.id if category else None,
                )
            )
        db.flush()

        full = get_expenses(sort="category", direction="asc", db=db, current_user=test_user)
        assert _descriptions(full) == ["Alfa", "Zeta", "Sin categoría"]

        # "Ver más" appends the next slice of the same order.
        page = get_expenses(
            sort="category", direction="asc", skip=1, limit=2, db=db, current_user=test_user
        )
        assert _descriptions(page) == ["Zeta", "Sin categoría"]


def test_unsupported_sort_field_is_rejected(db, test_user):
    from fastapi.testclient import TestClient

    from app.database import get_db
    from app.services.auth import get_current_user
    from main import app

    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: test_user
    try:
        response = TestClient(app).get("/expenses?sort=description")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 422
