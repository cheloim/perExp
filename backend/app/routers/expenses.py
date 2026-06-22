import re
from calendar import monthrange
from datetime import date

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import desc, func
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.models import Card, Category, Expense, User
from app.routers.groups import get_group_user_ids
from app.schemas import ExpenseCreate, ExpenseResponse, ExpenseUpdate
from app.services.auth import get_current_user
from app.services.categorization import _resolve_category, auto_categorize
from app.services.date_utils import _normalize_date_str
from app.services.import_utils import _is_duplicate, _normalize_text
from app.services.normalizers import normalize_bank

router = APIRouter(prefix="/expenses", tags=["expenses"])


@router.get("", response_model=list[ExpenseResponse])
def get_expenses(
    date_from: date | None = None,
    date_to: date | None = None,
    month: str | None = None,
    category_id: int | None = None,
    uncategorized: bool = False,
    bank: str | None = None,
    person: str | None = None,
    card: str | None = None,
    search: str | None = None,
    skip: int = 0,
    limit: int = 200,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    uid_list = get_group_user_ids(current_user.id, db)
    q = (
        db.query(Expense)
        .options(joinedload(Expense.card_rel), joinedload(Expense.category), joinedload(Expense.account_rel))
        .filter(Expense.user_id.in_(uid_list))
    )
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
    elif uncategorized:
        q = q.filter(Expense.category_id.is_(None))
    if bank:
        q = q.join(Card, Expense.card_id == Card.id, isouter=True).filter(Card.bank.ilike(f"%{bank}%"))
    if person:
        q = q.join(Card, Expense.card_id == Card.id, isouter=True).filter(Card.holder.ilike(f"%{person}%"))
    if card:
        q = q.join(Card, Expense.card_id == Card.id, isouter=True).filter(Card.card_name.ilike(f"%{card}%"))
    if search:
        q = q.filter(Expense.description.ilike(f"%{search}%"))
    return q.order_by(desc(Expense.date)).offset(skip).limit(limit).all()


@router.get("/distinct-values")
def get_distinct_values(
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    uid_list = get_group_user_ids(current_user.id, db)

    cards = db.query(Card).filter(Card.user_id.in_(uid_list)).all()

    banks = sorted({c.bank for c in cards if c.bank})
    persons = sorted({c.holder for c in cards if c.holder})
    card_names = sorted({c.card_name for c in cards if c.card_name})

    return {
        "banks": banks,
        "persons": persons,
        "cards": card_names,
    }


@router.get("/card-options")
def get_card_options(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    uid_list = get_group_user_ids(current_user.id, db)
    cards = db.query(Card).filter(Card.user_id.in_(uid_list)).all()

    if not cards:
        return {"persons": [], "by_person": {}}

    def _sig_tokens(name: str) -> set:
        return {
            re.sub(r"[^A-Z]", "", t)
            for t in name.upper().split()
            if len(re.sub(r"[^A-Z]", "", t)) >= 5
        }

    unique_holders = list({c.holder for c in cards if c.holder})
    if not unique_holders:
        return {"persons": [], "by_person": {}}

    parent = {h: h for h in unique_holders}

    def find(k: str) -> str:
        while parent[k] != k:
            parent[k] = parent[parent[k]]
            k = parent[k]
        return k

    htok = {h: _sig_tokens(h) for h in unique_holders}
    for i, h1 in enumerate(unique_holders):
        for h2 in unique_holders[i + 1 :]:
            if htok[h1] & htok[h2]:
                r1, r2 = find(h1), find(h2)
                if r1 != r2:
                    parent[r2] = r1

    cluster_cnt: dict[str, dict[str, int]] = {}
    for c in cards:
        if not c.holder:
            continue
        root = find(c.holder)
        d = cluster_cnt.setdefault(root, {})
        d[c.holder] = d.get(c.holder, 0) + 1

    root_canonical: dict[str, str] = {
        root: max(cnts, key=cnts.get) for root, cnts in cluster_cnt.items()
    }

    structure: dict[str, dict[str, set]] = {}
    for c in cards:
        if not c.holder:
            continue
        canon = root_canonical[find(c.holder)]
        structure.setdefault(canon, {}).setdefault(c.bank or "", set()).add(c.card_name)

    by_person = {
        person: {bank: sorted(card_names) for bank, card_names in sorted(banks.items())}
        for person, banks in structure.items()
    }

    return {"persons": sorted(by_person), "by_person": by_person}


@router.get("/check-duplicate")
def check_duplicate(
    exp_date: date = Query(..., alias="date"),
    amount: float = Query(...),
    description: str = Query(...),
    transaction_id: str | None = Query(None),
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
        return {
            "duplicate": True,
            "existing_id": dupe.id,
            "existing_date": dupe.date.isoformat(),
            "existing_description": dupe.description,
            "existing_amount": dupe.amount,
        }
    return {"duplicate": False}


@router.post("", response_model=ExpenseResponse)
def create_expense(
    expense: ExpenseCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.services.categorization import is_income_category

    if _is_duplicate(db, expense.date, expense.amount, expense.description, expense.transaction_id):
        raise HTTPException(409, "Ya existe un gasto con la misma fecha, monto y descripción.")

    data = expense.model_dump()

    # Auto-categorize if needed
    if data.get("category_id") is None:
        cats = db.query(Category).all()
        data["category_id"] = auto_categorize(data["description"], cats)

    # Detect if this is income based on category parent
    data["is_income"] = is_income_category(data.get("category_id"), db)

    # Normalize description
    if data.get("description"):
        data["description"] = _normalize_text(data["description"])

    # Always store amount as positive (no sign convention)
    data["amount"] = abs(data["amount"])

    # Validate: income must have account_id
    if data["is_income"] and not data.get("account_id"):
        raise HTTPException(
            400,
            detail={
                "error": "account_required",
                "message": "Los ingresos requieren una cuenta destino.",
            },
        )

    # Validate: non-income cash/transfer payments also need account
    if not data["is_income"] and not data.get("account_id") and not data.get("card_id"):
        raise HTTPException(
            400,
            detail={
                "error": "account_required",
                "message": "Para gastos en efectivo o transferencia, debes seleccionar o crear una cuenta.",
            },
        )

    db_exp = Expense(**data, user_id=current_user.id)
    db.add(db_exp)
    db.commit()
    db.refresh(db_exp)
    return db_exp


@router.put("/{exp_id}", response_model=ExpenseResponse)
def update_expense(
    exp_id: int,
    expense: ExpenseUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    db_exp = (
        db.query(Expense)
        .options(joinedload(Expense.card_rel), joinedload(Expense.category), joinedload(Expense.account_rel))
        .filter(Expense.id == exp_id, Expense.user_id == current_user.id)
        .first()
    )
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
def delete_all_expenses(
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    count = db.query(Expense).filter(Expense.user_id == current_user.id).count()
    db.query(Expense).filter(Expense.user_id == current_user.id).delete()
    db.commit()
    return {"deleted": count}


@router.delete("/{exp_id}")
def delete_expense(
    exp_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    db_exp = (
        db.query(Expense).filter(Expense.id == exp_id, Expense.user_id == current_user.id).first()
    )
    if not db_exp:
        raise HTTPException(404, "Gasto no encontrado")
    db.delete(db_exp)
    db.commit()
    return {"ok": True}


@router.post("/recategorize")
def recategorize_expenses(
    payload: dict = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if payload is None:
        payload = {}
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


@router.patch("/bulk-update")
def bulk_update_expenses(
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ids: list = payload.get("ids", [])
    if not ids:
        return {"updated": 0}

    update_data = {}
    for field in ["category_id", "card_id", "account_id"]:
        if field in payload and payload[field] is not None:
            update_data[field] = payload[field]

    if not update_data:
        return {"updated": 0}

    updated = db.query(Expense).filter(Expense.id.in_(ids), Expense.user_id == current_user.id).update(
        update_data, synchronize_session=False
    )
    db.commit()
    return {"updated": updated}


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


@router.post("/detect-installments")
def detect_installments(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.services.import_utils import fix_missing_installments

    result = fix_missing_installments(db, current_user.id)
    return result
