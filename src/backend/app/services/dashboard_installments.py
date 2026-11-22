"""Installment, scheduled-expense and credit-card liability aggregation (#566)."""

from __future__ import annotations

from calendar import monthrange
from datetime import date, timedelta

from sqlalchemy.orm import Session, joinedload

from app.models import Card, Expense, ScheduledExpense, User
from app.services.access import scoped_user_ids
from app.services.aggregation import fallback_rate
from app.services.dashboard_shared import category_map, get_card_info, load_cards_and_accounts
from app.services.date_utils import add_months


def installments_overview(db: Session = None, current_user: User = None):
    """All installment groups with paid/remaining counts and the next payment date."""
    uid_list = scoped_user_ids(current_user, db)
    today = date.today()

    # Cuotas realizadas (expenses). 18 months covers any realistic plan and
    # keeps the endpoint from loading the complete history.
    paid_exps = (
        db.query(Expense)
        .options(joinedload(Expense.card_rel))
        .filter(
            Expense.user_id.in_(uid_list),
            Expense.installment_group_id != None,
            Expense.installment_group_id != "",
            Expense.date >= add_months(today, -18),
        )
        .all()
    )

    # Cuotas programadas (scheduled_expenses)
    scheduled_exps = (
        db.query(ScheduledExpense)
        .filter(ScheduledExpense.user_id.in_(uid_list), ScheduledExpense.status == "PENDING")
        .all()
    )

    cards_by_id, _ = load_cards_and_accounts(uid_list, paid_exps, db)

    cat_map = category_map(uid_list, db)
    groups: dict = {}

    # Procesar cuotas pagadas
    for e in paid_exps:
        gid = e.installment_group_id
        card_name, card_bank, holder = get_card_info(e, cards_by_id)
        if gid not in groups:
            groups[gid] = {
                "installment_group_id": gid,
                "description": e.description,
                "installment_total": e.installment_total or 0,
                "installments_paid": 0,
                "last_paid_number": 0,
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
        groups[gid]["last_paid_number"] = max(
            groups[gid]["last_paid_number"], e.installment_number or 0
        )
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
                "last_paid_number": 0,
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

        # A manual "cuota 3 de 12" only records the current installment, so the
        # elapsed count comes from the highest installment number, not the row
        # count (which is only complete after a statement backfill).
        remaining = max(0, g["installment_total"] - g["last_paid_number"])

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


def installments_monthly_load(db: Session = None, current_user: User = None):
    """7-month window (3 past, current, 3 future) of installment payment load."""
    today = date.today()
    current_month = today.strftime("%Y-%m")
    uid_list = scoped_user_ids(current_user, db)

    # Initialize all 7 months in window with zeros (3 past, current, 3 future)
    monthly: dict = {}
    for offset in range(-3, 4):
        m = add_months(today, offset)
        key = m.strftime("%Y-%m")
        monthly[key] = {
            "month": key,
            "total": 0.0,
            "by_currency": {},
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

    fallback = fallback_rate(db)

    def _ars_amount(amount: float, currency: str | None) -> float:
        if (currency or "ARS") == "ARS":
            return abs(float(amount))
        rate = (fallback or {}).get("rate")
        return abs(float(amount)) * float(rate) if rate else 0.0

    # Sum ALL installment expenses by their real date
    for e in exps:
        key = e.date.strftime("%Y-%m") if isinstance(e.date, date) else str(e.date)[:7]
        if key in monthly:
            currency = e.currency or "ARS"
            monthly[key]["total"] += _ars_amount(e.amount, currency)
            monthly[key]["by_currency"][currency] = monthly[key]["by_currency"].get(
                currency, 0.0
            ) + abs(e.amount)
            monthly[key]["count"] += 1

    # Future months: project remaining installments per group
    # Load scheduled expenses to add their amounts directly
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
            currency = se.currency or "ARS"
            monthly[smonth]["total"] += _ars_amount(se.amount, currency)
            monthly[smonth]["by_currency"][currency] = monthly[smonth]["by_currency"].get(
                currency, 0.0
            ) + abs(se.amount)
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
                "currency": e.currency or "ARS",
                "paid": [],
            }
        groups[gid]["paid"].append((e.installment_number or 0, e.date))

    # Project remaining installments for ALL groups with unpaid balance
    for gid, g in groups.items():
        last_paid = max((number for number, _ in g["paid"]), default=0)
        remaining = max(0, g["installment_total"] - last_paid)
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
                currency = g["currency"]
                monthly[key]["total"] += _ars_amount(g["amount"], currency)
                monthly[key]["by_currency"][currency] = (
                    monthly[key]["by_currency"].get(currency, 0.0) + g["amount"]
                )
                monthly[key]["count"] += 1

    return sorted(monthly.values(), key=lambda x: x["month"])


def scheduled_summary(db: Session = None, current_user: User = None):
    """Pending installments and manual scheduled expenses for the next 3 months."""
    uid_list = scoped_user_ids(current_user, db)
    today = date.today()
    current_month_start = date(today.year, today.month, 1)
    # Show 3 months forward from current month
    future = add_months(today, 3)
    future_end = date(future.year, future.month, monthrange(future.year, future.month)[1])

    cat_map = category_map(uid_list, db)

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


def credit_card_pasivos(db: Session = None, current_user: User = None):
    """Pending credit card liabilities from scheduled expenses and projections."""
    uid_list = scoped_user_ids(current_user, db)

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
        # Always track group to prevent Expense projection double-counting
        scheduled_gids.add(s.installment_group_id)

        # Count ALL pending scheduled expenses with installments (not just credit cards)
        if not s.installment_group_id:
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
        last_paid = max(g["paid"], default=0)
        remaining = max(0, g["installment_total"] - last_paid)
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
                        "description", f"Cuota {last_paid + i + 1}/{g['installment_total']}"
                    ),
                    "amount": g["amount"],
                    "currency": "ARS",
                    "scheduled_date": None,
                    "installment_number": last_paid + i + 1,
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
