"""Dashboard breakdowns: merchants, cards, tags, categories (#566)."""

from __future__ import annotations

from calendar import monthrange
from collections import Counter
from datetime import date, timedelta

from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload, selectinload

from app.models import Card, Category, Expense, Tag, User
from app.services.access import scoped_user_ids
from app.services.aggregation import (
    ars_amount_expression,
    fallback_rate,
    spending_condition,
    to_ars,
)
from app.services.dashboard_shared import (
    card_network,
    category_map,
    get_card_info,
    load_cards_and_accounts,
)
from app.services.date_utils import add_months
from app.services.normalizers import normalize_bank


def top_merchants(
    month: str | None = None,
    person: str | None = None,
    bank: str | None = None,
    limit: int = 20,
    db: Session = None,
    current_user: User = None,
):
    """Top merchants by total spending with optional month/person/bank filters."""
    uid_list = scoped_user_ids(current_user, db)
    q = db.query(
        Expense.description,
        Expense.amount,
        Expense.category_id,
        Expense.currency,
        Expense.fx_rate,
    ).filter(Expense.user_id.in_(uid_list), Expense.amount > 0, Expense.is_income == False)
    if month:
        try:
            y, m = int(month[:4]), int(month[5:7])
            q = q.filter(
                Expense.date >= date(y, m, 1), Expense.date <= date(y, m, monthrange(y, m)[1])
            )
        except (ValueError, IndexError):
            pass
    else:
        q = q.filter(Expense.date >= add_months(date.today(), -24))
    if person or bank:
        all_cards = db.query(Card).filter(Card.user_id.in_(uid_list)).all()
        if person:
            matching_ids = [c.id for c in all_cards if person.lower() in (c.holder or "").lower()]
            q = q.filter(Expense.card_id.in_(matching_ids))
        if bank:
            matching_ids = [c.id for c in all_cards if bank.lower() in (c.bank or "").lower()]
            q = q.filter(Expense.card_id.in_(matching_ids))

    rows = q.all()

    fallback = fallback_rate(db)
    groups: dict = {}
    for description, amount, cat_id, currency, fx_rate in rows:
        currency = currency or "ARS"
        key = (description.lower().strip(), currency)
        if key not in groups:
            groups[key] = {
                "description": description,
                "currency": currency,
                "total": 0.0,
                "converted": 0.0,
                "count": 0,
                "cats": [],
            }
        groups[key]["total"] += amount
        rate = fx_rate or (fallback or {}).get("rate")
        groups[key]["converted"] += amount if currency == "ARS" else amount * float(rate or 0)
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
    for g in sorted(groups.values(), key=lambda g: g["converted"], reverse=True)[:limit]:
        top_cat_id = Counter(g["cats"]).most_common(1)[0][0] if g["cats"] else None
        cat = cat_map.get(top_cat_id) if top_cat_id else None
        result.append(
            {
                "description": g["description"],
                "total_amount": round(g["total"], 2),
                "currency": g["currency"],
                "count": g["count"],
                "category_name": cat.name if cat else None,
                "category_color": cat.color if cat else None,
            }
        )

    return result


