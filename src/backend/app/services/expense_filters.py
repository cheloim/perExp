"""Shared filtering for expense queries (list, stats and breakdowns).

The same filter set has to apply to ``GET /expenses`` and to
``/expenses/stats``, ``/by-category`` and ``/by-person``, so the cards and
charts on the expenses page stay consistent with the table.

Everything applies at DB level except bank/person/card/account matching and
the free-text verification: those fields are EncryptedType columns. Search
uses the blind n-gram column ``Expense.search_grams`` to narrow candidates at
DB level and decrypts only those rows to verify the substring.
"""

from __future__ import annotations

from calendar import monthrange
from datetime import date

from sqlalchemy import and_, false, func, or_, text
from sqlalchemy.orm import Session

from app.models import Account, Card, Category, Expense, ExpenseTag, Tag
from app.services.encryption import tokenize_description
from app.services.expense_search import build_query_grams, expense_matches


def _search_matching_ids(
    db: Session, uid_list: list[int], search: str
) -> tuple[list[int] | None, list[int]]:
    """Return matching expense ids, or None when the filter is a no-op.

    Uses the blind n-gram index when every row is indexed. The full scan
    remains as a fallback for rows created before the index was backfilled
    and for one-character searches, which have no grams.
    """
    needle = tokenize_description(search or "")
    if not needle:
        return None, []

    category_names = {
        c.id: c.name for c in db.query(Category).filter(Category.user_id.in_(uid_list)).all()
    }
    search_columns = db.query(
        Expense.id, Expense.description, Expense.notes, Expense.category_id
    ).filter(Expense.user_id.in_(uid_list))

    unindexed = (
        db.query(Expense.id)
        .filter(Expense.user_id.in_(uid_list), Expense.search_grams.is_(None))
        .first()
    )
    query_grams = build_query_grams(search)
    category_ids = [
        category_id
        for category_id, name in category_names.items()
        if needle in tokenize_description(name or "")
    ]
    if unindexed is None and query_grams:
        matching_ids: set[int] = set()
        tsv = func.to_tsvector(text("'simple'"), Expense.search_grams)
        gram_filter = and_(
            *[tsv.op("@@")(func.plainto_tsquery(text("'simple'"), gram)) for gram in query_grams]
        )
        for expense_id, description, notes, category_id in search_columns.filter(gram_filter).all():
            if expense_matches(search, description, notes, category_names.get(category_id)):
                matching_ids.add(expense_id)
        # A category name match already proves the needle; do not decrypt those
        # rows. The caller applies the category condition separately.
        return list(matching_ids), category_ids

    # Unindexed rows or a one-character search: decrypt and verify the old way.
    candidates = search_columns.all()
    return (
        [
            expense_id
            for expense_id, description, notes, category_id in candidates
            if expense_matches(search, description, notes, category_names.get(category_id))
        ],
        [],
    )


