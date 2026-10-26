"""Category tree ownership (issue #481).

`parent_id` is user-supplied and was never validated at write time, so a
category could point into another user's tree and the hierarchical labels
("Padre > Hijo") fed the assistant, the monthly report and the Telegram bot
with foreign category names. Writes now reject foreign parents, and every
parent resolution shares one rule: a parent only belongs to the tree when it
shares its owner with the child, walking cycle-safe.
"""

import json

import pytest
from fastapi import HTTPException


def _make_category(db, user, name, parent_id=None):
    from app.models import Category

    cat = Category(name=name, user_id=user.id, parent_id=parent_id)
    db.add(cat)
    db.flush()
    return cat


def _other_user(db):
    from app.models import User
    from app.services.auth import get_password_hash

    user = User(
        email="other-tree-owner@example.com",
        full_name="Other, Owner",
        hashed_password=get_password_hash("password"),
        email_verified=True,
    )
    db.add(user)
    db.flush()
    return user


# ── Writes: parent_id must belong to the caller ──────────────────────


class TestParentOwnershipOnWrite:
    def test_create_rejects_foreign_parent(self, db, test_user):
        from app.routers.categories import create_category
        from app.schemas import CategoryCreate

        foreign = _make_category(db, _other_user(db), "Padre ajeno")

        with pytest.raises(HTTPException) as exc:
            create_category(
                CategoryCreate(name="Hijo", parent_id=foreign.id),
                db=db,
                current_user=test_user,
            )

        # 404, not 400: a 400 would confirm the id exists
        assert exc.value.status_code == 404

    def test_create_accepts_own_parent(self, db, test_user):
        from app.routers.categories import create_category
        from app.schemas import CategoryCreate

        parent = _make_category(db, test_user, "Padre")

        created = create_category(
            CategoryCreate(name="Hijo", parent_id=parent.id), db=db, current_user=test_user
        )

        assert created.parent_id == parent.id

    def test_update_rejects_foreign_parent(self, db, test_user):
        from app.routers.categories import update_category
        from app.schemas import CategoryCreate

        own = _make_category(db, test_user, "Mia")
        foreign = _make_category(db, _other_user(db), "Padre ajeno")

        with pytest.raises(HTTPException) as exc:
            update_category(
                own.id,
                CategoryCreate(name="Mia", parent_id=foreign.id),
                db=db,
                current_user=test_user,
            )

        assert exc.value.status_code == 404

    def test_update_rejects_self_parent(self, db, test_user):
        from app.routers.categories import update_category
        from app.schemas import CategoryCreate

        own = _make_category(db, test_user, "Mia")

        with pytest.raises(HTTPException) as exc:
            update_category(
                own.id, CategoryCreate(name="Mia", parent_id=own.id), db=db, current_user=test_user
            )

        assert exc.value.status_code == 400

    def test_update_rejects_descendant_parent(self, db, test_user):
        """a.parent = b with b.parent = a would make every tree walk loop."""
        from app.routers.categories import update_category
        from app.schemas import CategoryCreate

        root = _make_category(db, test_user, "Padre")
        child = _make_category(db, test_user, "Hijo", parent_id=root.id)

        with pytest.raises(HTTPException) as exc:
            update_category(
                root.id,
                CategoryCreate(name="Padre", parent_id=child.id),
                db=db,
                current_user=test_user,
            )

        assert exc.value.status_code == 400

    def test_delete_ignores_foreign_children(self, db, test_user):
        """A foreign category pointing at mine must not block my deletion."""
        from app.models import Category
        from app.routers.categories import delete_category

        own = _make_category(db, test_user, "Mia")
        _make_category(db, _other_user(db), "Hijo ajeno", parent_id=own.id)

        delete_category(own.id, db=db, current_user=test_user)

        assert db.query(Category).filter(Category.id == own.id).first() is None


# ── Reads: a parent is only part of the tree when it shares its owner ─


