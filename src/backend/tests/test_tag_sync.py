"""Tests for the tag sync service and expense update with tags.

Covers Issue 199 bug fixes:
- Bug A: PUT /expenses with categoria mirror tag_ids no longer fails
- Bug B: Mirror tags preserved after tag-only edits
- Single-select enforcement for cuenta group
- get_or_create_payment_tag canonical naming and dedup
"""

from datetime import date

import pytest
from fastapi import HTTPException

from app.models import Account, Card, Category, Expense, ExpenseTag, Tag, User
from app.services.encryption import compute_hmac
from app.services.tag_sync import (
    assign_tags_validated,
    get_or_create_mirror_tag,
    get_or_create_payment_tag,
    sync_category_tag,
)


@pytest.fixture
def category(db, test_user):
    cat = Category(name="Supermercado", color="#ff0000", user_id=test_user.id)
    db.add(cat)
    db.flush()
    return cat


@pytest.fixture
def mirror_tag(db, category):
    tag = get_or_create_mirror_tag(db, category)
    return tag


@pytest.fixture
def cuenta_tag(db, test_user):
    tag = Tag(
        name="Galicia Visa",
        name_hmac=compute_hmac("galicia visa"),
        color="#3584e4",
        group_name="cuenta",
        user_id=test_user.id,
    )
    db.add(tag)
    db.flush()
    return tag


@pytest.fixture
def otros_tag(db, test_user):
    tag = Tag(
        name="vacaciones",
        name_hmac=compute_hmac("vacaciones"),
        color="#33d17a",
        group_name="otros",
        user_id=test_user.id,
    )
    db.add(tag)
    db.flush()
    return tag


@pytest.fixture
def expense(db, test_user, category, mirror_tag, cuenta_tag):
    exp = Expense(
        date=date.today(),
        description="Compra test",
        description_hmac=compute_hmac("compra test"),
        amount=-100.0,
        user_id=test_user.id,
        category_id=category.id,
    )
    db.add(exp)
    db.flush()
    db.add_all(
        [
            ExpenseTag(expense_id=exp.id, tag_id=mirror_tag.id),
            ExpenseTag(expense_id=exp.id, tag_id=cuenta_tag.id),
        ]
    )
    db.flush()
    return exp


def _tag_ids(db, expense_id):
    return sorted(r.tag_id for r in db.query(ExpenseTag).filter(ExpenseTag.expense_id == expense_id).all())


class TestAssignTagsValidated:
    def test_skips_categoria_tags_silently(self, db, expense, mirror_tag, cuenta_tag, otros_tag):
        """assign_tags_validated should silently skip categoria tags, not raise400."""
        result = assign_tags_validated(
            db, expense.id, [mirror_tag.id, cuenta_tag.id, otros_tag.id], expense.user_id
        )
        result_ids = {t.id for t in result}
        assert mirror_tag.id not in result_ids
        assert cuenta_tag.id in result_ids
        assert otros_tag.id in result_ids

    def test_single_select_cuenta_replaces_existing(self, db, expense, cuenta_tag, test_user):
        new_cuenta = Tag(
            name="Nueva Cuenta",
            name_hmac=compute_hmac("nueva cuenta"),
            color="#ff7800",
            group_name="cuenta",
            user_id=test_user.id,
        )
        db.add(new_cuenta)
        db.flush()

        assign_tags_validated(db, expense.id, [new_cuenta.id], expense.user_id)
        tags = _tag_ids(db, expense.id)
        assert cuenta_tag.id not in tags
        assert new_cuenta.id in tags

    def test_multi_select_otros(self, db, expense, otros_tag, test_user):
        otro2 = Tag(
            name="otro2",
            name_hmac=compute_hmac("otro2"),
            color="#e01b24",
            group_name="otros",
            user_id=test_user.id,
        )
        db.add(otro2)
        db.flush()

        assign_tags_validated(db, expense.id, [otros_tag.id, otro2.id], expense.user_id)
        tags = _tag_ids(db, expense.id)
        assert otros_tag.id in tags
        assert otro2.id in tags


