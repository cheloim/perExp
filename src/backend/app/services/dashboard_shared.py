"""Shared lookups for the dashboard service modules (#566).

These helpers used to live in ``app/routers/dashboard.py``. They are pure
lookup/filter utilities: no HTTP concerns, no response shaping.
"""

from __future__ import annotations

from calendar import monthrange
from datetime import date

from sqlalchemy.orm import Session

from app.models import Account, Card, Category, Expense, ExpenseTag, Tag


def apply_filters(
    q,
    month_val,
    person_val,
    cat_id_val,
    bank_val=None,
    uid_list=None,
    db=None,
):
    """Apply the dashboard month/person/category/bank filters to a query."""
    if month_val:
        try:
            if "-" in month_val:
                parts = month_val.split("-")
                if len(parts[0]) == 4:
                    y, m = int(parts[0]), int(parts[1])
                else:
                    m, y = int(parts[0]), int(parts[1])
            else:
                y, m = int(month_val[:4]), int(month_val[5:7])
            q = q.filter(
                Expense.date >= date(y, m, 1), Expense.date <= date(y, m, monthrange(y, m)[1])
            )
        except (ValueError, IndexError):
            pass
    if (person_val or bank_val) and uid_list and db:
        all_cards = db.query(Card).filter(Card.user_id.in_(uid_list)).all()
        if person_val:
            matching_card_ids = [
                c.id for c in all_cards if person_val.lower() in (c.holder or "").lower()
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
        if bank_val:
            matching_ids = [c.id for c in all_cards if bank_val.lower() in (c.bank or "").lower()]
            q = q.filter(Expense.card_id.in_(matching_ids))
    if cat_id_val is not None:
        q = q.filter(Expense.category_id == cat_id_val)
    return q


def load_cards_and_accounts(uid_list: list[int], expenses: list[Expense], db: Session):
    """Load cards and accounts for group users only."""
    # Cards: only from group members
    cards_by_id = {c.id: c for c in db.query(Card).filter(Card.user_id.in_(uid_list)).all()}

    # Accounts: only from group members — return name + type for display
    accounts_by_id = {
        a.id: {"name": a.name, "type": a.type}
        for a in db.query(Account).filter(Account.user_id.in_(uid_list)).all()
    }

    return cards_by_id, accounts_by_id


def category_map(uid_list: list[int], db: Session) -> dict[int, Category]:
    """Categories visible to the group, including parents owned elsewhere."""
    categories = db.query(Category).filter(Category.user_id.in_(uid_list)).all()
    parent_ids = {c.parent_id for c in categories if c.parent_id}
    if parent_ids:
        categories += db.query(Category).filter(Category.id.in_(parent_ids)).all()
    return {c.id: c for c in categories}


def get_card_info(e: Expense, cards_by_id: dict) -> tuple[str, str, str]:
    """Return (card_name, bank, holder) for an expense, using card_id when available."""
    if e.card_id and e.card_id in cards_by_id:
        c = cards_by_id[e.card_id]
        return c.card_name, c.bank or "", c.holder or ""
    return "", "", ""


def card_network(card_str: str) -> str:
    s = (card_str or "").strip().lower()
    if "visa" in s:
        return "visa"
    if "mastercard" in s or "master card" in s:
        return "mastercard"
    if "amex" in s or "american express" in s:
        return "amex"
    return s or "unknown"
