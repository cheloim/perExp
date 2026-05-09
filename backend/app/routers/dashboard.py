import json
import os
import re
from calendar import monthrange
from collections import Counter, defaultdict
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Card, Category, Expense, User
from app.services.auth import get_current_user
from app.services.date_utils import add_months
from app.services.normalizers import _norm_bank, _norm_holder
from app.routers.groups import get_group_user_ids

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


def _apply_filters(q, month_val, search_val, person_val, cat_id_val, last4_val=None, bank_val=None):
    if month_val:
        try:
            if '-' in month_val:
                parts = month_val.split('-')
                if len(parts[0]) == 4:
                    y, m = int(parts[0]), int(parts[1])
                else:
                    m, y = int(parts[0]), int(parts[1])
            else:
                y, m = int(month_val[:4]), int(month_val[5:7])
            q = q.filter(Expense.date >= date(y, m, 1), Expense.date <= date(y, m, monthrange(y, m)[1]))
        except (ValueError, IndexError):
            pass
    if search_val:
        q = q.filter(Expense.description.ilike(f"%{search_val}%"))
    if person_val:
        q = q.filter(Expense.person.ilike(f"%{person_val}%"))
    if cat_id_val is not None:
        q = q.filter(Expense.category_id == cat_id_val)
    if last4_val:
        q = q.filter(Expense.card_last4 == last4_val)
    if bank_val:
        q = q.filter(Expense.bank.ilike(f"%{bank_val}%"))
    return q


