"""Foreign-key ownership on expense writes (issue #481, same primitive).

`create_expense` validated `card_id`/`account_id` but not `category_id`, so a
client could point an expense at another user's category and read its name
straight from `GET /expenses`. The update path and the scheduled-expense
update accepted foreign ids too. Everything here is the same rule the
category tree uses: a referenced row must belong to the caller.
"""

import json
from datetime import date

import pytest
from fastapi import HTTPException


def _make_category(db, user, name):
    from app.models import Category

    cat = Category(name=name, user_id=user.id)
    db.add(cat)
    db.flush()
    return cat


def _other_user(db):
    from app.models import User
    from app.services.auth import get_password_hash

    user = User(
        email="other-fk-owner@example.com",
        full_name="Other, Owner",
        hashed_password=get_password_hash("password"),
        email_verified=True,
    )
    db.add(user)
    db.flush()
    return user


class TestExpenseCategoryOwnership:
    def test_create_expense_rejects_foreign_category(self, db, test_user):
        from app.routers.expenses import create_expense
        from app.schemas import ExpenseCreate

        foreign = _make_category(db, _other_user(db), "Categoría ajena")

        with pytest.raises(HTTPException) as exc:
            create_expense(
                ExpenseCreate(
                    amount=100.0,
                    description="Compra",
                    date=date.today(),
                    category_id=foreign.id,
                ),
                db=db,
                current_user=test_user,
            )

        assert exc.value.status_code == 404

    def test_create_expense_accepts_own_category(self, db, test_user):
        from app.routers.expenses import create_expense
        from app.schemas import ExpenseCreate

        own = _make_category(db, test_user, "Mia")

        created = create_expense(
            ExpenseCreate(
                amount=100.0,
                description="Compra",
                date=date.today(),
                category_id=own.id,
            ),
            db=db,
            current_user=test_user,
        )

        assert created.category_id == own.id

    def test_update_expense_rejects_foreign_category(self, db, test_user):
        from app.models import Expense
        from app.services.expense_update import ExpenseEditError, update_expense_checked

        expense = Expense(
            amount=100.0, description="Compra", date=date.today(), user_id=test_user.id
        )
        db.add(expense)
        db.flush()
        foreign = _make_category(db, _other_user(db), "Categoría ajena")

        with pytest.raises(ExpenseEditError):
            update_expense_checked(db, test_user.id, expense, {"category_id": foreign.id})

    def test_update_expense_rejects_foreign_card(self, db, test_user):
        from app.models import Card, Expense
        from app.services.expense_update import ExpenseEditError, update_expense_checked

        expense = Expense(
            amount=100.0, description="Compra", date=date.today(), user_id=test_user.id
        )
        db.add(expense)
        db.flush()
        foreign_card = Card(card_name="Visa ajena", bank="X", user_id=_other_user(db).id)
        db.add(foreign_card)
        db.flush()

        with pytest.raises(ExpenseEditError):
            update_expense_checked(db, test_user.id, expense, {"card_id": foreign_card.id})


class TestScheduledExpenseCategoryOwnership:
    def test_update_rejects_foreign_category(self, db, test_user):
        from app.models import ScheduledExpense
        from app.routers.scheduled_expenses import update_scheduled_expense

        scheduled = ScheduledExpense(
            user_id=test_user.id,
            description="Cuota",
            amount=100.0,
            scheduled_date=date.today(),
            status="PENDING",
            installment_group_id="grp-e2e",
            installment_number=1,
            installment_total=3,
        )
        db.add(scheduled)
        db.flush()
        foreign = _make_category(db, _other_user(db), "Categoría ajena")

        with pytest.raises(HTTPException) as exc:
            update_scheduled_expense(
                scheduled.id,
                {"category_id": foreign.id},
                db=db,
                current_user=test_user,
            )

        assert exc.value.status_code == 404


class TestAnalysisCategoryScoping:
    def test_cat_map_excludes_foreign_categories(self, db, test_user):
        """The analysis map is user-scoped, so a foreign name cannot leak into
        a row's label even when an expense carries a foreign category_id."""
        from app.models import Expense
        from app.routers.analysis import _cat_name, _load_cat_map

        own = _make_category(db, test_user, "Mia")
        foreign = _make_category(db, _other_user(db), "SECRETO AJENO")
        expense = Expense(
            amount=100.0,
            description="Compra",
            date=date.today(),
            user_id=test_user.id,
            category_id=foreign.id,
        )
        db.add(expense)
        db.flush()

        cat_map = _load_cat_map(db, test_user.id)

        assert foreign.id not in cat_map
        assert own.id in cat_map
        assert "SECRETO AJENO" not in _cat_name(expense, cat_map)


class TestReportContextScoping:
    def test_foreign_parent_never_names_a_report_row(self, db, test_user):
        """A foreign parent whose name looks like a store name must not leak
        through the hierarchical label of the monthly report context."""
        from datetime import date as _date

        from app.models import Expense
        from app.services.report_context import get_report_context

        foreign = _make_category(db, _other_user(db), "SECRETO SUPERMERCADO")
        child = _make_category(db, test_user, "Hijo")
        child.parent_id = foreign.id
        db.flush()
        db.add(
            Expense(
                amount=100.0,
                description="Compra",
                date=_date.today(),
                user_id=test_user.id,
                category_id=child.id,
            )
        )
        db.flush()

        report = get_report_context([test_user.id], db, _date.today())

        assert "SECRETO" not in json.dumps(report, default=str)

    def test_foreign_category_never_names_a_report_row(self, db, test_user):
        from datetime import date as _date

        from app.models import Expense
        from app.services.report_context import get_report_context

        foreign = _make_category(db, _other_user(db), "SECRETO SUPERMERCADO")
        db.add(
            Expense(
                amount=100.0,
                description="Compra",
                date=_date.today(),
                user_id=test_user.id,
                category_id=foreign.id,
            )
        )
        db.flush()

        report = get_report_context([test_user.id], db, _date.today())

        assert "SECRETO" not in json.dumps(report, default=str)