def apply_expense_filters(
    q,
    *,
    uid_list: list[int],
    db: Session,
    month: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    category_id: int | None = None,
    category_ids: str | None = None,
    uncategorized: bool = False,
    bank: str | None = None,
    person: str | None = None,
    card: str | None = None,
    card_type: str | None = None,
    installment: bool | None = None,
    account: str | None = None,
    account_id: int | None = None,
    tag_id: int | None = None,
    untagged: bool = False,
    cuenta_id: int | None = None,
    sin_cuenta: bool = False,
    search: str | None = None,
):
    """Apply the user-facing expense filters to ``q`` and return it.

    The caller owns user scoping (``Expense.user_id.in_(uid_list)``).
    """
    if month:
        try:
            y, m = int(month[:4]), int(month[5:7])
            q = q.filter(
                Expense.date >= date(y, m, 1), Expense.date <= date(y, m, monthrange(y, m)[1])
            )
        except (ValueError, IndexError):
            pass
    if date_from:
        q = q.filter(Expense.date >= date_from)
    if date_to:
        q = q.filter(Expense.date <= date_to)
    if category_id is not None:
        q = q.filter(Expense.category_id == category_id)
    elif category_ids:
        id_list = [int(x) for x in category_ids.split(",") if x.strip().isdigit()]
        if id_list:
            q = q.filter(Expense.category_id.in_(id_list))
    elif uncategorized:
        q = q.filter(Expense.category_id.is_(None))
    # Application-level filtering for bank, person, card, account
    if bank or person or card or card_type:
        all_cards = db.query(Card).filter(Card.user_id.in_(uid_list)).all()
        if bank:
            matching_ids = [c.id for c in all_cards if bank.lower() in (c.bank or "").lower()]
            q = q.filter(Expense.card_id.in_(matching_ids))
        if person:
            matching_card_ids = [
                c.id for c in all_cards if person.lower() in (c.holder or "").lower()
            ]
            if matching_card_ids:
                tag_expense_ids = (
                    db.query(ExpenseTag.expense_id)
                    .join(Tag, Tag.id == ExpenseTag.tag_id)
                    .filter(Tag.card_id.in_(matching_card_ids))
                )
                q = q.filter(
                    (Expense.card_id.in_(matching_card_ids)) | (Expense.id.in_(tag_expense_ids))
                )
            else:
                q = q.filter(Expense.id == -1)
        if card:
            matching_ids = [c.id for c in all_cards if card.lower() in (c.card_name or "").lower()]
            q = q.filter(Expense.card_id.in_(matching_ids))
        if card_type:
            matching_ids = [c.id for c in all_cards if c.card_type == card_type]
            q = q.filter(Expense.card_id.in_(matching_ids))
    if installment is True:
        q = q.filter(Expense.installment_group_id.isnot(None))
    elif installment is False:
        q = q.filter(Expense.installment_group_id.is_(None))
    if account_id:
        q = q.filter(Expense.account_id == account_id)
    if account:
        all_accounts = db.query(Account).filter(Account.user_id.in_(uid_list)).all()
        matching_ids = [a.id for a in all_accounts if account.lower() in (a.name or "").lower()]
        q = q.filter(Expense.account_id.in_(matching_ids))
    # Tag filtering
    if tag_id:
        q = q.join(ExpenseTag, ExpenseTag.expense_id == Expense.id).filter(
            ExpenseTag.tag_id == tag_id
        )
    elif untagged:
        tagged_ids = (
            db.query(ExpenseTag.expense_id)
            .join(Tag, Tag.id == ExpenseTag.tag_id)
            .filter(Tag.group_name != "categoria")
            .subquery()
        )
        q = q.filter(~Expense.id.in_(db.query(tagged_ids.c.expense_id)))
    # Cuenta filtering
    if cuenta_id:
        cuenta_expense_ids = (
            db.query(ExpenseTag.expense_id)
            .join(Tag, Tag.id == ExpenseTag.tag_id)
            .filter(ExpenseTag.tag_id == cuenta_id, Tag.group_name == "cuenta")
        )
        q = q.filter(Expense.id.in_(cuenta_expense_ids))
    elif sin_cuenta:
        cuenta_tag_ids = db.query(Tag.id).filter(Tag.group_name == "cuenta")
        cuenta_expense_ids = db.query(ExpenseTag.expense_id).filter(
            ExpenseTag.tag_id.in_(cuenta_tag_ids)
        )
        q = q.filter(~Expense.id.in_(cuenta_expense_ids))
    # Text search — description, notes and category name are encrypted. The
    # GIN index on search_grams narrows candidates without decrypting the
    # table; only those candidates are decrypted and verified.
    if search:
        matching_ids, matching_category_ids = _search_matching_ids(db, uid_list, search)
        if matching_ids is not None:
            clauses = []
            if matching_ids:
                clauses.append(Expense.id.in_(matching_ids))
            if matching_category_ids:
                clauses.append(Expense.category_id.in_(matching_category_ids))
            q = q.filter(or_(*clauses) if clauses else false())
    # Only exclude future installments when NOT filtering by specific category
    # (category-specific views like side panel need to show all expenses)
    if not category_id and not category_ids:
        q = q.filter((Expense.installment_group_id.is_(None)) | (Expense.date <= date.today()))
    return q
