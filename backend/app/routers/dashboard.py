import json
import os
from calendar import monthrange
from collections import Counter, defaultdict
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import desc, func
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.models import Card, Category, Expense, User
from app.routers.groups import get_group_user_ids
from app.services.auth import get_current_user
from app.services.date_utils import add_months
from app.services.normalizers import normalize_bank

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


def _card_network(card_str: str) -> str:
    s = (card_str or "").strip().lower()
    if "visa" in s:
        return "visa"
    if "mastercard" in s or "master card" in s:
        return "mastercard"
    if "amex" in s or "american express" in s:
        return "amex"
    return s or "unknown"


def _get_card_info(e: Expense, cards_by_id: dict) -> tuple[str, str, str]:
    """Return (card_name, bank, holder) for an expense, using card_id when available."""
    if e.card_id and e.card_id in cards_by_id:
        c = cards_by_id[e.card_id]
        return c.card_name, c.bank or "", c.holder or ""
    return "", "", ""


def _load_cards_and_accounts(uid_list: list[int], expenses: list[Expense], db: Session):
    """Load cards and accounts for group users only."""
    from app.models import Account

    # Cards: only from group members
    cards_by_id = {c.id: c for c in db.query(Card).filter(Card.user_id.in_(uid_list)).all()}

    # Accounts: only from group members — return name + type for display
    accounts_by_id = {
        a.id: {"name": a.name, "type": a.type}
        for a in db.query(Account).filter(Account.user_id.in_(uid_list)).all()
    }

    return cards_by_id, accounts_by_id


def _apply_filters(q, month_val, search_val, person_val, cat_id_val, bank_val=None):
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
    if search_val:
        q = q.filter(Expense.description.ilike(f"%{search_val}%"))
    if person_val:
        q = q.join(Card, Expense.card_id == Card.id, isouter=True).filter(
            Card.holder.ilike(f"%{person_val}%")
        )
    if cat_id_val is not None:
        q = q.filter(Expense.category_id == cat_id_val)
    if bank_val:
        q = q.join(Card, Expense.card_id == Card.id, isouter=True).filter(
            Card.bank.ilike(f"%{bank_val}%")
        )
    return q