class TestUpdateExpenseTags:
    def test_mirror_preserved_with_categoria_in_tag_ids(self, db, expense, mirror_tag, cuenta_tag, otros_tag, test_user):
        """Bug A: update_expense with categoria mirror in tag_ids should NOT fail."""
        from app.schemas.expenses import ExpenseUpdate
        from app.routers.expenses import update_expense

        payload = ExpenseUpdate(tag_ids=[mirror_tag.id, cuenta_tag.id, otros_tag.id])
        result = update_expense(exp_id=expense.id, expense=payload, db=db, current_user=test_user)
        tags = _tag_ids(db, expense.id)
        assert mirror_tag.id in tags, "Mirror tag should be preserved"
        assert cuenta_tag.id in tags
        assert otros_tag.id in tags

    def test_mirror_preserved_with_filtered_tag_ids(self, db, expense, mirror_tag, cuenta_tag, otros_tag, test_user):
        """Bug B: update_expense should preserve mirror even when tag_ids excludes it."""
        from app.schemas.expenses import ExpenseUpdate
        from app.routers.expenses import update_expense

        payload = ExpenseUpdate(tag_ids=[cuenta_tag.id, otros_tag.id])
        update_expense(exp_id=expense.id, expense=payload, db=db, current_user=test_user)
        tags = _tag_ids(db, expense.id)
        assert mirror_tag.id in tags, "Mirror tag was wiped (Bug B regression)"
        assert cuenta_tag.id in tags
        assert otros_tag.id in tags

    def test_tag_only_update_skips_48h_check(self, db, test_user, mirror_tag, cuenta_tag, category):
        """Tag-only edits should bypass the48-hour window."""
        from datetime import datetime, timedelta
        from app.schemas.expenses import ExpenseUpdate
        from app.routers.expenses import update_expense

        exp = Expense(
            date=date.today(),
            description="Old expense",
            description_hmac=compute_hmac("old expense"),
            amount=-50.0,
            user_id=test_user.id,
            category_id=category.id,
            created_at=datetime.utcnow() - timedelta(days=7),
        )
        db.add(exp)
        db.flush()

        payload = ExpenseUpdate(tag_ids=[cuenta_tag.id])
        update_expense(exp_id=exp.id, expense=payload, db=db, current_user=test_user)
        tags = _tag_ids(db, exp.id)
        assert mirror_tag.id in tags
        assert cuenta_tag.id in tags


class TestGetOrCreatePaymentTag:
    def test_creates_tag_for_card(self, db, test_user):
        card = Card(
            card_name="Visa",
            bank="Galicia",
            card_type="credito",
            user_id=test_user.id,
        )
        db.add(card)
        db.flush()

        tag = get_or_create_payment_tag(db, test_user.id, card=card)
        assert tag.group_name == "cuenta"
        assert tag.card_id == card.id
        assert "Galicia" in str(tag.name)

    def test_dedup_by_card_id(self, db, test_user):
        card = Card(
            card_name="Visa",
            bank="Galicia",
            card_type="credito",
            user_id=test_user.id,
        )
        db.add(card)
        db.flush()

        tag1 = get_or_create_payment_tag(db, test_user.id, card=card)
        tag2 = get_or_create_payment_tag(db, test_user.id, card=card)
        assert tag1.id == tag2.id

    def test_does_not_hijack_mirror_tag(self, db, test_user, category, mirror_tag):
        """Payment tag creation should not return a categoria mirror even if names collide."""
        card = Card(
            card_name="Supermercado",
            bank="",
            card_type="credito",
            user_id=test_user.id,
        )
        db.add(card)
        db.flush()

        tag = get_or_create_payment_tag(db, test_user.id, card=card)
        assert tag.id != mirror_tag.id
        assert tag.group_name == "cuenta"

    def test_creates_tag_for_account(self, db, test_user):
        account = Account(name="Caja Ahorro", user_id=test_user.id)
        db.add(account)
        db.flush()

        tag = get_or_create_payment_tag(db, test_user.id, account=account)
        assert tag.group_name == "cuenta"
        assert tag.account_id == account.id
        assert "Caja Ahorro" in str(tag.name)

    def test_dedup_by_account_id(self, db, test_user):
        account = Account(name="Caja Ahorro", user_id=test_user.id)
        db.add(account)
        db.flush()

        tag1 = get_or_create_payment_tag(db, test_user.id, account=account)
        tag2 = get_or_create_payment_tag(db, test_user.id, account=account)
        assert tag1.id == tag2.id


class TestSyncCategoryTag:
    def test_sync_creates_mirror(self, db, test_user, category):
        exp = Expense(
            date=date.today(),
            description="Test",
            description_hmac=compute_hmac("test"),
            amount=-10.0,
            user_id=test_user.id,
        )
        db.add(exp)
        db.flush()

        sync_category_tag(db, exp, category.id)
        tags = _tag_ids(db, exp.id)
        mirror = (
            db.query(Tag)
            .filter(Tag.category_id == category.id, Tag.group_name == "categoria")
            .first()
        )
        assert mirror is not None
        assert mirror.id in tags

    def test_sync_removes_old_mirror_on_category_change(self, db, test_user, category, mirror_tag):
        exp = Expense(
            date=date.today(),
            description="Test",
            description_hmac=compute_hmac("test"),
            amount=-10.0,
            user_id=test_user.id,
            category_id=category.id,
        )
        db.add(exp)
        db.flush()
        db.add(ExpenseTag(expense_id=exp.id, tag_id=mirror_tag.id))
        db.flush()

        new_cat = Category(name="Transporte", color="#00ff00", user_id=test_user.id)
        db.add(new_cat)
        db.flush()

        sync_category_tag(db, exp, new_cat.id)
        tags = _tag_ids(db, exp.id)
        assert mirror_tag.id not in tags
        new_mirror = (
            db.query(Tag)
            .filter(Tag.category_id == new_cat.id, Tag.group_name == "categoria")
            .first()
        )
        assert new_mirror is not None
        assert new_mirror.id in tags