class TestParentOwnershipOnRead:
    def test_bot_levels_hide_foreign_parent(self, db, test_user):
        from app.services.bot_reports import build_cat_levels

        foreign = _make_category(db, _other_user(db), "SECRETO AJENO")
        child = _make_category(db, test_user, "Hijo", parent_id=foreign.id)

        assert build_cat_levels(child.id, db) == ["Hijo"]

    def test_bot_levels_include_own_parent(self, db, test_user):
        from app.services.bot_reports import build_cat_levels

        parent = _make_category(db, test_user, "Padre")
        child = _make_category(db, test_user, "Hijo", parent_id=parent.id)

        assert build_cat_levels(child.id, db) == ["Padre", "Hijo"]

    def test_bot_levels_survive_a_cycle(self, db, test_user):
        from app.services.bot_reports import build_cat_levels

        a = _make_category(db, test_user, "A")
        b = _make_category(db, test_user, "B", parent_id=a.id)
        a.parent_id = b.id  # a <-> b, written behind the router's back
        db.flush()

        assert build_cat_levels(a.id, db) == ["B", "A"]

    def test_bot_category_name_hides_foreign_parent(self, db, test_user):
        from app.services.bot_reports import _get_category_name

        foreign = _make_category(db, _other_user(db), "SECRETO AJENO")
        child = _make_category(db, test_user, "Hijo", parent_id=foreign.id)

        assert _get_category_name(child.id, db) == "Hijo"

    def test_income_check_ignores_foreign_parent(self, db, test_user):
        from app.services.categorization import is_income_category

        foreign = _make_category(db, _other_user(db), "Ingresos")
        child = _make_category(db, test_user, "Sueldo", parent_id=foreign.id)

        assert is_income_category(child.id, db) is False

    def test_income_check_honors_own_parent(self, db, test_user):
        from app.services.categorization import is_income_category

        parent = _make_category(db, test_user, "Ingresos")
        child = _make_category(db, test_user, "Sueldo", parent_id=parent.id)

        assert is_income_category(child.id, db) is True

    def test_monthly_report_hides_foreign_parent(self, db, test_user):
        from app.models import Expense
        from app.tasks.monthly_report import _generate_report_data

        foreign = _make_category(db, _other_user(db), "SECRETO AJENO")
        child = _make_category(db, test_user, "Hijo", parent_id=foreign.id)
        db.add(
            Expense(
                amount=100.0,
                description="Compra",
                date="2026-10-01",
                user_id=test_user.id,
                category_id=child.id,
            )
        )
        db.flush()

        report = _generate_report_data(test_user.id, "2026-10", db)

        assert "SECRETO AJENO" not in json.dumps(report, default=str)

    def test_budget_rollup_excludes_foreign_children(self, db, test_user):
        from app.models import Expense
        from app.services.budget_helpers import get_spending_for_category

        own = _make_category(db, test_user, "Mia")
        own_child = _make_category(db, test_user, "Hijo mio", parent_id=own.id)
        foreign_child = _make_category(db, _other_user(db), "Hijo ajeno", parent_id=own.id)
        for cat in (own_child, foreign_child):
            db.add(
                Expense(
                    amount=100.0,
                    description="Compra",
                    date="2026-10-05",
                    user_id=test_user.id,
                    category_id=cat.id,
                )
            )
        db.flush()

        total = get_spending_for_category(own.id, 2026, 10, [test_user.id], db)

        assert total == 100.0  # only the expense under the owned child

    def test_cleanup_script_nulls_foreign_parents(self, db, test_user):
        from scripts.migrate_fix_foreign_category_parents import fix_foreign_parents

        foreign = _make_category(db, _other_user(db), "SECRETO AJENO")
        child = _make_category(db, test_user, "Hijo", parent_id=foreign.id)
        db.flush()

        broken = fix_foreign_parents(db, apply=True)

        assert (child.id, foreign.id) in broken
        db.refresh(child)
        assert child.parent_id is None
