"""Tests for POST /expenses/bulk-tags.

The endpoint shipped without coverage. The `remove` branch used to be a nested
`if` and is now a compound condition (`mode == "remove" and tag_ids`), so both
sides of that guard are pinned here: an empty `tag_ids` must leave the links
alone, and a real one must delete exactly them.
"""

from datetime import date

import pytest

from app.routers.expenses import bulk_update_tags
from app.services.encryption import compute_hmac


@pytest.fixture
def expense(db, test_user):
    from app.models import Expense

    row = Expense(
        amount=1500,
        description="Taxi al aeropuerto",
        date=date(2026, 10, 1),
        user_id=test_user.id,
    )
    db.add(row)
    db.flush()
    return row


@pytest.fixture
def tag(db, test_user):
    from app.models import Tag

    row = Tag(
        name="viaje",
        name_hmac=compute_hmac("viaje"),
        group_name="otros",
        user_id=test_user.id,
    )
    db.add(row)
    db.flush()
    return row


def _link(db, expense, tag):
    from app.models import ExpenseTag

    db.add(ExpenseTag(expense_id=expense.id, tag_id=tag.id))
    db.flush()


def _is_linked(db, expense, tag) -> bool:
    from app.models import ExpenseTag

    return (
        db.query(ExpenseTag)
        .filter(ExpenseTag.expense_id == expense.id, ExpenseTag.tag_id == tag.id)
        .first()
        is not None
    )


def test_remove_without_tag_ids_keeps_the_existing_links(db, test_user, expense, tag):
    _link(db, expense, tag)

    result = bulk_update_tags(
        {"ids": [expense.id], "tag_ids": [], "mode": "remove"},
        db=db,
        current_user=test_user,
    )

    assert result == {"updated": 1}
    assert _is_linked(db, expense, tag)


def test_remove_deletes_only_the_requested_tag(db, test_user, expense, tag):
    from app.models import Tag
    from app.services.encryption import compute_hmac as hmac_fn

    other = Tag(name="trabajo", name_hmac=hmac_fn("trabajo"), user_id=test_user.id)
    db.add(other)
    db.flush()
    _link(db, expense, tag)
    _link(db, expense, other)

    result = bulk_update_tags(
        {"ids": [expense.id], "tag_ids": [tag.id], "mode": "remove"},
        db=db,
        current_user=test_user,
    )

    assert result == {"updated": 1}
    assert not _is_linked(db, expense, tag)
    assert _is_linked(db, expense, other)


def test_remove_with_no_matching_expense_updates_nothing(db, test_user, tag):
    result = bulk_update_tags(
        {"ids": [999999], "tag_ids": [tag.id], "mode": "remove"},
        db=db,
        current_user=test_user,
    )

    assert result == {"updated": 0}