def card_summary(db: Session = None, current_user: User = None):
    """Spending summary per card and account for the last 12 months."""
    uid_list = scoped_user_ids(current_user, db)

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

    cards_by_id, user_accounts_by_id = load_cards_and_accounts(uid_list, exps, db)

    # Build account_id → card_id mapping for linked debit cards
    account_to_card: dict[int, int] = {}
    card_linked_account: dict[int, dict] = {}  # card_id → {account_id, account_name}
    for c in cards_by_id.values():
        if c.linked_account_id:
            account_to_card[c.linked_account_id] = c.id
            acct_info = user_accounts_by_id.get(c.linked_account_id)
            if acct_info:
                card_linked_account[c.id] = {
                    "account_id": c.linked_account_id,
                    "account_name": acct_info["name"],
                }

    # Group by card_id (primary) or account_id (fallback)
    by_card: dict = {}
    by_card_monthly: dict = {}
    fallback = fallback_rate(db)

    for e in exps:
        month_key = e.date.strftime("%Y-%m") if e.date else "1970-01"

        # Determine grouping key: card takes priority, then linked account, then standalone account
        if e.card_id and e.card_id in cards_by_id:
            key = f"card:{e.card_id}"
        elif e.account_id and e.account_id in account_to_card:
            # Account is linked to a debit card — merge into that card's entry
            key = f"card:{account_to_card[e.account_id]}"
        elif e.account_id:
            key = f"account:{e.account_id}"
        else:
            continue  # Skip expenses without card or account

        if key not in by_card:
            if key.startswith("card:"):
                c = cards_by_id[int(key.split(":")[1])]
                linked = card_linked_account.get(c.id)
                by_card[key] = {
                    "bank": c.bank or "",
                    "network": card_network(c.card_name),
                    "card_name": c.card_name,
                    "holder": c.holder or "",
                    "card_type": c.card_type,
                    "total_amount": 0.0,
                    "count": 0,
                    "currency": "ARS",
                    "last_used": None,
                    "card_ids": {c.id: 1},
                    "account_ids": {},
                    "linked_account_name": linked["account_name"] if linked else None,
                }
                # Pre-populate account_ids if card has a linked account
                if linked:
                    by_card[key]["account_ids"][linked["account_id"]] = 0
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
                    "currency": "ARS",
                    "last_used": None,
                    "card_ids": {},
                    "account_ids": {acct_id: 1},
                    "linked_account_name": None,
                }
            by_card_monthly[key] = {}

        g = by_card[key]
        amount_ars = to_ars(e, fallback)
        g["total_amount"] += amount_ars
        g["count"] += 1
        if not g["last_used"] or e.date > g["last_used"]:
            g["last_used"] = e.date
        if e.card_id:
            g["card_ids"][e.card_id] = g["card_ids"].get(e.card_id, 0) + 1
        if e.account_id:
            g["account_ids"][e.account_id] = g["account_ids"].get(e.account_id, 0) + 1
        by_card_monthly[key][month_key] = by_card_monthly[key].get(month_key, 0.0) + amount_ars

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
                "linked_account_name": g.get("linked_account_name"),
                "total_amount": g["total_amount"],
                "count": g["count"],
                "currency": g["currency"],
                "last_used": g["last_used"].isoformat() if g["last_used"] else None,
                "monthly": monthly_data,
            }
        )

    return sorted(result, key=lambda x: x["total_amount"], reverse=True)


