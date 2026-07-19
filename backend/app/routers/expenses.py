import re
from calendar import monthrange
from datetime import date

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import desc, func
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.models import Card, Category, Expense, Notification, User
from app.routers.groups import get_group_user_ids
from app.schemas import ExpenseCreate, ExpenseResponse, ExpenseUpdate
from app.services.auth import get_current_user
from app.services.categorization import _resolve_category, auto_categorize
from app.services.date_utils import _normalize_date_str, add_months
from app.services.import_utils import _is_duplicate, _normalize_text

router = APIRouter(prefix="/expenses", tags=["expenses"])


@router.get("", response_model=list[ExpenseResponse])
def get_expenses(
    date_from: date | None = None,
    date_to: date | None = None,
    month: str | None = None,
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
    search: str | None = None,
    skip: int = 0,
    limit: int = 200,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    uid_list = get_group_user_ids(current_user.id, db)
    q = (
        db.query(Expense)
        .options(
            joinedload(Expense.card_rel),
            joinedload(Expense.category),
            joinedload(Expense.account_rel),
        )
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
    elif category_ids:
        id_list = [int(x) for x in category_ids.split(",") if x.strip().isdigit()]
        if id_list:
            q = q.filter(Expense.category_id.in_(id_list))
    elif uncategorized:
        q = q.filter(Expense.category_id.is_(None))
    if bank:
        q = q.join(Card, Expense.card_id == Card.id, isouter=True).filter(
            Card.bank.ilike(f"%{bank}%")
        )
    if person:
        q = q.join(Card, Expense.card_id == Card.id, isouter=True).filter(
            Card.holder.ilike(f"%{person}%")
        )
    if card:
        q = q.join(Card, Expense.card_id == Card.id, isouter=True).filter(
            Card.card_name.ilike(f"%{card}%")
        )
    if card_type:
        q = q.join(Card, Expense.card_id == Card.id, isouter=True).filter(
            Card.card_type == card_type
        )
    if installment is True:
        q = q.filter(Expense.installment_group_id.isnot(None))
    elif installment is False:
        q = q.filter(Expense.installment_group_id.is_(None))
    if account_id:
        q = q.filter(Expense.account_id == account_id)
    if account:
        from app.models import Account

        q = q.join(Account, Expense.account_id == Account.id, isouter=True).filter(
            Account.name.ilike(f"%{account}%")
        )
    if search:
        q = q.filter(Expense.description.ilike(f"%{search}%"))
    # Only exclude future installments when NOT filtering by specific category
    # (category-specific views like side panel need to show all expenses)
    if not category_id and not category_ids:
        q = q.filter((Expense.installment_group_id.is_(None)) | (Expense.date <= date.today()))
    return q.order_by(desc(Expense.date)).offset(skip).limit(limit).all()


@router.get("/uncategorized-count")
def get_uncategorized_count(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Check for uncategorized expenses and create notification if any exist."""
    import json

    uid_list = get_group_user_ids(current_user.id, db)

    count = (
        db.query(func.count(Expense.id))
        .filter(
            Expense.user_id.in_(uid_list),
            Expense.category_id.is_(None),
        )
        .scalar()
    )

    # Create notification if there are uncategorized expenses and no existing unread one
    if count > 0:
        existing = (
            db.query(Notification)
            .filter(
                Notification.user_id == current_user.id,
                Notification.type == "uncategorized_expenses",
                Notification.read == False,
            )
            .first()
        )

        if not existing:
            notification = Notification(
                user_id=current_user.id,
                type="uncategorized_expenses",
                title=f"⚠ {count} gasto{'s' if count != 1 else ''} sin categorí{'as' if count != 1 else 'a'}",
                body="Asigná categorías para un mejor análisis de tus gastos.",
                data=json.dumps({"count": count}),
                read=False,
            )
            db.add(notification)
            db.commit()

    return {"count": count}


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
        cats = db.query(Category).filter(Category.user_id == current_user.id).all()
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

    # Validate card belongs to user
    if data.get("card_id"):
        card = (
            db.query(Card)
            .filter(
                Card.id == data["card_id"],
                Card.user_id == current_user.id,
            )
            .first()
        )
        if not card:
            raise HTTPException(404, "Tarjeta no encontrada")

        # Auto-asign account_id if card has linked account
        if card.linked_account_id and not data.get("account_id"):
            data["account_id"] = card.linked_account_id

    # Validate account belongs to user
    if data.get("account_id"):
        from app.models import Account

        account = (
            db.query(Account)
            .filter(
                Account.id == data["account_id"],
                Account.user_id == current_user.id,
            )
            .first()
        )
        if not account:
            raise HTTPException(404, "Cuenta no encontrada")

    db_exp = Expense(**data, user_id=current_user.id)
    db.add(db_exp)
    db.commit()
    db.refresh(db_exp)

    # Notify if expense has no category
    if db_exp.category_id is None:
        import json

        notification = Notification(
            user_id=current_user.id,
            type="uncategorized_expense",
            title=f"⚠ Gasto sin categoría: {db_exp.description[:50]}",
            body=f"Monto: ${db_exp.amount:,.2f} — Asigná una categoría para un mejor análisis.",
            data=json.dumps({"expense_id": db_exp.id, "description": db_exp.description}),
            read=False,
        )
        db.add(notification)
        db.commit()

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
        .options(
            joinedload(Expense.card_rel),
            joinedload(Expense.category),
            joinedload(Expense.account_rel),
        )
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


@router.post("/bulk-delete")
def bulk_delete_expenses(
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ids: list = payload.get("ids", [])
    if not ids:
        return {"deleted": 0}
    deleted = (
        db.query(Expense)
        .filter(Expense.id.in_(ids), Expense.user_id == current_user.id)
        .delete(synchronize_session=False)
    )
    db.commit()
    return {"deleted": deleted}


@router.delete("/all")
def delete_all_expenses(
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if payload.get("confirm") != "DELETE_ALL":
        raise HTTPException(400, detail='Send {"confirm": "DELETE_ALL"} to proceed')
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
    cats = db.query(Category).filter(Category.user_id == current_user.id).all()
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

    updated = (
        db.query(Expense)
        .filter(Expense.id.in_(ids), Expense.user_id == current_user.id)
        .update(update_data, synchronize_session=False)
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

    # Validate category belongs to this user (or is null)
    if category_id is not None:
        cat = (
            db.query(Category)
            .filter(
                Category.id == category_id,
                Category.user_id == current_user.id,
            )
            .first()
        )
        if not cat:
            raise HTTPException(404, "Categoría no encontrada")

    updated = (
        db.query(Expense)
        .filter(Expense.id.in_(ids), Expense.user_id == current_user.id)
        .update({"category_id": category_id}, synchronize_session=False)
    )
    db.commit()
    return {"updated": updated}


@router.post("/detect-installments")
def detect_installments(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.services.import_utils import fix_missing_installments

    result = fix_missing_installments(db, current_user.id)
    return result


class ExpenseStatsResponse(BaseModel):
    total: float
    count: int
    avg: float
    last_used: str | None


@router.get("/stats", response_model=ExpenseStatsResponse)
def get_expense_stats(
    month: str | None = None,
    card: str | None = None,
    bank: str | None = None,
    account: str | None = None,
    account_id: int | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    uid_list = get_group_user_ids(current_user.id, db)
    q = db.query(
        func.coalesce(func.sum(Expense.amount), 0.0),
        func.count(Expense.id),
    ).filter(Expense.user_id.in_(uid_list), Expense.amount > 0)

    if month:
        try:
            y, m = int(month[:4]), int(month[5:7])
            q = q.filter(
                Expense.date >= date(y, m, 1),
                Expense.date <= date(y, m, monthrange(y, m)[1]),
            )
        except (ValueError, IndexError):
            pass
    if account_id:
        q = q.filter(Expense.account_id == account_id)
    elif account:
        from app.models import Account

        q = q.join(Account, Expense.account_id == Account.id, isouter=True).filter(
            Account.name.ilike(f"%{account}%")
        )
    elif card:
        q = q.join(Card, Expense.card_id == Card.id, isouter=True).filter(
            Card.card_name.ilike(f"%{card}%")
        )
    elif bank:
        q = q.join(Card, Expense.card_id == Card.id, isouter=True).filter(
            Card.bank.ilike(f"%{bank}%")
        )

    total, count = q.one()

    # Separate query for last_used (only from card-based expenses)
    last_used_q = db.query(func.max(Expense.date)).filter(
        Expense.user_id.in_(uid_list),
        Expense.amount > 0,
        Expense.card_id.isnot(None),
    )
    if month:
        try:
            y, m = int(month[:4]), int(month[5:7])
            last_used_q = last_used_q.filter(
                Expense.date >= date(y, m, 1),
                Expense.date <= date(y, m, monthrange(y, m)[1]),
            )
        except (ValueError, IndexError):
            pass
    if card:
        last_used_q = last_used_q.join(Card, Expense.card_id == Card.id).filter(
            Card.card_name.ilike(f"%{card}%")
        )
    elif bank:
        last_used_q = last_used_q.join(Card, Expense.card_id == Card.id).filter(
            Card.bank.ilike(f"%{bank}%")
        )
    last_used = last_used_q.scalar()

    total, count = q.one()
    return ExpenseStatsResponse(
        total=float(total),
        count=count,
        avg=float(total) / count if count > 0 else 0.0,
        last_used=last_used.isoformat() if last_used else None,
    )


class CategoryBreakdownItem(BaseModel):
    category_id: int | None
    category_name: str
    category_color: str | None
    total: float
    count: int


@router.get("/by-category", response_model=list[CategoryBreakdownItem])
def get_expenses_by_category(
    month: str | None = None,
    card: str | None = None,
    account_id: int | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    uid_list = get_group_user_ids(current_user.id, db)
    cat_map = {c.id: c for c in db.query(Category).all()}

    q = (
        db.query(
            Expense.category_id,
            func.coalesce(func.sum(Expense.amount), 0.0),
            func.count(Expense.id),
        )
        .filter(Expense.user_id.in_(uid_list), Expense.amount > 0)
        .group_by(Expense.category_id)
    )

    if month:
        try:
            y, m = int(month[:4]), int(month[5:7])
            q = q.filter(
                Expense.date >= date(y, m, 1),
                Expense.date <= date(y, m, monthrange(y, m)[1]),
            )
        except (ValueError, IndexError):
            pass
    if account_id:
        q = q.filter(Expense.account_id == account_id)
    if card:
        q = q.join(Card, Expense.card_id == Card.id, isouter=True).filter(
            Card.card_name.ilike(f"%{card}%")
        )

    rows = q.all()
    result = []
    for cat_id, total, count in rows:
        cat = cat_map.get(cat_id) if cat_id else None
        result.append(
            CategoryBreakdownItem(
                category_id=cat_id,
                category_name=cat.name if cat else "Sin categoría",
                category_color=cat.color if cat else "#94a3b8",
                total=float(total),
                count=count,
            )
        )
    return sorted(result, key=lambda x: x.total, reverse=True)


class PersonBreakdownItem(BaseModel):
    person: str
    total: float
    count: int


def _first_name(full_name: str) -> str:
    """Extract first name from full_name. 'Perez, Juan' -> 'Juan', 'Juan Perez' -> 'Juan'"""
    if not full_name:
        return ""
    if "," in full_name:
        parts = full_name.split(",")
        return parts[1].strip().split()[0] if len(parts) > 1 and parts[1].strip() else ""
    return full_name.strip().split()[0] if full_name.strip() else ""


@router.get("/by-person", response_model=list[PersonBreakdownItem])
def get_expenses_by_person(
    month: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    uid_list = get_group_user_ids(current_user.id, db)

    q = (
        db.query(
            User.id,
            User.full_name,
            func.coalesce(func.sum(Expense.amount), 0.0),
            func.count(Expense.id),
        )
        .join(User, Expense.user_id == User.id)
        .filter(Expense.user_id.in_(uid_list), Expense.amount > 0)
        .group_by(User.id, User.full_name)
    )

    if month:
        try:
            y, m = int(month[:4]), int(month[5:7])
            q = q.filter(
                Expense.date >= date(y, m, 1),
                Expense.date <= date(y, m, monthrange(y, m)[1]),
            )
        except (ValueError, IndexError):
            pass

    rows = q.all()
    return [
        PersonBreakdownItem(
            person=_first_name(full_name),
            total=float(total),
            count=count,
        )
        for _user_id, full_name, total, count in rows
        if total > 0
    ]


class TrendItem(BaseModel):
    month: str
    total: float
    count: int


@router.get("/trend", response_model=list[TrendItem])
def get_expenses_trend(
    months: int = 6,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    uid_list = get_group_user_ids(current_user.id, db)
    today = date.today()
    start_date = add_months(today, -months + 1).replace(day=1)

    rows = (
        db.query(
            func.to_char(Expense.date, "YYYY-MM"),
            func.coalesce(func.sum(Expense.amount), 0.0),
            func.count(Expense.id),
        )
        .filter(
            Expense.user_id.in_(uid_list),
            Expense.amount > 0,
            Expense.date >= start_date,
        )
        .group_by(func.to_char(Expense.date, "YYYY-MM"))
        .order_by(func.to_char(Expense.date, "YYYY-MM"))
        .all()
    )

    return [
        TrendItem(month=month_key, total=float(total), count=count)
        for month_key, total, count in rows
    ]