@router.get("/summary")
def get_summary(
    month: str | None = None,
    group_by: str = "month",
    search: str | None = None,
    person: str | None = None,
    category_id: int | None = None,
    bank: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    uid_list = get_group_user_ids(current_user.id, db)

    base_q = (
        db.query(Expense)
        .options(joinedload(Expense.card_rel))
        .filter(Expense.user_id.in_(uid_list))
    )
    expenses = (
        _apply_filters(base_q, month, search, person, category_id, bank)
        .order_by(desc(Expense.date))
        .all()
    )
    cards_by_id, _ = _load_cards_and_accounts(uid_list, expenses, db)
    categories = db.query(Category).all()
    cat_map = {c.id: c for c in categories}
    total = sum(e.amount for e in expenses if not e.is_income)

    # Calcular total_by_account (excluir gastos con tarjetas de credito)
    credit_cards = (
        db.query(Card).filter(Card.user_id.in_(uid_list), Card.card_type == "credito").all()
    )
    credit_card_ids = {c.id for c in credit_cards}

    def is_credit_card_expense(e: Expense) -> bool:
        return e.card_id is not None and e.card_id in credit_card_ids

    total_by_account = sum(
        e.amount for e in expenses if not is_credit_card_expense(e) and not e.is_income
    )

    by_category: dict = {}
    for e in expenses:
        # Skip income from expense category aggregation
        if e.is_income:
            continue

        if e.category_id and e.category_id in cat_map:
            cat = cat_map[e.category_id]
            cid, cname, ccolor = cat.id, cat.name, cat.color
            parent = cat_map.get(cat.parent_id) if cat.parent_id else None
            pid = parent.id if parent else None
            pname = parent.name if parent else None
            pcolor = parent.color if parent else None
        else:
            cid, cname, ccolor = None, "Sin categoría", "#6b7280"
            pid, pname, pcolor = None, None, None
        cat_key = cid if cid is not None else "__uncategorized__"
        if cat_key not in by_category:
            by_category[cat_key] = {
                "category_id": cid,
                "category_name": cname,
                "category_color": ccolor,
                "parent_id": pid,
                "parent_name": pname,
                "parent_color": pcolor,
                "total": 0.0,
                "count": 0,
                "previous_total": 0.0,
            }
        by_category[cat_key]["total"] += e.amount
        by_category[cat_key]["count"] += 1

    if month:
        try:
            y, m = int(month[:4]), int(month[5:7])
            pm = m - 1 if m > 1 else 12
            py = y if m > 1 else y - 1
            prev_expenses = _apply_filters(
                base_q, f"{py}-{pm:02d}", search, person, category_id, bank
            ).all()
            for e in prev_expenses:
                # Skip income from previous month calculation
                if e.is_income:
                    continue
                prev_cat_key = (
                    e.category_id
                    if e.category_id and e.category_id in cat_map
                    else "__uncategorized__"
                )
                if prev_cat_key not in by_category:
                    # Category existed last month but not this month — add it with total=0
                    if prev_cat_key == "__uncategorized__":
                        by_category[prev_cat_key] = {
                            "category_id": None,
                            "category_name": "Sin categoría",
                            "category_color": "#6b7280",
                            "parent_id": None,
                            "parent_name": None,
                            "parent_color": None,
                            "total": 0.0,
                            "count": 0,
                            "previous_total": 0.0,
                        }
                    elif prev_cat_key in cat_map:
                        cat = cat_map[prev_cat_key]
                        parent = cat_map.get(cat.parent_id) if cat.parent_id else None
                        by_category[prev_cat_key] = {
                            "category_id": cat.id,
                            "category_name": cat.name,
                            "category_color": cat.color,
                            "parent_id": parent.id if parent else None,
                            "parent_name": parent.name if parent else None,
                            "parent_color": parent.color if parent else None,
                            "total": 0.0,
                            "count": 0,
                            "previous_total": 0.0,
                        }
                by_category[prev_cat_key]["previous_total"] += e.amount
        except (ValueError, IndexError):
            pass

    # Income breakdown
    by_income: dict = {}
    for e in expenses:
        # Only process income
        if not e.is_income:
            continue

        if e.category_id and e.category_id in cat_map:
            cat = cat_map[e.category_id]
            cid, cname, ccolor = cat.id, cat.name, cat.color
            parent = cat_map.get(cat.parent_id) if cat.parent_id else None
            pid = parent.id if parent else None
            pname = parent.name if parent else None
            pcolor = parent.color if parent else None
        else:
            cid, cname, ccolor = None, "Sin categoría", "#6b7280"
            pid, pname, pcolor = None, None, None

        if cname not in by_income:
            by_income[cname] = {
                "category_id": cid,
                "category_name": cname,
                "category_color": ccolor,
                "parent_id": pid,
                "parent_name": pname,
                "parent_color": pcolor,
                "total": 0.0,
                "count": 0,
            }
        by_income[cname]["total"] += e.amount  # Already positive
        by_income[cname]["count"] += 1

    by_period: dict = {}
    for e in expenses:
        if group_by == "week":
            key = e.date.strftime("%G-W%V")
        elif group_by == "year":
            key = e.date.strftime("%Y")
        else:
            key = e.date.strftime("%Y-%m")
        if key not in by_period:
            by_period[key] = {"period": key, "total": 0.0, "count": 0}
        by_period[key]["total"] += e.amount
        by_period[key]["count"] += 1

    by_card: dict = {}
    for e in expenses:
        if e.is_income:
            continue
        card_name, card_bank, holder = _get_card_info(e, cards_by_id)
        if not card_name:
            continue
        key = f"{card_name}|{card_bank}|{holder}"
        if key not in by_card:
            by_card[key] = {
                "card": card_name,
                "bank": card_bank,
                "person": holder,
                "total": 0.0,
                "count": 0,
            }
        by_card[key]["total"] += e.amount
        by_card[key]["count"] += 1

    by_currency: dict = {}
    for e in expenses:
        cur = e.currency or "ARS"
        if cur not in by_currency:
            by_currency[cur] = {"currency": cur, "total": 0.0, "count": 0}
        by_currency[cur]["total"] += e.amount
        by_currency[cur]["count"] += 1

    def expense_to_dict(e: Expense) -> dict:
        cat = cat_map.get(e.category_id) if e.category_id else None
        card_name, card_bank, holder = _get_card_info(e, cards_by_id)
        return {
            "id": e.id,
            "date": e.date.isoformat(),
            "description": e.description,
            "amount": e.amount,
            "currency": e.currency or "ARS",
            "category_id": e.category_id,
            "category_name": cat.name if cat else None,
            "category_color": cat.color if cat else None,
            "card": card_name,
            "bank": card_bank,
            "person": holder,
            "notes": e.notes or "",
        }

    today = date.today()
    six_months_ago = add_months(today, -6)

    hist_expenses = (
        db.query(Expense)
        .filter(Expense.user_id.in_(uid_list), Expense.date >= six_months_ago)
        .all()
    )
    trend_history: dict = {}
    for e in hist_expenses:
        k = e.date.strftime("%Y-%m")
        if k not in trend_history:
            trend_history[k] = {"month": k, "total": 0.0, "count": 0}
        trend_history[k]["total"] += e.amount
        trend_history[k]["count"] += 1

    installments_exp = (
        db.query(Expense)
        .filter(
            Expense.user_id.in_(uid_list),
            Expense.installment_group_id != None,
            Expense.installment_group_id != "",
        )
        .all()
    )
    groups: dict = {}
    for e in installments_exp:
        if e.installment_group_id not in groups:
            groups[e.installment_group_id] = []
        groups[e.installment_group_id].append(e)

    # Also query ScheduledExpenses to add their amounts directly
    from app.models import ScheduledExpense

    scheduled = (
        db.query(ScheduledExpense)
        .filter(
            ScheduledExpense.user_id.in_(uid_list),
            ScheduledExpense.status == "PENDING",
            ScheduledExpense.installment_group_id.isnot(None),
        )
        .all()
    )

    # Build scheduled amounts per month
    scheduled_amounts: dict = {}
    scheduled_gids: set = set()
    for se in scheduled:
        smonth = (
            se.scheduled_date.strftime("%Y-%m")
            if isinstance(se.scheduled_date, date)
            else str(se.scheduled_date)[:7]
        )
        if smonth not in scheduled_amounts:
            scheduled_amounts[smonth] = 0.0
        scheduled_amounts[smonth] += abs(se.amount)
        scheduled_gids.add(se.installment_group_id)

    trend_future: dict = {}
    for gid, exps in groups.items():
        exps_sorted = sorted(exps, key=lambda x: x.installment_number or 0)
        total_inst = exps_sorted[0].installment_total or 0
        paid = len(exps_sorted)
        remaining = max(0, total_inst - paid)
        if remaining == 0:
            continue
        # Skip projection for groups that have ScheduledExpenses
        if gid in scheduled_gids:
            continue
        last_exp = exps_sorted[-1]
        inst_amount = abs(last_exp.amount)
        last_date = last_exp.date
        for i in range(1, remaining + 1):
            future_date = add_months(last_date, i)
            future_key = future_date.strftime("%Y-%m")
            if future_key not in trend_future:
                trend_future[future_key] = 0.0
            trend_future[future_key] += inst_amount

    # Add ScheduledExpense amounts directly
    for month, amount in scheduled_amounts.items():
        if month not in trend_future:
            trend_future[month] = 0.0
        trend_future[month] += amount

    return {
        "total_amount": total,
        "total_by_account": total_by_account,
        "total_expenses": sum(1 for e in expenses if not e.is_income),
        "by_category": sorted(by_category.values(), key=lambda x: x["total"], reverse=True),
        "by_income": sorted(by_income.values(), key=lambda x: x["total"], reverse=True),
        "by_period": sorted(by_period.values(), key=lambda x: x["period"]),
        "by_currency": sorted(by_currency.values(), key=lambda x: x["total"], reverse=True),
        "by_card": sorted(by_card.values(), key=lambda x: x["total"], reverse=True),
        "recent_expenses": [expense_to_dict(e) for e in expenses[:10]],
        "trend_data": {
            "history": sorted(trend_history.values(), key=lambda x: x["month"]),
            "future_installments": trend_future,
        },
    }


@router.get("/monthly-report")
def get_monthly_report(
    month: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Generate a monthly analysis report with income vs expenses, savings rate, top categories, MoM comparison."""
    uid_list = get_group_user_ids(current_user.id, db)

    # Determine target month
    if month:
        try:
            y, m = int(month[:4]), int(month[5:7])
            target_start = date(y, m, 1)
        except (ValueError, IndexError):
            target_start = date.today().replace(day=1)
    else:
        target_start = date.today().replace(day=1)

    target_end = date(target_start.year, target_start.month, monthrange(target_start.year, target_start.month)[1])

    # Previous month for comparison
    prev_start = add_months(target_start, -1)
    prev_end = date(prev_start.year, prev_start.month, monthrange(prev_start.year, prev_start.month)[1])

    def _query_totals(start: date, end: date):
        expenses = (
            db.query(Expense)
            .filter(Expense.user_id.in_(uid_list), Expense.date >= start, Expense.date <= end)
            .all()
        )
        total_expenses = sum(abs(e.amount) for e in expenses if not e.is_income)
        total_income = sum(abs(e.amount) for e in expenses if e.is_income)
        count = sum(1 for e in expenses if not e.is_income)

        # By category (only expenses, not income)
        by_cat = defaultdict(lambda: {"total": 0.0, "count": 0, "name": "", "color": ""})
        for e in expenses:
            if e.is_income:
                continue
            cat_name = "Sin categoría"
            cat_color = "#6b7280"
            if e.category_id:
                cat = db.query(Category).filter(Category.id == e.category_id).first()
                if cat:
                    cat_name = cat.name
                    cat_color = cat.color or "#6b7280"
                    # Use parent name if it's a subcategory
                    if cat.parent_id:
                        parent = db.query(Category).filter(Category.id == cat.parent_id).first()
                        if parent:
                            cat_name = f"{parent.name} > {cat.name}"
            by_cat[e.category_id or 0]["total"] += abs(e.amount)
            by_cat[e.category_id or 0]["count"] += 1
            by_cat[e.category_id or 0]["name"] = cat_name
            by_cat[e.category_id or 0]["color"] = cat_color

        top_categories = sorted(by_cat.values(), key=lambda x: x["total"], reverse=True)[:5]

        return {
            "total_expenses": total_expenses,
            "total_income": total_income,
            "count": count,
            "top_categories": top_categories,
        }

    current = _query_totals(target_start, target_end)
    previous = _query_totals(prev_start, prev_end)

    # Savings rate
    savings_rate = 0.0
    if current["total_income"] > 0:
        savings_rate = ((current["total_income"] - current["total_expenses"]) / current["total_income"]) * 100

    # MoM change
    mom_change = 0.0
    if previous["total_expenses"] > 0:
        mom_change = ((current["total_expenses"] - previous["total_expenses"]) / previous["total_expenses"]) * 100

    return {
        "month": target_start.strftime("%Y-%m"),
        "total_expenses": current["total_expenses"],
        "total_income": current["total_income"],
        "savings_rate": round(savings_rate, 1),
        "expense_count": current["count"],
        "top_categories": current["top_categories"],
        "previous_total": previous["total_expenses"],
        "previous_income": previous["total_income"],
        "mom_change": round(mom_change, 1),
    }


@router.get("/account-expenses")
def get_account_expenses(
    month: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    uid_list = get_group_user_ids(current_user.id, db)
    base_q = (
        db.query(Expense)
        .options(joinedload(Expense.card_rel))
        .filter(Expense.user_id.in_(uid_list))
    )

    if month:
        try:
            y, m = int(month[:4]), int(month[5:7])
            base_q = base_q.filter(
                Expense.date >= date(y, m, 1), Expense.date <= date(y, m, monthrange(y, m)[1])
            )
        except (ValueError, IndexError):
            pass

    expenses = base_q.order_by(Expense.date).all()
    cards_by_id, _ = _load_cards_and_accounts(uid_list, expenses, db)

    credit_card_ids = {cid for cid, c in cards_by_id.items() if c.card_type == "credito"}

    def is_credit_card_expense(e: Expense) -> bool:
        return e.card_id is not None and e.card_id in credit_card_ids

    cat_map = {c.id: c for c in db.query(Category).all()}

    result = []
    for e in expenses:
        if is_credit_card_expense(e):
            continue
        # Skip income
        if e.is_income:
            continue
        cat = cat_map.get(e.category_id) if e.category_id else None
        card_name, card_bank, holder = _get_card_info(e, cards_by_id)
        result.append(
            {
                "id": e.id,
                "date": e.date.isoformat(),
                "description": e.description,
                "amount": e.amount,
                "currency": e.currency or "ARS",
                "category_id": e.category_id,
                "category_name": cat.name if cat else None,
                "category_color": cat.color if cat else None,
                "card": card_name,
                "bank": card_bank,
                "person": holder,
            }
        )

    return result


@router.get("/installments")
def get_installments_dashboard(
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    from app.models import ScheduledExpense

    uid_list = get_group_user_ids(current_user.id, db)

    # Cuotas realizadas (expenses)
    paid_exps = (
        db.query(Expense)
        .options(joinedload(Expense.card_rel))
        .filter(
            Expense.user_id.in_(uid_list),
            Expense.installment_group_id != None,
            Expense.installment_group_id != "",
        )
        .all()
    )

    # Cuotas programadas (scheduled_expenses)
    scheduled_exps = (
        db.query(ScheduledExpense)
        .filter(ScheduledExpense.user_id.in_(uid_list), ScheduledExpense.status == "PENDING")
        .all()
    )

    cards_by_id, _ = _load_cards_and_accounts(uid_list, paid_exps, db)

    cat_map = {c.id: c for c in db.query(Category).all()}
    groups: dict = {}

    # Procesar cuotas pagadas
    for e in paid_exps:
        gid = e.installment_group_id
        card_name, card_bank, holder = _get_card_info(e, cards_by_id)
        if gid not in groups:
            groups[gid] = {
                "installment_group_id": gid,
                "description": e.description,
                "installment_total": e.installment_total or 0,
                "installments_paid": 0,
                "remaining_installments": 0,
                "total_amount": 0.0,
                "installment_amount": abs(e.amount),
                "paid_dates": [],
                "next_dates": [],  # NUEVO
                "category_id": e.category_id,
                "category_name": cat_map[e.category_id].name if e.category_id in cat_map else None,
                "category_color": cat_map[e.category_id].color
                if e.category_id in cat_map
                else None,
                "bank": card_bank,
                "person": holder,
                "currency": e.currency or "ARS",
                "card": card_name,
                "card_id": e.card_id,
            }
        groups[gid]["installments_paid"] += 1
        groups[gid]["total_amount"] += e.amount
        groups[gid]["paid_dates"].append(e.date)

    # Procesar cuotas programadas
    for s in scheduled_exps:
        gid = s.installment_group_id
        card_name, card_bank, holder = "", "", ""
        if s.card_id and s.card_id in cards_by_id:
            c = cards_by_id[s.card_id]
            card_name, card_bank, holder = c.card_name, c.bank or "", c.holder or ""
        if gid not in groups:
            groups[gid] = {
                "installment_group_id": gid,
                "description": s.description,
                "installment_total": s.installment_total or 0,
                "installments_paid": 0,
                "remaining_installments": 0,
                "total_amount": 0.0,
                "installment_amount": abs(s.amount),
                "paid_dates": [],
                "next_dates": [],
                "category_id": s.category_id,
                "category_name": cat_map[s.category_id].name if s.category_id in cat_map else None,
                "category_color": cat_map[s.category_id].color
                if s.category_id in cat_map
                else None,
                "bank": card_bank,
                "person": holder,
                "currency": s.currency or "ARS",
                "card": card_name,
                "card_id": s.card_id,
            }
        groups[gid]["remaining_installments"] += 1
        groups[gid]["next_dates"].append(s.scheduled_date.isoformat())

    # Construir resultado
    result = []
    for g in groups.values():
        next_dates = sorted(g["next_dates"])
        next_date = next_dates[0] if next_dates else None

        # CORRECT: remaining = total - paid (not count of ScheduledExpenses)
        remaining = max(0, g["installment_total"] - g["installments_paid"])

        result.append(
            {
                "installment_group_id": g["installment_group_id"],
                "description": g["description"],
                "installment_total": g["installment_total"],
                "installments_paid": g["installments_paid"],
                "remaining_installments": remaining,
                "total_amount": g["total_amount"],
                "installment_amount": g["installment_amount"],
                "next_date": next_date,
                "next_dates": next_dates,
                "category_id": g["category_id"],
                "category_name": g["category_name"],
                "category_color": g["category_color"],
                "bank": g["bank"],
                "person": g["person"],
                "currency": g["currency"],
                "card": g["card"],
                "card_id": g["card_id"],
            }
        )

    return sorted(
        result, key=lambda x: (x["remaining_installments"] == 0, x["next_date"] or "9999-99")
    )


@router.get("/installments/monthly-load")
def get_installments_monthly_load(
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    today = date.today()
    current_month = today.strftime("%Y-%m")
    uid_list = get_group_user_ids(current_user.id, db)

    # Initialize all 7 months in window with zeros (3 past, current, 3 future)
    monthly: dict = {}
    for offset in range(-3, 4):
        m = add_months(today, offset)
        key = m.strftime("%Y-%m")
        monthly[key] = {
            "month": key,
            "total": 0.0,
            "count": 0,
            "is_past": key < current_month,
            "is_current": key == current_month,
        }

    cutoff_start = date.today() - timedelta(days=365)
    cutoff_end = date.today() + timedelta(days=180)
    exps = (
        db.query(Expense)
        .filter(
            Expense.user_id.in_(uid_list),
            Expense.installment_group_id != None,
            Expense.installment_group_id != "",
            Expense.date >= cutoff_start,
            Expense.date <= cutoff_end,
        )
        .order_by(Expense.installment_number)
        .all()
    )

    # Sum ALL installment expenses by their real date
    for e in exps:
        key = e.date.strftime("%Y-%m") if isinstance(e.date, date) else str(e.date)[:7]
        if key in monthly:
            monthly[key]["total"] += abs(e.amount)
            monthly[key]["count"] += 1

    # Future months: project remaining installments per group
    # Load scheduled expenses to add their amounts directly
    from app.models import ScheduledExpense

    scheduled = (
        db.query(ScheduledExpense)
        .filter(
            ScheduledExpense.user_id.in_(uid_list),
            ScheduledExpense.status == "PENDING",
            ScheduledExpense.installment_group_id.isnot(None),
        )
        .all()
    )

    # Add ScheduledExpense amounts directly to their months
    scheduled_gids: set = set()
    scheduled_count_by_gid: dict = {}
    scheduled_last_date_by_gid: dict = {}
    for se in scheduled:
        smonth = (
            se.scheduled_date.strftime("%Y-%m")
            if isinstance(se.scheduled_date, date)
            else str(se.scheduled_date)[:7]
        )
        if smonth in monthly:
            monthly[smonth]["total"] += abs(se.amount)
            monthly[smonth]["count"] += 1
        scheduled_gids.add(se.installment_group_id)
        scheduled_count_by_gid[se.installment_group_id] = (
            scheduled_count_by_gid.get(se.installment_group_id, 0) + 1
        )
        # Track the last scheduled date per group
        if (
            se.installment_group_id not in scheduled_last_date_by_gid
            or se.scheduled_date > scheduled_last_date_by_gid[se.installment_group_id]
        ):
            scheduled_last_date_by_gid[se.installment_group_id] = se.scheduled_date

    groups: dict = {}
    for e in exps:
        gid = e.installment_group_id
        if gid not in groups:
            groups[gid] = {
                "installment_total": e.installment_total or 0,
                "amount": abs(e.amount),
                "paid": [],
            }
        groups[gid]["paid"].append((e.installment_number or 0, e.date))

    # Project remaining installments for ALL groups with unpaid balance
    for gid, g in groups.items():
        paid = len(g["paid"])
        remaining = max(0, g["installment_total"] - paid)
        if remaining == 0 or not g["paid"]:
            continue
        scheduled_count = scheduled_count_by_gid.get(gid, 0)
        unprojected = max(0, remaining - scheduled_count)
        if unprojected == 0:
            continue
        # Start projection after the last ScheduledExpense date (or last paid date)
        if gid in scheduled_last_date_by_gid:
            start_date = scheduled_last_date_by_gid[gid]
        else:
            max_num, max_date = max(g["paid"], key=lambda x: x[0])
            start_date = max_date
        next_date = add_months(start_date, 1)
        for i in range(unprojected):
            charge_date = add_months(next_date, i)
            key = charge_date.strftime("%Y-%m")
            if key >= current_month and key in monthly:
                monthly[key]["total"] += g["amount"]
                monthly[key]["count"] += 1

    return sorted(monthly.values(), key=lambda x: x["month"])


@router.get("/scheduled-summary")
def get_scheduled_summary(
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    from app.models import ScheduledExpense

    uid_list = get_group_user_ids(current_user.id, db)
    today = date.today()
    current_month_start = date(today.year, today.month, 1)
    # Show 3 months forward from current month
    future = add_months(today, 3)
    future_end = date(future.year, future.month, monthrange(future.year, future.month)[1])

    cat_map = {c.id: c for c in db.query(Category).all()}

    # Cuotas pendientes (installment_total > 1) — current month + 3 months forward
    pending_installments = (
        db.query(ScheduledExpense)
        .filter(
            ScheduledExpense.user_id.in_(uid_list),
            ScheduledExpense.status == "PENDING",
            ScheduledExpense.installment_total > 1,
            ScheduledExpense.scheduled_date >= current_month_start,
            ScheduledExpense.scheduled_date <= future_end,
        )
        .order_by(ScheduledExpense.scheduled_date)
        .all()
    )

    # Gastos manuales programados (installment_total = 1) — current month + 3 months forward
    pending_manual = (
        db.query(ScheduledExpense)
        .filter(
            ScheduledExpense.user_id.in_(uid_list),
            ScheduledExpense.status == "PENDING",
            ScheduledExpense.installment_total == 1,
            ScheduledExpense.scheduled_date >= current_month_start,
            ScheduledExpense.scheduled_date <= future_end,
        )
        .order_by(ScheduledExpense.scheduled_date)
        .all()
    )

    # Load cards referenced by scheduled expenses
    sched_card_ids = {s.card_id for s in pending_installments + pending_manual if s.card_id}
    user_cards = db.query(Card).filter(Card.user_id.in_(uid_list)).all()
    extra_card_ids = sched_card_ids - {c.id for c in user_cards}
    extra_cards = db.query(Card).filter(Card.id.in_(extra_card_ids)).all() if extra_card_ids else []
    cards_by_id = {c.id: c for c in user_cards + extra_cards}

    result = {
        "installments": [],
        "manual": [],
    }

    for s in pending_installments:
        cat = cat_map.get(s.category_id) if s.category_id else None
        card_name, card_bank = "", ""
        if s.card_id and s.card_id in cards_by_id:
            c = cards_by_id[s.card_id]
            card_name, card_bank = c.card_name, c.bank or ""
        result["installments"].append(
            {
                "id": s.id,
                "description": s.description,
                "amount": s.amount,
                "currency": s.currency or "ARS",
                "scheduled_date": s.scheduled_date.isoformat(),
                "installment_number": s.installment_number,
                "installment_total": s.installment_total,
                "category_name": cat.name if cat else None,
                "category_color": cat.color if cat else None,
                "card": card_name,
                "bank": card_bank,
            }
        )

    for s in pending_manual:
        cat = cat_map.get(s.category_id) if s.category_id else None
        card_name, card_bank = "", ""
        if s.card_id and s.card_id in cards_by_id:
            c = cards_by_id[s.card_id]
            card_name, card_bank = c.card_name, c.bank or ""
        result["manual"].append(
            {
                "id": s.id,
                "description": s.description,
                "amount": s.amount,
                "currency": s.currency or "ARS",
                "scheduled_date": s.scheduled_date.isoformat(),
                "category_name": cat.name if cat else None,
                "category_color": cat.color if cat else None,
                "card": card_name,
                "bank": card_bank,
            }
        )

    return result


@router.get("/credit-card-pasivos")
def get_credit_card_pasivos(
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    from app.models import ScheduledExpense

    uid_list = get_group_user_ids(current_user.id, db)

    credit_cards = (
        db.query(Card).filter(Card.user_id.in_(uid_list), Card.card_type == "credito").all()
    )
    credit_card_ids = {c.id for c in credit_cards}

    # 1) Sum PENDING ScheduledExpenses for credit cards
    pending_pasivos = (
        db.query(ScheduledExpense)
        .filter(
            ScheduledExpense.user_id.in_(uid_list),
            ScheduledExpense.status == "PENDING",
        )
        .all()
    )

    # Load credit cards referenced by pending pasivos
    pasivo_card_ids = {s.card_id for s in pending_pasivos if s.card_id} - credit_card_ids
    extra_cards = (
        db.query(Card).filter(Card.id.in_(pasivo_card_ids)).all() if pasivo_card_ids else []
    )
    cards_by_id = {c.id: c for c in credit_cards + extra_cards}

    total_pasivos = 0.0
    pasivos_detail = []
    scheduled_gids: set = set()

    for s in pending_pasivos:
        is_credit_card = s.card_id is not None and s.card_id in credit_card_ids

        # Always track group to prevent Expense projection double-counting
        scheduled_gids.add(s.installment_group_id)

        # Only count credit card scheduled expenses
        if not is_credit_card:
            continue

        total_pasivos += s.amount

        card_name, card_bank = "", ""
        if s.card_id and s.card_id in cards_by_id:
            c = cards_by_id[s.card_id]
            card_name, card_bank = c.card_name, c.bank or ""
        pasivos_detail.append(
            {
                "id": s.id,
                "description": s.description,
                "amount": s.amount,
                "currency": s.currency or "ARS",
                "scheduled_date": s.scheduled_date.isoformat(),
                "installment_number": s.installment_number,
                "installment_total": s.installment_total,
                "card": card_name,
                "bank": card_bank,
            }
        )

    # 2) Project future installments from Expenses for credit cards
    #    (only for groups that don't already have ScheduledExpenses)
    installment_exp = (
        db.query(Expense)
        .filter(
            Expense.user_id.in_(uid_list),
            Expense.installment_group_id != None,
            Expense.installment_group_id != "",
            Expense.card_id.in_(credit_card_ids),
        )
        .all()
    )

    groups: dict = {}
    for e in installment_exp:
        gid = e.installment_group_id
        if gid not in groups:
            groups[gid] = {
                "installment_total": e.installment_total or 0,
                "amount": abs(e.amount),
                "paid": [],
                "card_id": e.card_id,
            }
        groups[gid]["paid"].append(e.installment_number or 0)

    for gid, g in groups.items():
        if gid in scheduled_gids:
            continue  # Already counted via ScheduledExpenses
        paid = len(g["paid"])
        remaining = max(0, g["installment_total"] - paid)
        if remaining == 0:
            continue
        total_pasivos += g["amount"] * remaining
        # Add to detail — one entry per remaining installment
        card_name, card_bank = "", ""
        if g["card_id"] and g["card_id"] in cards_by_id:
            c = cards_by_id[g["card_id"]]
            card_name, card_bank = c.card_name, c.bank or ""
        elif g["card_id"]:
            c = db.query(Card).filter(Card.id == g["card_id"]).first()
            if c:
                card_name, card_bank = c.card_name, c.bank or ""
                cards_by_id[c.id] = c
        for i in range(remaining):
            pasivos_detail.append(
                {
                    "id": None,
                    "description": g.get(
                        "description", f"Cuota {paid + i + 1}/{g['installment_total']}"
                    ),
                    "amount": g["amount"],
                    "currency": "ARS",
                    "scheduled_date": None,
                    "installment_number": paid + i + 1,
                    "installment_total": g["installment_total"],
                    "card": card_name,
                    "bank": card_bank,
                }
            )

    return {
        "total_pasivos": total_pasivos,
        "count": len(pasivos_detail),
        "pasivos": pasivos_detail,
    }


@router.get("/top-merchants")
def get_top_merchants(
    month: str | None = None,
    person: str | None = None,
    bank: str | None = None,
    limit: int = 20,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    uid_list = get_group_user_ids(current_user.id, db)
    q = db.query(Expense.description, Expense.amount, Expense.category_id).filter(
        Expense.user_id.in_(uid_list), Expense.amount > 0, Expense.is_income == False
    )
    if month:
        try:
            y, m = int(month[:4]), int(month[5:7])
            q = q.filter(
                Expense.date >= date(y, m, 1), Expense.date <= date(y, m, monthrange(y, m)[1])
            )
        except (ValueError, IndexError):
            pass
    if person:
        q = q.join(Card, Expense.card_id == Card.id, isouter=True).filter(
            Card.holder.ilike(f"%{person}%")
        )
    if bank:
        q = q.join(Card, Expense.card_id == Card.id, isouter=True).filter(
            Card.bank.ilike(f"%{bank}%")
        )

    rows = q.all()

    groups: dict = {}
    for description, amount, cat_id in rows:
        key = description.lower().strip()
        if key not in groups:
            groups[key] = {"description": description, "total": 0.0, "count": 0, "cats": []}
        groups[key]["total"] += amount
        groups[key]["count"] += 1
        if cat_id:
            groups[key]["cats"].append(cat_id)

    cat_ids = set()
    for g in groups.values():
        if g["cats"]:
            cat_ids.add(Counter(g["cats"]).most_common(1)[0][0])
    cat_map = (
        {c.id: c for c in db.query(Category).filter(Category.id.in_(cat_ids)).all()}
        if cat_ids
        else {}
    )

    result = []
    for g in groups.values():
        top_cat_id = Counter(g["cats"]).most_common(1)[0][0] if g["cats"] else None
        cat = cat_map.get(top_cat_id) if top_cat_id else None
        result.append(
            {
                "description": g["description"],
                "total_amount": round(g["total"], 2),
                "count": g["count"],
                "category_name": cat.name if cat else None,
                "category_color": cat.color if cat else None,
            }
        )

    result.sort(key=lambda x: x["total_amount"], reverse=True)
    return result[:limit]


@router.get("/card-summary")
def get_card_summary(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    uid_list = get_group_user_ids(current_user.id, db)

    cutoff = date.today() - timedelta(days=365)
    exps = (
        db.query(Expense)
        .options(joinedload(Expense.card_rel))
        .filter(
            Expense.user_id.in_(uid_list),
            Expense.amount > 0,
            Expense.date >= cutoff,
        )
        .all()
    )

    cards_by_id, user_accounts_by_id = _load_cards_and_accounts(uid_list, exps, db)

    # Group by card_id (primary) or account_id (fallback)
    by_card: dict = {}
    by_card_monthly: dict = {}

    for e in exps:
        month_key = e.date.strftime("%Y-%m") if e.date else "1970-01"

        if e.card_id and e.card_id in cards_by_id:
            key = f"card:{e.card_id}"
        elif e.account_id:
            key = f"account:{e.account_id}"
        else:
            continue  # Skip expenses without card or account

        if key not in by_card:
            if key.startswith("card:"):
                c = cards_by_id[int(key.split(":")[1])]
                by_card[key] = {
                    "bank": c.bank or "",
                    "network": _card_network(c.card_name),
                    "card_name": c.card_name,
                    "holder": c.holder or "",
                    "card_type": c.card_type,
                    "total_amount": 0.0,
                    "count": 0,
                    "currency": e.currency or "ARS",
                    "last_used": None,
                    "card_ids": {c.id: 1},
                    "account_ids": {},
                }
            else:
                acct_id = int(key.split(":")[1])
                acct_info = user_accounts_by_id.get(
                    acct_id, {"name": "Efectivo", "type": "efectivo"}
                )
                by_card[key] = {
                    "bank": "",
                    "network": "unknown",
                    "card_name": acct_info["name"],
                    "holder": "",
                    "card_type": "debito",
                    "total_amount": 0.0,
                    "count": 0,
                    "currency": e.currency or "ARS",
                    "last_used": None,
                    "card_ids": {},
                    "account_ids": {acct_id: 1},
                }
            by_card_monthly[key] = {}

        g = by_card[key]
        g["total_amount"] += e.amount
        g["count"] += 1
        if not g["last_used"] or e.date > g["last_used"]:
            g["last_used"] = e.date
        if e.card_id:
            g["card_ids"][e.card_id] = g["card_ids"].get(e.card_id, 0) + 1
        if e.account_id:
            g["account_ids"][e.account_id] = g["account_ids"].get(e.account_id, 0) + 1
        by_card_monthly[key][month_key] = by_card_monthly[key].get(month_key, 0.0) + e.amount

    # Merge cards with the same card_id (same physical card)
    # This is already handled by grouping on card_id above

    result = []
    for key, g in by_card.items():
        monthly = by_card_monthly.get(key, {})
        months_list = sorted(monthly.keys(), reverse=True)[:12]
        monthly_data = [{"month": m, "total": monthly[m]} for m in reversed(months_list)]

        result.append(
            {
                "holder": g["holder"],
                "bank": g["bank"],
                "card_name": g["card_name"],
                "card_type": g["card_type"],
                "account_id": g.get("account_ids", {}).keys().__iter__().__next__()
                if g.get("account_ids")
                else None,
                "total_amount": g["total_amount"],
                "count": g["count"],
                "currency": g["currency"],
                "last_used": g["last_used"].isoformat() if g["last_used"] else None,
                "monthly": monthly_data,
            }
        )

    return sorted(result, key=lambda x: x["total_amount"], reverse=True)


@router.get("/card-category-breakdown")
def get_card_category_breakdown(
    month: str | None = None,
    bank: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    uid_list = get_group_user_ids(current_user.id, db)

    def _card_network_local(card_str: str) -> str:
        s = (card_str or "").strip().lower()
        if "visa" in s:
            return "Visa"
        if "mastercard" in s or "master card" in s:
            return "MC"
        if "amex" in s or "american express" in s:
            return "Amex"
        return s.title() or "Otra"

    q = (
        db.query(Expense)
        .options(joinedload(Expense.card_rel))
        .filter(Expense.user_id.in_(uid_list), Expense.amount > 0)
    )
    if month:
        try:
            y, m_num = int(month[:4]), int(month[5:7])
            q = q.filter(
                Expense.date >= date(y, m_num, 1),
                Expense.date <= date(y, m_num, monthrange(y, m_num)[1]),
            )
        except (ValueError, IndexError):
            pass
    if bank:
        q = q.join(Card, Expense.card_id == Card.id, isouter=True).filter(
            Card.bank.ilike(f"%{bank}%")
        )

    exps = q.all()
    cards_by_id, _ = _load_cards_and_accounts(uid_list, exps, db)
    cats_list = db.query(Category).all()
    cat_map = {c.id: c for c in cats_list}

    data: dict = {}
    cat_colors: dict = {}

    for e in exps:
        card_name, card_bank, holder = _get_card_info(e, cards_by_id)
        bank_norm = normalize_bank(card_bank) if card_bank else "Efectivo"
        network = _card_network_local(card_name)
        card_key = f"{bank_norm} {network}" if bank_norm != "Efectivo" else "Efectivo/Transferencia"

        cat = cat_map.get(e.category_id) if e.category_id else None
        cat_name = cat.name if cat else "Sin categoría"
        cat_color = cat.color if cat else "#94a3b8"
        cat_colors[cat_name] = cat_color

        if card_key not in data:
            data[card_key] = {}
        data[card_key][cat_name] = data[card_key].get(cat_name, 0.0) + e.amount

    rows = [
        {"card": k, **v}
        for k, v in sorted(data.items(), key=lambda x: sum(x[1].values()), reverse=True)
    ]
    categories = [{"name": n, "color": c} for n, c in cat_colors.items()]
    return {"rows": rows, "categories": categories}


@router.get("/category-trend")
def get_category_trend(
    months: int = 4,
    anchor_month: str | None = None,
    person: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    uid_list = get_group_user_ids(current_user.id, db)
    months = min(months, 24)

    if anchor_month:
        try:
            y = int(anchor_month[:4])
            m = int(anchor_month[5:7])
            base_date = date(y, m, 1)
        except (ValueError, IndexError):
            base_date = date.today()
    else:
        base_date = date.today()

    month_keys = []
    for i in range(months - 1, -1, -1):
        m = base_date.month - i
        y = base_date.year
        while m <= 0:
            m += 12
            y -= 1
        month_keys.append(f"{y}-{m:02d}")

    start = date.fromisoformat(f"{month_keys[0]}-01")

    rows_raw = (
        db.query(
            func.to_char(Expense.date, "YYYY-MM").label("month"),
            func.coalesce(Category.name, "Sin categoría").label("cat_name"),
            func.coalesce(Category.color, "#94a3b8").label("cat_color"),
            func.sum(Expense.amount).label("total"),
        )
        .outerjoin(Category, Expense.category_id == Category.id)
        .filter(
            Expense.user_id.in_(uid_list),
            Expense.amount > 0,
            Expense.is_income == False,
            Expense.date >= start,
        )
    )
    if person:
        rows_raw = rows_raw.outerjoin(Card, Expense.card_id == Card.id).filter(
            Card.holder.ilike(f"%{person}%")
        )
    rows_raw = rows_raw.group_by(
        func.to_char(Expense.date, "YYYY-MM"), Category.name, Category.color
    ).all()

    data: dict = {mk: {} for mk in month_keys}
    cat_colors: dict = {}
    for row in rows_raw:
        mk = row.month
        if mk not in data:
            continue
        data[mk][row.cat_name] = float(row.total)
        cat_colors[row.cat_name] = row.cat_color

    rows = [{"month": mk, **data[mk]} for mk in month_keys]
    categories = [{"name": n, "color": c} for n, c in cat_colors.items()]
    return {"rows": rows, "categories": categories}


@router.get("/ai-trends")
async def get_ai_trends(
    month: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    uid_list = get_group_user_ids(current_user.id, db)
    from google import genai
    from google.genai import types as genai_types

    from app.prompts import AI_TRENDS_PROMPT

    api_key = os.getenv("LLM_API_KEY")
    if not api_key:
        raise HTTPException(500, "LLM_API_KEY no configurada.")

    today = date.today()
    six_months_ago = add_months(today, -6)

    expenses_hist = (
        db.query(Expense)
        .filter(Expense.user_id.in_(uid_list), Expense.date >= six_months_ago)
        .order_by(Expense.date)
        .all()
    )

    cat_map = {c.id: c for c in db.query(Category).all()}

    by_month: dict = defaultdict(lambda: {"total": 0.0, "count": 0, "by_cat": defaultdict(float)})
    for e in expenses_hist:
        key = e.date.strftime("%Y-%m")
        by_month[key]["total"] += e.amount
        by_month[key]["count"] += 1
        cat_name = (
            cat_map[e.category_id].name
            if e.category_id and e.category_id in cat_map
            else "Sin categoría"
        )
        by_month[key]["by_cat"][cat_name] += e.amount

    installments_exp = (
        db.query(Expense)
        .filter(
            Expense.user_id.in_(uid_list),
            Expense.installment_group_id != None,
            Expense.installment_group_id != "",
        )
        .all()
    )

    groups: dict = defaultdict(list)
    for e in installments_exp:
        groups[e.installment_group_id].append(e)

    future_installments: dict = defaultdict(float)
    for _gid, exps in groups.items():
        exps_sorted = sorted(exps, key=lambda x: x.installment_number or 0)
        total_inst = exps_sorted[0].installment_total or 0
        paid = len(exps_sorted)
        remaining = max(0, total_inst - paid)
        if remaining == 0:
            continue
        last_exp = exps_sorted[-1]
        inst_amount = abs(last_exp.amount)
        last_date = last_exp.date
        for i in range(1, remaining + 1):
            future_date = add_months(last_date, i)
            future_key = future_date.strftime("%Y-%m")
            future_installments[future_key] += inst_amount

    sorted_months = sorted(by_month.keys())

    monthly_lines = []
    for m_key in sorted_months:
        d = by_month[m_key]
        cat_breakdown = ", ".join(
            f"{k}: ${v:,.0f}"
            for k, v in sorted(d["by_cat"].items(), key=lambda x: x[1], reverse=True)[:5]
        )
        monthly_lines.append(
            f"  {m_key}: total=${d['total']:,.0f} ({d['count']} transacciones) | {cat_breakdown}"
        )

    future_lines = []
    for i in range(1, 4):
        fm = add_months(today, i)
        fkey = fm.strftime("%Y-%m")
        inst_amt = future_installments.get(fkey, 0.0)
        future_lines.append(f"  {fkey}: cuotas_pendientes=${inst_amt:,.0f}")

    filter_ctx = (
        f"Mes en foco del usuario: {month}"
        if month
        else "Sin filtro de mes específico (usar todos los datos)"
    )

    context = f"""DATOS DE GASTOS HISTÓRICOS (últimos 6 meses):
{chr(10).join(monthly_lines) or "  Sin datos suficientes"}

CUOTAS PENDIENTES PROYECTADAS:
{chr(10).join(future_lines)}

{filter_ctx}

Fecha actual: {today.isoformat()}
"""

    client = genai.Client(api_key=api_key)
    try:
        response = await client.aio.models.generate_content(
            model="gemini-flash-latest",
            contents=context,
            config=genai_types.GenerateContentConfig(
                system_instruction=AI_TRENDS_PROMPT,
                response_mime_type="application/json",
            ),
        )
        result = json.loads(response.text)
    except json.JSONDecodeError:
        raise HTTPException(422, "La IA no pudo generar el análisis. Intentá más tarde.")
    except Exception as e:
        raise HTTPException(500, f"Error al llamar a la IA: {e}")

    for proj in result.get("projection", []):
        fkey = proj.get("month", "")
        proj["installments_amount"] = future_installments.get(
            fkey, proj.get("installments_amount", 0)
        )

    result["monthly_history"] = [
        {
            "month": k,
            "total": by_month[k]["total"],
            "count": by_month[k]["count"],
            "by_cat": dict(by_month[k]["by_cat"]),
        }
        for k in sorted_months
    ]
    result["future_installments"] = {k: v for k, v in future_installments.items()}

    return result