@router.get("/summary")
def get_summary(
    month: Optional[str] = None,
    group_by: str = "month",
    search: Optional[str] = None,
    person: Optional[str] = None,
    category_id: Optional[int] = None,
    card_last4: Optional[str] = None,
    bank: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    uid_list = get_group_user_ids(current_user.id, db)
    base_q = db.query(Expense).filter(Expense.user_id.in_(uid_list))
    expenses = _apply_filters(base_q, month, search, person, category_id, card_last4, bank).order_by(desc(Expense.date)).all()
    categories = db.query(Category).all()
    cat_map = {c.id: c for c in categories}
    total = sum(e.amount for e in expenses)

    by_category: dict = {}
    for e in expenses:
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
        if cname not in by_category:
            by_category[cname] = {
                "category_id": cid, "category_name": cname, "category_color": ccolor,
                "parent_id": pid, "parent_name": pname, "parent_color": pcolor,
                "total": 0.0, "count": 0, "previous_total": 0.0,
            }
        by_category[cname]["total"] += e.amount
        by_category[cname]["count"] += 1

    if month:
        try:
            y, m = int(month[:4]), int(month[5:7])
            pm = m - 1 if m > 1 else 12
            py = y if m > 1 else y - 1
            prev_expenses = _apply_filters(base_q, f"{py}-{pm:02d}", search, None, category_id, card_last4, bank).all()
            for e in prev_expenses:
                cname = cat_map[e.category_id].name if e.category_id in cat_map else "Sin categoría"
                if cname in by_category:
                    by_category[cname]["previous_total"] += e.amount
        except (ValueError, IndexError):
            pass

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
        key = f"{e.card or ''}|{e.bank or ''}|{e.person or ''}"
        if key == "||":
            continue
        if key not in by_card:
            by_card[key] = {"card": e.card or "", "bank": e.bank or "", "person": e.person or "", "total": 0.0, "count": 0}
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
        return {
            "id": e.id, "date": e.date.isoformat(), "description": e.description,
            "amount": e.amount, "currency": e.currency or "ARS",
            "category_id": e.category_id,
            "category_name": cat.name if cat else None, "category_color": cat.color if cat else None,
            "card": e.card or "", "bank": e.bank or "", "person": e.person or "", "notes": e.notes or "",
        }

    today = date.today()
    six_months_ago = add_months(today, -6)

    hist_expenses = db.query(Expense).filter(Expense.user_id.in_(uid_list), Expense.date >= six_months_ago).all()
    trend_history: dict = {}
    for e in hist_expenses:
        k = e.date.strftime("%Y-%m")
        if k not in trend_history:
            trend_history[k] = {"month": k, "total": 0.0, "count": 0}
        trend_history[k]["total"] += e.amount
        trend_history[k]["count"] += 1

    installments_exp = db.query(Expense).filter(Expense.user_id.in_(uid_list), Expense.installment_group_id != None, Expense.installment_group_id != "").all()
    groups: dict = {}
    for e in installments_exp:
        if e.installment_group_id not in groups:
            groups[e.installment_group_id] = []
        groups[e.installment_group_id].append(e)

    trend_future: dict = {}
    for gid, exps in groups.items():
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
            if future_key not in trend_future:
                trend_future[future_key] = 0.0
            trend_future[future_key] += inst_amount

    return {
        "total_amount": total, "total_expenses": len(expenses),
        "by_category": sorted(by_category.values(), key=lambda x: x["total"], reverse=True),
        "by_period": sorted(by_period.values(), key=lambda x: x["period"]),
        "by_currency": sorted(by_currency.values(), key=lambda x: x["total"], reverse=True),
        "by_card": sorted(by_card.values(), key=lambda x: x["total"], reverse=True),
        "recent_expenses": [expense_to_dict(e) for e in expenses[:10]],
        "trend_data": {
            "history": sorted(trend_history.values(), key=lambda x: x["month"]),
            "future_installments": trend_future,
        },
    }


@router.get("/installments")
def get_installments_dashboard(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    uid_list = get_group_user_ids(current_user.id, db)
    exps = (
        db.query(Expense)
        .filter(Expense.user_id.in_(uid_list), Expense.installment_group_id != None, Expense.installment_group_id != "")
        .order_by(Expense.installment_number)
        .all()
    )
    cat_list = db.query(Category).all()
    cat_map_local = {c.id: c for c in cat_list}

    groups: dict = {}
    for e in exps:
        gid = e.installment_group_id
        if gid not in groups:
            groups[gid] = {
                "installment_group_id": gid,
                "description": e.description,
                "installment_total": e.installment_total or 0,
                "installments_paid": 0,
                "total_amount": 0.0,
                "installment_amount": abs(e.amount),
                "dates": [],
                "category_id": e.category_id,
                "category_name": cat_map_local[e.category_id].name if e.category_id and e.category_id in cat_map_local else None,
                "category_color": cat_map_local[e.category_id].color if e.category_id and e.category_id in cat_map_local else None,
                "bank": e.bank or "",
                "person": e.person or "",
                "currency": e.currency or "ARS",
                "card_last4": e.card_last4 or "",
                "card": e.card or "",
            }
        groups[gid]["installments_paid"] += 1
        groups[gid]["total_amount"] += e.amount
        groups[gid]["dates"].append(e.date)

    result = []
    for g in groups.values():
        paid = g["installments_paid"]
        total_inst = g["installment_total"]
        remaining = max(0, total_inst - paid)
        dates = sorted(g["dates"])
        next_date = add_months(max(dates), 1).isoformat() if remaining > 0 and dates else None
        result.append({
            "installment_group_id": g["installment_group_id"],
            "description": g["description"],
            "installment_total": total_inst,
            "installments_paid": paid,
            "remaining_installments": remaining,
            "total_amount": g["total_amount"],
            "installment_amount": g["installment_amount"],
            "next_date": next_date,
            "category_id": g["category_id"],
            "category_name": g["category_name"],
            "category_color": g["category_color"],
            "bank": g["bank"],
            "person": g["person"],
            "currency": g["currency"],
            "card_last4": g["card_last4"],
            "card": g["card"],
        })

    return sorted(result, key=lambda x: (x["remaining_installments"] == 0, x["next_date"] or "9999-99"))


@router.get("/installments/monthly-load")
def get_installments_monthly_load(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    today = date.today()
    current_month = today.strftime("%Y-%m")
    uid_list = [current_user.id]

    # Build window: 3 months back to 3 months forward
    window_start = add_months(today, -3)
    window_end = add_months(today, 3)
    window_start_key = window_start.strftime("%Y-%m")
    window_end_key = window_end.strftime("%Y-%m")

    # Initialize all 7 months in window with zeros
    monthly: dict = {}
    for offset in range(-3, 4):
        m = add_months(today, offset)
        key = m.strftime("%Y-%m")
        monthly[key] = {"month": key, "total": 0.0, "count": 0, "is_past": key < current_month, "is_current": key == current_month}

    exps = (
        db.query(Expense)
        .filter(Expense.user_id.in_(uid_list), Expense.installment_group_id != None, Expense.installment_group_id != "")
        .order_by(Expense.installment_number)
        .all()
    )

    # Past months: sum actual paid installments by their real date
    for e in exps:
        key = e.date.strftime("%Y-%m") if isinstance(e.date, date) else str(e.date)[:7]
        if key < current_month and key in monthly:
            monthly[key]["total"] += abs(e.amount)
            monthly[key]["count"] += 1

    # Future months: project remaining installments per group
    groups: dict = {}
    for e in exps:
        gid = e.installment_group_id
        if gid not in groups:
            groups[gid] = {"installment_total": e.installment_total or 0, "amount": abs(e.amount), "dates": []}
        groups[gid]["dates"].append(e.date)

    for g in groups.values():
        paid = len(g["dates"])
        remaining = max(0, g["installment_total"] - paid)
        if remaining == 0 or not g["dates"]:
            continue
        next_date = add_months(max(g["dates"]), 1)
        for i in range(remaining):
            charge_date = add_months(next_date, i)
            key = charge_date.strftime("%Y-%m")
            if key >= current_month and key in monthly:
                monthly[key]["total"] += g["amount"]
                monthly[key]["count"] += 1

    return sorted(monthly.values(), key=lambda x: x["month"])


@router.get("/top-merchants")
def get_top_merchants(
    month: Optional[str] = None,
    person: Optional[str] = None,
    bank: Optional[str] = None,
    card_last4: Optional[str] = None,
    limit: int = 20,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    uid_list = get_group_user_ids(current_user.id, db)
    q = db.query(Expense).filter(Expense.user_id.in_(uid_list))
    if month:
        try:
            y, m = int(month[:4]), int(month[5:7])
            q = q.filter(Expense.date >= date(y, m, 1), Expense.date <= date(y, m, monthrange(y, m)[1]))
        except (ValueError, IndexError):
            pass
    if person:
        q = q.filter(Expense.person.ilike(f"%{person}%"))
    if bank:
        q = q.filter(Expense.bank.ilike(f"%{bank}%"))
    if card_last4:
        q = q.filter(Expense.card_last4 == card_last4)

    expenses = q.filter(Expense.amount > 0).all()
    cat_list = db.query(Category).all()
    cat_map = {c.id: c for c in cat_list}

    groups: dict = {}
    for e in expenses:
        key = e.description.lower().strip()
        if key not in groups:
            groups[key] = {"description": e.description, "total": 0.0, "count": 0, "cats": []}
        groups[key]["total"] += e.amount
        groups[key]["count"] += 1
        if e.category_id:
            groups[key]["cats"].append(e.category_id)

    result = []
    for g in groups.values():
        top_cat_id = Counter(g["cats"]).most_common(1)[0][0] if g["cats"] else None
        cat = cat_map.get(top_cat_id) if top_cat_id else None
        result.append({
            "description": g["description"],
            "total_amount": round(g["total"], 2),
            "count": g["count"],
            "category_name": cat.name if cat else None,
            "category_color": cat.color if cat else None,
        })

    result.sort(key=lambda x: x["total_amount"], reverse=True)
    return result[:limit]


@router.get("/card-summary")
def get_card_summary(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    uid_list = get_group_user_ids(current_user.id, db)

    user_cards = {c.name: c.card_type for c in db.query(Card).filter(Card.user_id.in_(uid_list)).all()}
    def _card_network(card_str: str) -> str:
        s = (card_str or "").strip().lower()
        if "visa" in s:
            return "visa"
        if "mastercard" in s or "master card" in s:
            return "mastercard"
        if "amex" in s or "american express" in s:
            return "amex"
        return s or "unknown"

    exps = db.query(Expense).filter(Expense.user_id.in_(uid_list), Expense.amount > 0).all()

    by_card: dict = {}
    by_card_monthly: dict = {}

    for e in exps:
        bank = _norm_bank(e.bank)
        card_str = (e.card or "").strip()
        network = _card_network(card_str)
        holder = _norm_holder(e.person)
        last4 = (e.card_last4 or "").strip()
        if not last4:
            m4 = re.search(r'\d{4}$', card_str)
            last4 = m4.group() if m4 else ""
        key = f"{bank}|{network}|last4:{last4}" if last4 else f"{bank}|{network}|holder:{holder}"
        month_key = e.date.strftime('%Y-%m') if e.date else "1970-01"

        if key not in by_card:
            by_card[key] = {
                "bank": bank, "network": network,
                "card_names": {}, "holders": {}, "last4s": {},
                "total_amount": 0.0, "count": 0,
                "currency": e.currency or "ARS", "last_used": None,
            }
            by_card_monthly[key] = {}

        g = by_card[key]
        g["total_amount"] += e.amount
        g["count"] += 1
        g["card_names"][card_str] = g["card_names"].get(card_str, 0) + 1
        if holder:
            g["holders"][holder] = g["holders"].get(holder, 0) + 1
        if last4:
            g["last4s"][last4] = g["last4s"].get(last4, 0) + 1
        if not g["last_used"] or e.date > g["last_used"]:
            g["last_used"] = e.date
        by_card_monthly[key][month_key] = by_card_monthly[key].get(month_key, 0.0) + e.amount

    def _sig_tokens(name: str) -> set:
        return {re.sub(r'[^A-Z]', '', t) for t in name.upper().split()
                if len(re.sub(r'[^A-Z]', '', t)) >= 5}

    bank_net_map: dict = {}
    for key in list(by_card.keys()):
        if not key.split('|', 2)[2].startswith("holder:"):
            continue
        parts = key.split('|', 2)
        bn = f"{parts[0]}|{parts[1]}"
        bank_net_map.setdefault(bn, []).append(key)

    for bn, keys in bank_net_map.items():
        if len(keys) <= 1:
            continue
        parent = {k: k for k in keys}

        def find(k: str) -> str:
            while parent[k] != k:
                parent[k] = parent[parent[k]]
                k = parent[k]
            return k

        key_tokens = {}
        for k in keys:
            ts: set = set()
            for h in by_card[k]["holders"]:
                ts |= _sig_tokens(h)
            key_tokens[k] = ts

        for i, k1 in enumerate(keys):
            for k2 in keys[i + 1:]:
                if key_tokens[k1] & key_tokens[k2]:
                    r1, r2 = find(k1), find(k2)
                    if r1 != r2:
                        parent[r2] = r1

        groups: dict = {}
        for k in keys:
            groups.setdefault(find(k), []).append(k)

        for root, members in groups.items():
            for m in members:
                if m == root:
                    continue
                gr, gm = by_card[root], by_card[m]
                gr["total_amount"] += gm["total_amount"]
                gr["count"] += gm["count"]
                for cn, c in gm["card_names"].items():
                    gr["card_names"][cn] = gr["card_names"].get(cn, 0) + c
                for h, c in gm["holders"].items():
                    gr["holders"][h] = gr["holders"].get(h, 0) + c
                for l4, c in gm["last4s"].items():
                    gr["last4s"][l4] = gr["last4s"].get(l4, 0) + c
                if gm["last_used"] and (not gr["last_used"] or gm["last_used"] > gr["last_used"]):
                    gr["last_used"] = gm["last_used"]
                for mk, v in by_card_monthly.get(m, {}).items():
                    by_card_monthly[root][mk] = by_card_monthly[root].get(mk, 0.0) + v
                del by_card[m]
                del by_card_monthly[m]

    result = []
    for key, g in by_card.items():
        card_name = max(g["card_names"], key=lambda n: (g["card_names"][n], len(n))) if g["card_names"] else g["network"].title()
        holder = max(g["holders"], key=g["holders"].get) if g["holders"] else ""
        last4 = max(g["last4s"], key=g["last4s"].get) if g["last4s"] else ""

        monthly = by_card_monthly.get(key, {})
        months_list = sorted(monthly.keys(), reverse=True)[:12]
        monthly_data = [{"month": m, "total": monthly[m]} for m in reversed(months_list)]

        card_type = user_cards.get(card_name) or user_cards.get(g["network"].title()) or "credito"

        result.append({
            "holder": holder, "bank": g["bank"],
            "last4": last4, "card_name": card_name,
            "card_type": card_type,
            "total_amount": g["total_amount"], "count": g["count"],
            "currency": g["currency"],
            "last_used": g["last_used"].isoformat() if g["last_used"] else None,
            "monthly": monthly_data,
        })

    return sorted(result, key=lambda x: x["total_amount"], reverse=True)


@router.get("/card-category-breakdown")
def get_card_category_breakdown(
    month: Optional[str] = None,
    card_last4: Optional[str] = None,
    bank: Optional[str] = None,
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

    q = db.query(Expense).filter(Expense.user_id.in_(uid_list), Expense.amount > 0)
    if month:
        try:
            y, m_num = int(month[:4]), int(month[5:7])
            q = q.filter(
                Expense.date >= date(y, m_num, 1),
                Expense.date <= date(y, m_num, monthrange(y, m_num)[1]),
            )
        except (ValueError, IndexError):
            pass
    if card_last4:
        q = q.filter(Expense.card_last4 == card_last4)
    if bank:
        q = q.filter(Expense.bank.ilike(f"%{bank}%"))

    exps = q.all()
    cats_list = db.query(Category).all()
    cat_map = {c.id: c for c in cats_list}

    data: dict = {}
    cat_colors: dict = {}

    for e in exps:
        bank_norm = _norm_bank(e.bank) or "Efectivo"
        network = _card_network_local(e.card or "")
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
def get_category_trend(months: int = 4, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    uid_list = get_group_user_ids(current_user.id, db)
    today = date.today()
    month_keys = []
    for i in range(months - 1, -1, -1):
        m = today.month - i
        y = today.year
        while m <= 0:
            m += 12
            y -= 1
        month_keys.append(f"{y}-{m:02d}")

    cats_list = db.query(Category).all()
    cats_by_id = {c.id: c for c in cats_list}

    start = date.fromisoformat(f"{month_keys[0]}-01")
    exps = db.query(Expense).filter(Expense.user_id.in_(uid_list), Expense.amount > 0, Expense.date >= start).all()

    data: dict = {mk: {} for mk in month_keys}
    cat_colors: dict = {}
    for e in exps:
        if not e.date:
            continue
        mk = e.date.strftime('%Y-%m')
        if mk not in data:
            continue
        cat = cats_by_id.get(e.category_id) if e.category_id else None
        cat_name = cat.name if cat else "Sin categoría"
        cat_color = cat.color if cat else "#94a3b8"
        cat_colors[cat_name] = cat_color
        data[mk][cat_name] = data[mk].get(cat_name, 0.0) + e.amount

    rows = [{"month": mk, **data[mk]} for mk in month_keys]
    categories = [{"name": n, "color": c} for n, c in cat_colors.items()]
    return {"rows": rows, "categories": categories}


@router.get("/ai-trends")
async def get_ai_trends(
    month: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    uid_list = get_group_user_ids(current_user.id, db)
    from app.prompts import AI_TRENDS_PROMPT
    from google import genai
    from google.genai import types as genai_types

    api_key = os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise HTTPException(500, "GOOGLE_API_KEY no configurada.")

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
        cat_name = cat_map[e.category_id].name if e.category_id and e.category_id in cat_map else "Sin categoría"
        by_month[key]["by_cat"][cat_name] += e.amount

    installments_exp = (
        db.query(Expense)
        .filter(Expense.user_id.in_(uid_list), Expense.installment_group_id != None, Expense.installment_group_id != "")
        .all()
    )

    groups: dict = defaultdict(list)
    for e in installments_exp:
        groups[e.installment_group_id].append(e)

    future_installments: dict = defaultdict(float)
    for gid, exps in groups.items():
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
            f"{k}: ${v:,.0f}" for k, v in sorted(d["by_cat"].items(), key=lambda x: x[1], reverse=True)[:5]
        )
        monthly_lines.append(f"  {m_key}: total=${d['total']:,.0f} ({d['count']} transacciones) | {cat_breakdown}")

    future_lines = []
    for i in range(1, 4):
        fm = add_months(today, i)
        fkey = fm.strftime("%Y-%m")
        inst_amt = future_installments.get(fkey, 0.0)
        future_lines.append(f"  {fkey}: cuotas_pendientes=${inst_amt:,.0f}")

    filter_ctx = f"Mes en foco del usuario: {month}" if month else "Sin filtro de mes específico (usar todos los datos)"

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
        proj["installments_amount"] = future_installments.get(fkey, proj.get("installments_amount", 0))

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
