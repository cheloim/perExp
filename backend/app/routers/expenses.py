import re
from calendar import monthrange
from datetime import date
from typing import Optional, List

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import desc, func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Category, Expense, User
from app.schemas import ExpenseCreate, ExpenseUpdate, ExpenseResponse
from app.services.auth import get_current_user
from app.services.categorization import auto_categorize, _resolve_category
from app.services.date_utils import _normalize_date_str
from app.services.import_utils import _is_duplicate
from app.services.normalizers import _norm_bank, _norm_holder

router = APIRouter(prefix="/expenses", tags=["expenses"])


@router.get("", response_model=List[ExpenseResponse])
def get_expenses(
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    month: Optional[str] = None,
    category_id: Optional[int] = None,
    uncategorized: bool = False,
    bank: Optional[str] = None,
    person: Optional[str] = None,
    search: Optional[str] = None,
    skip: int = 0,
    limit: int = 200,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(Expense).filter(Expense.user_id == current_user.id)
    if month:
        try:
            y, m = int(month[:4]), int(month[5:7])
            q = q.filter(Expense.date >= date(y, m, 1), Expense.date <= date(y, m, monthrange(y, m)[1]))
        except (ValueError, IndexError):
            pass
    if date_from:
        q = q.filter(Expense.date >= date_from)
    if date_to:
        q = q.filter(Expense.date <= date_to)
    if category_id is not None:
        q = q.filter(Expense.category_id == category_id)
    elif uncategorized:
        q = q.filter(Expense.category_id.is_(None))
    if bank:
        q = q.filter(Expense.bank.ilike(f"%{bank}%"))
    if person:
        q = q.filter(Expense.person.ilike(f"%{person}%"))
    if search:
        q = q.filter(Expense.description.ilike(f"%{search}%"))
    return q.order_by(desc(Expense.date)).offset(skip).limit(limit).all()


@router.get("/distinct-values")
def get_distinct_values(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    def distinct(col):
        return sorted({r[0] for r in db.query(col).filter(Expense.user_id == current_user.id).distinct().all() if r[0]})
    return {
        "banks":   distinct(Expense.bank),
        "persons": distinct(Expense.person),
        "cards":   distinct(Expense.card),
    }


@router.get("/card-options")
def get_card_options(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    def _sig_tokens(name: str) -> set:
        return {re.sub(r'[^A-Z]', '', t) for t in name.upper().split()
                if len(re.sub(r'[^A-Z]', '', t)) >= 5}

    rows = (
        db.query(Expense.person, Expense.bank, Expense.card)
        .filter(Expense.user_id == current_user.id,
                Expense.person != "", Expense.bank != "", Expense.card != "",
                Expense.card != "Efectivo")
        .distinct()
        .all()
    )

    data: list[tuple[str, str, str]] = []
    for person, bank, card in rows:
        nh = _norm_holder(person)
        nb = _norm_bank(bank)
        if nh and nb and card:
            data.append((nh, nb, card.strip()))

    if not data:
        return {"persons": [], "by_person": {}}

    unique_holders = list({d[0] for d in data})
    parent = {h: h for h in unique_holders}

    def find(k: str) -> str:
        while parent[k] != k:
            parent[k] = parent[parent[k]]; k = parent[k]
        return k

    htok = {h: _sig_tokens(h) for h in unique_holders}
    for i, h1 in enumerate(unique_holders):
        for h2 in unique_holders[i + 1:]:
            if htok[h1] & htok[h2]:
                r1, r2 = find(h1), find(h2)
                if r1 != r2:
                    parent[r2] = r1

    cluster_cnt: dict[str, dict[str, int]] = {}
    for nh, _, _ in data:
        root = find(nh)
        d = cluster_cnt.setdefault(root, {})
        d[nh] = d.get(nh, 0) + 1

    root_canonical: dict[str, str] = {
        root: max(cnts, key=cnts.get)
        for root, cnts in cluster_cnt.items()
    }

    structure: dict[str, dict[str, set]] = {}
    for nh, nb, card in data:
        canon = root_canonical[find(nh)]
        structure.setdefault(canon, {}).setdefault(nb, set()).add(card)

    by_person = {
        person: {bank: sorted(cards) for bank, cards in sorted(banks.items())}
        for person, banks in structure.items()
    }

    return {"persons": sorted(by_person), "by_person": by_person}


@router.get("/check-duplicate")
def check_duplicate(
    exp_date: date = Query(..., alias="date"),
    amount: float = Query(...),
    description: str = Query(...),
    transaction_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    base = db.query(Expense).filter(Expense.user_id == current_user.id)
    dupe = None
    if transaction_id:
        dupe = base.filter(Expense.transaction_id == transaction_id).first()
    else:
        dupe = base.filter(
            Expense.date == exp_date,
            Expense.amount == amount,
            func.lower(Expense.description) == description.lower(),
        ).first()
    if dupe:
        return {"duplicate": True, "existing_id": dupe.id, "existing_date": dupe.date.isoformat(),
                "existing_description": dupe.description, "existing_amount": dupe.amount}
    return {"duplicate": False}


@router.post("", response_model=ExpenseResponse)
def create_expense(expense: ExpenseCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if _is_duplicate(db, expense.date, expense.amount, expense.description, expense.transaction_id):
        raise HTTPException(409, "Ya existe un gasto con la misma fecha, monto y descripción.")
    data = expense.model_dump()
    if data.get("category_id") is None:
        cats = db.query(Category).all()
        data["category_id"] = auto_categorize(data["description"], cats)
    db_exp = Expense(**data, user_id=current_user.id)
    db.add(db_exp)
    db.commit()
    db.refresh(db_exp)
    return db_exp


@router.put("/{exp_id}", response_model=ExpenseResponse)
def update_expense(exp_id: int, expense: ExpenseUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db_exp = db.query(Expense).filter(Expense.id == exp_id, Expense.user_id == current_user.id).first()
    if not db_exp:
        raise HTTPException(404, "Gasto no encontrado")
    data = expense.model_dump(exclude_none=True)
    if "date" in data:
        raw = str(data["date"]).strip()
        normalized = _normalize_date_str(raw)
        if re.match(r"^\d{4}-\d{2}-\d{2}$", normalized):
            data["date"] = date.fromisoformat(normalized)
        else:
            data["date"] = pd.to_datetime(normalized, dayfirst=True).date()
    for k, v in data.items():
        setattr(db_exp, k, v)
    db.commit()
    db.refresh(db_exp)
    return db_exp


@router.delete("/all")
def delete_all_expenses(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    count = db.query(Expense).filter(Expense.user_id == current_user.id).count()
    db.query(Expense).filter(Expense.user_id == current_user.id).delete()
    db.commit()
    return {"deleted": count}


@router.delete("/{exp_id}")
def delete_expense(exp_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db_exp = db.query(Expense).filter(Expense.id == exp_id, Expense.user_id == current_user.id).first()
    if not db_exp:
        raise HTTPException(404, "Gasto no encontrado")
    db.delete(db_exp)
    db.commit()
    return {"ok": True}


@router.post("/recategorize")
def recategorize_expenses(
    payload: dict = {},
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    only_uncategorized = (payload or {}).get("only_uncategorized", False)
    cats = db.query(Category).all()
    q = db.query(Expense).filter(Expense.user_id == current_user.id)
    if only_uncategorized:
        q = q.filter(Expense.category_id.is_(None))
    expenses = q.all()
    updated = 0
    for exp in expenses:
        new_cat = _resolve_category(db, exp.amount, exp.description, cats)
        if new_cat != exp.category_id:
            exp.category_id = new_cat
            updated += 1
    db.commit()
    return {"updated": updated, "total": len(expenses)}


@router.post("/bulk-category")
def bulk_update_category(
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ids: list = payload.get("ids", [])
    category_id = payload.get("category_id")
    if not ids:
        return {"updated": 0}
    db.query(Expense).filter(Expense.id.in_(ids), Expense.user_id == current_user.id).update(
        {"category_id": category_id}, synchronize_session=False
    )
    db.commit()
    return {"updated": len(ids)}
