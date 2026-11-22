"""Dashboard summary and account expense aggregation (#566).

Pure data-shaping moved out of the HTTP router. Queries and response keys are
unchanged; ``app.services.aggregation`` remains the single definition of
spending and FX conversion.
"""

from __future__ import annotations

from calendar import monthrange
from datetime import date

from sqlalchemy import desc
from sqlalchemy.orm import Session, joinedload

from app.models import Card, Category, Expense, ExpenseTag, Tag, User
from app.services.access import scoped_user_ids
from app.services.aggregation import (
    fallback_rate,
    spending_breakdown_from_expenses,
    spending_condition,
    to_ars,
)
from app.services.dashboard_shared import (
    apply_filters,
    category_map,
    get_card_info,
    load_cards_and_accounts,
)
from app.services.date_utils import add_months


def compute_summary(
    month: str | None = None,
    group_by: str = "month",
    person: str | None = None,
    category_id: int | None = None,
    bank: str | None = None,
    db: Session = None,
    current_user: User = None,
    as_of: date | None = None,
):
    uid_list = scoped_user_ids(current_user, db)
    today = as_of or date.today()

    base_q = (
        db.query(Expense)
        .options(joinedload(Expense.card_rel))
        .filter(Expense.user_id.in_(uid_list))
    )
    # "All time" still has a floor: the dashboard never needs the complete
    # history to render, and an unbounded scan grows with the account.
    if not month:
        base_q = base_q.filter(Expense.date >= add_months(today, -24))
    expenses = (
        apply_filters(base_q, month, person, category_id, bank, uid_list, db)
        .order_by(desc(Expense.date))
        .all()
    )
    cards_by_id, _ = load_cards_and_accounts(uid_list, expenses, db)
    categories = db.query(Category).filter(Category.user_id.in_(uid_list)).all()
    # Include parent categories that may belong to another group member
    parent_ids = {c.parent_id for c in categories if c.parent_id}
    if parent_ids:
        categories += db.query(Category).filter(Category.id.in_(parent_ids)).all()
    cat_map = {c.id: c for c in categories}
    spending_expenses = [e for e in expenses if not e.is_income]
    needs_fallback = any(
        (e.currency or "ARS") != "ARS" and e.fx_rate is None for e in spending_expenses
    )
    fallback = fallback_rate(db) if needs_fallback else None
    breakdown = spending_breakdown_from_expenses(spending_expenses, fallback=fallback)
    total = breakdown.converted_total

    # Calcular total_by_account (excluir gastos con tarjetas de credito)
    credit_cards = (
        db.query(Card).filter(Card.user_id.in_(uid_list), Card.card_type == "credito").all()
    )
    credit_card_ids = {c.id for c in credit_cards}

    tag_credit_expense_ids = set()
    if credit_card_ids:
        tag_credit_expense_ids = set(
            row[0]
            for row in db.query(ExpenseTag.expense_id)
            .join(Tag, Tag.id == ExpenseTag.tag_id)
            .filter(Tag.card_id.in_(credit_card_ids))
            .distinct()
            .all()
        )

    def is_credit_card_expense(e: Expense) -> bool:
        if e.card_id is not None and e.card_id in credit_card_ids:
            return True
        return e.id in tag_credit_expense_ids

    account_expenses = [e for e in expenses if not is_credit_card_expense(e) and not e.is_income]
    total_by_account = spending_breakdown_from_expenses(
        account_expenses, fallback=fallback
    ).converted_total

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
                "previous_mtd_total": 0.0,
            }
        by_category[cat_key]["total"] += to_ars(e, fallback)
        by_category[cat_key]["count"] += 1

    is_current_month = False
    mtd_cutoff: int | None = None
    prev_expenses: list = []
    if month:
        try:
            y, m = int(month[:4]), int(month[5:7])
            pm = m - 1 if m > 1 else 12
            py = y if m > 1 else y - 1
            # Issue #393: when viewing the current month, compare against the
            # previous month cut at the same day (MTD). Full-vs-full would make
            # any in-progress month look artificially low.
            is_current_month = f"{y}-{m:02d}" == today.strftime("%Y-%m")
            mtd_cutoff = min(today.day, monthrange(py, pm)[1]) if is_current_month else None
            prev_expenses = apply_filters(
                base_q, f"{py}-{pm:02d}", person, category_id, bank, uid_list, db
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
                            "previous_mtd_total": 0.0,
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
                            "previous_mtd_total": 0.0,
                        }
                by_category[prev_cat_key].setdefault("previous_mtd_total", 0.0)
                previous_amount = to_ars(e, fallback)
                by_category[prev_cat_key]["previous_total"] += previous_amount
                if mtd_cutoff is None or e.date.day <= mtd_cutoff:
                    by_category[prev_cat_key]["previous_mtd_total"] += previous_amount
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
        by_income[cname]["total"] += to_ars(e, fallback)
        by_income[cname]["count"] += 1

    by_period: dict = {}
    for e in expenses:
        if e.is_income:
            continue
        if group_by == "week":
            key = e.date.strftime("%G-W%V")
        elif group_by == "year":
            key = e.date.strftime("%Y")
        else:
            key = e.date.strftime("%Y-%m")
        if key not in by_period:
            by_period[key] = {"period": key, "total": 0.0, "count": 0}
        by_period[key]["total"] += to_ars(e, fallback)
        by_period[key]["count"] += 1

    by_card: dict = {}
    for e in expenses:
        if e.is_income:
            continue
        card_name, card_bank, holder = get_card_info(e, cards_by_id)
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
        by_card[key]["total"] += to_ars(e, fallback)
        by_card[key]["count"] += 1

    by_currency: dict = {}
    for e in expenses:
        if e.is_income:
            continue
        cur = e.currency or "ARS"
        if cur not in by_currency:
            by_currency[cur] = {
                "currency": cur,
                "total": 0.0,
                "count": 0,
                "previous_total": 0.0,
                "previous_mtd_total": 0.0,
            }
        by_currency[cur]["total"] += e.amount
        by_currency[cur]["count"] += 1

    # Issue #393 (item 3): previous spending per currency, so the frontend can
    # compare ARS vs ARS instead of ARS vs a mixed-currency total.
    # Same expense-only rule as per-category previous_total.
    for e in prev_expenses:
        if e.is_income:
            continue
        cur = e.currency or "ARS"
        if cur not in by_currency:
            by_currency[cur] = {
                "currency": cur,
                "total": 0.0,
                "count": 0,
                "previous_total": 0.0,
                "previous_mtd_total": 0.0,
            }
        by_currency[cur]["previous_total"] += e.amount
        if mtd_cutoff is None or e.date.day <= mtd_cutoff:
            by_currency[cur]["previous_mtd_total"] += e.amount

    def expense_to_dict(e: Expense) -> dict:
        cat = cat_map.get(e.category_id) if e.category_id else None
        card_name, card_bank, holder = get_card_info(e, cards_by_id)
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

    six_months_ago = add_months(today, -6)

    hist_expenses = (
        db.query(Expense)
        .filter(
            Expense.user_id.in_(uid_list),
            Expense.date >= six_months_ago,
            spending_condition(),
        )
        .all()
    )
    trend_history: dict = {}
    for e in hist_expenses:
        k = e.date.strftime("%Y-%m")
        if k not in trend_history:
            trend_history[k] = {"month": k, "total": 0.0, "count": 0}
        trend_history[k]["total"] += to_ars(e, fallback)
        trend_history[k]["count"] += 1

    installments_exp = (
        db.query(Expense)
        .filter(
            Expense.user_id.in_(uid_list),
            Expense.installment_group_id != None,
            Expense.installment_group_id != "",
            Expense.date >= add_months(today, -18),
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
        inst_amount = abs(to_ars(last_exp, fallback))
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
        "fx_rate": breakdown.rate,
        "fx_rate_date": breakdown.rate_date.isoformat() if breakdown.rate_date else None,
        "fx_rate_source": breakdown.rate_source,
        "fx_missing": breakdown.missing_fx,
        "total_expenses": sum(1 for e in expenses if not e.is_income),
        "previous_total": sum(c.get("previous_total", 0.0) for c in by_category.values()),
        "previous_mtd_total": sum(c.get("previous_mtd_total", 0.0) for c in by_category.values()),
        "is_current_month": is_current_month,
        "mtd_cutoff_day": mtd_cutoff,
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


def account_expenses(
    month: str | None = None,
    db: Session = None,
    current_user: User = None,
):
    """Expenses excluding credit card transactions (debit/transfer/cash only)."""
    uid_list = scoped_user_ids(current_user, db)
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
    else:
        base_q = base_q.filter(Expense.date >= add_months(date.today(), -24))

    expenses = base_q.order_by(Expense.date).all()
    cards_by_id, _ = load_cards_and_accounts(uid_list, expenses, db)

    credit_card_ids = {cid for cid, c in cards_by_id.items() if c.card_type == "credito"}

    tag_credit_expense_ids = set()
    if credit_card_ids:
        tag_credit_expense_ids = set(
            row[0]
            for row in db.query(ExpenseTag.expense_id)
            .join(Tag, Tag.id == ExpenseTag.tag_id)
            .filter(Tag.card_id.in_(credit_card_ids))
            .distinct()
            .all()
        )

    def is_credit_card_expense(e: Expense) -> bool:
        if e.card_id is not None and e.card_id in credit_card_ids:
            return True
        return e.id in tag_credit_expense_ids

    cat_map = category_map(uid_list, db)

    result = []
    for e in expenses:
        if is_credit_card_expense(e):
            continue
        # Skip income
        if e.is_income:
            continue
        cat = cat_map.get(e.category_id) if e.category_id else None
        card_name, card_bank, holder = get_card_info(e, cards_by_id)
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