def tag_summary(groups: str | None = None, db: Session = None, current_user: User = None):
    """Spending summary per tag for the last 12 months, including monthly breakdowns."""
    uid_list = scoped_user_ids(current_user, db)

    allowed_groups = None
    if groups:
        allowed_groups = {g.strip() for g in groups.split(",") if g.strip()}

    all_tags = db.query(Tag).filter(Tag.user_id.in_(uid_list)).all()
    if allowed_groups:
        tags = [
            t for t in all_tags if t.group_name in allowed_groups and t.group_name != "categoria"
        ]
    else:
        tags = [t for t in all_tags if t.group_name != "categoria"]
    tags_by_id = {t.id: t for t in tags}
    allowed_tag_ids = set(tags_by_id.keys())

    cutoff = date.today() - timedelta(days=365)
    exps = (
        db.query(Expense)
        .options(selectinload(Expense.tags))
        .filter(
            Expense.user_id.in_(uid_list),
            Expense.amount > 0,
            Expense.date >= cutoff,
        )
        .all()
    )

    by_tag: dict = {}
    by_tag_monthly: dict = {}
    fallback = fallback_rate(db)

    for e in exps:
        month_key = e.date.strftime("%Y-%m") if e.date else "1970-01"

        matching = [t for t in (e.tags or []) if t.id in allowed_tag_ids]
        if matching:
            first_tag = min(matching, key=lambda t: t.id)
            key = f"tag:{first_tag.id}"
        else:
            key = "tag:null"

        if key not in by_tag:
            if key == "tag:null":
                label = "Sin cuenta" if allowed_groups and "cuenta" in allowed_groups else "Sin tag"
                by_tag[key] = {
                    "tag_id": None,
                    "tag_name": label,
                    "tag_color": "#94a3b8",
                    "group_name": None,
                    "total_amount": 0.0,
                    "count": 0,
                    "currency": "ARS",
                    "last_used": None,
                }
            else:
                tid = int(key.split(":")[1])
                t = tags_by_id[tid]
                by_tag[key] = {
                    "tag_id": t.id,
                    "tag_name": t.name,
                    "tag_color": t.color or "#6366f1",
                    "group_name": t.group_name,
                    "total_amount": 0.0,
                    "count": 0,
                    "currency": "ARS",
                    "last_used": None,
                }
            by_tag_monthly[key] = {}

        g = by_tag[key]
        amount_ars = to_ars(e, fallback)
        g["total_amount"] += amount_ars
        g["count"] += 1
        if not g["last_used"] or e.date > g["last_used"]:
            g["last_used"] = e.date
        by_tag_monthly[key][month_key] = by_tag_monthly[key].get(month_key, 0.0) + amount_ars

    if "tag:null" not in by_tag:
        null_label = "Sin cuenta" if allowed_groups and "cuenta" in allowed_groups else "Sin tag"
        by_tag["tag:null"] = {
            "tag_id": None,
            "tag_name": null_label,
            "tag_color": "#94a3b8",
            "group_name": None,
            "total_amount": 0.0,
            "count": 0,
            "currency": "ARS",
            "last_used": None,
        }
        by_tag_monthly["tag:null"] = {}

    result = []
    for key, g in by_tag.items():
        monthly = by_tag_monthly.get(key, {})
        months_list = sorted(monthly.keys(), reverse=True)[:12]
        monthly_data = [{"month": m, "total": monthly[m]} for m in reversed(months_list)]

        result.append(
            {
                "tag_id": g["tag_id"],
                "tag_name": g["tag_name"],
                "tag_color": g["tag_color"],
                "group_name": g.get("group_name"),
                "total_amount": g["total_amount"],
                "count": g["count"],
                "currency": g["currency"],
                "last_used": g["last_used"].isoformat() if g["last_used"] else None,
                "monthly": monthly_data,
            }
        )

    return sorted(result, key=lambda x: x["total_amount"], reverse=True)


def card_category_breakdown(
    month: str | None = None,
    bank: str | None = None,
    db: Session = None,
    current_user: User = None,
):
    """Matrix of spending by card and category, useful for stacked bar charts."""
    uid_list = scoped_user_ids(current_user, db)

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
    else:
        q = q.filter(Expense.date >= add_months(date.today(), -24))
    if bank:
        all_cards = db.query(Card).filter(Card.user_id.in_(uid_list)).all()
        matching_ids = [c.id for c in all_cards if bank.lower() in (c.bank or "").lower()]
        q = q.filter(Expense.card_id.in_(matching_ids))

    exps = q.all()
    cards_by_id, _ = load_cards_and_accounts(uid_list, exps, db)
    cat_map = category_map(uid_list, db)

    data: dict = {}
    cat_colors: dict = {}

    for e in exps:
        card_name, card_bank, holder = get_card_info(e, cards_by_id)
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


def category_trend(
    months: int = 4,
    anchor_month: str | None = None,
    person: str | None = None,
    db: Session = None,
    current_user: User = None,
):
    """Monthly spending trend per category over a configurable number of months."""
    uid_list = scoped_user_ids(current_user, db)
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
    converted = ars_amount_expression(db, uid_list)

    rows_raw = (
        db.query(
            func.to_char(Expense.date, "YYYY-MM").label("month"),
            func.coalesce(Category.name, "Sin categoría").label("cat_name"),
            func.coalesce(Category.color, "#94a3b8").label("cat_color"),
            func.sum(converted).label("total"),
        )
        .outerjoin(Category, Expense.category_id == Category.id)
        .filter(
            Expense.user_id.in_(uid_list),
            Expense.amount > 0,
            spending_condition(),
            Expense.date >= start,
        )
    )
    if person:
        all_cards = db.query(Card).filter(Card.user_id.in_(uid_list)).all()
        matching_ids = [c.id for c in all_cards if person.lower() in (c.holder or "").lower()]
        rows_raw = rows_raw.filter(Expense.card_id.in_(matching_ids))
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
