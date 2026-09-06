"""Pure functions for building Telegram bot report data.

All functions take (user_id, db) and return plain dicts/dataclasses.
Group-aware: includes accepted family group members' data.
"""

import json
import os
from calendar import monthrange
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Literal
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app.models import (
    Budget,
    BudgetEvent,
    BudgetGroup,
    Card,
    Category,
    Expense,
    RecurringExpense,
    ScheduledExpense,
)
from app.services.budget_helpers import (
    get_group_user_ids,
    get_spending_for_category,
    get_spending_for_group,
)

BUE = ZoneInfo("America/Argentina/Buenos_Aires")
BUDGET_AHORRO_ENABLED = os.getenv("BUDGET_AHORRO_ENABLED", "false").lower() == "true"


# ── Status indicators ────────────────────────────────────────────────
STATUS_EMOJI = {"exceeded": "🔴", "warning": "🟡", "ok": "🟢", "no_budget": "⚪"}


def _status_emoji(status: str) -> str:
    return STATUS_EMOJI.get(status, "⚪")


# ── Data classes ─────────────────────────────────────────────────────


@dataclass
class BudgetCategoryRow:
    name: str
    budget: float
    spent: float
    pct: float
    status: str
    is_child: bool = False


@dataclass
class BudgetGroupRow:
    display_name: str
    amount: float
    spent: float
    pct: float
    status: str


@dataclass
class BudgetStatusReport:
    month: str
    total_budget: float
    total_spent: float
    total_pct: float
    groups: list[BudgetGroupRow]
    flagged: list[BudgetCategoryRow]


@dataclass
class CategorySummary:
    name: str
    emoji: str
    total: float


@dataclass
class ExpenseItem:
    description: str
    amount: float
    date: str
    category: str
    emoji: str


@dataclass
class PeriodSummaryReport:
    label: str
    total: float
    income: float
    net: float
    top_categories: list[CategorySummary]
    expenses: list[ExpenseItem]
    count: int


@dataclass
class ScheduledItem:
    description: str
    amount: float
    day: str
    card: str
    is_installment: bool
    installment_label: str


@dataclass
class ScheduledWeek:
    label: str
    items: list[ScheduledItem]
    total: float


@dataclass
class UpcomingScheduledReport:
    weeks: list[ScheduledWeek]
    total: float
    count: int


@dataclass
class RecurringItem:
    description: str
    amount: float
    next_date: str
    days_until: int
    frequency: str


@dataclass
class UpcomingRecurringReport:
    items: list[RecurringItem]
    total: float
    count: int


# ── Week range helpers ───────────────────────────────────────────────


def _current_week_range() -> tuple[date, date]:
    today = datetime.now(BUE).date()
    start = today - timedelta(days=today.weekday() + 7)
    end = start + timedelta(days=6)
    return start, end


def _current_month_range() -> tuple[date, date]:
    today = datetime.now(BUE).date()
    start = date(today.year, today.month, 1)
    end = date(today.year, today.month, monthrange(today.year, today.month)[1])
    return start, end


# ── Category emoji (matches telegram_bot.py) ────────────────────────

_CAT_EMOJI: dict[str, str] = {
    "salud": "🏥",
    "alimentación": "🍽️",
    "alimentos": "🍽️",
    "supermercado": "🛒",
    "transporte": "🚗",
    "servicios": "⚡",
    "entretenimiento": "🎬",
    "educación": "📚",
    "ropa": "👕",
    "indumentaria": "👕",
    "viajes": "✈️",
    "hogar": "🏠",
    "tecnología": "💻",
    "mascotas": "🐾",
    "deporte": "🏋️",
    "inversiones": "📈",
    "impuestos": "🧾",
    "seguros": "🛡️",
    "banco": "🏦",
    "suscripciones": "📲",
    "farmacia": "💊",
    "médico": "🩺",
    "taxi": "🚕",
    "uber": "🚕",
    "combustible": "⛽",
    "nafta": "⛽",
    "restaurante": "🍴",
    "café": "☕",
    "bar": "🍺",
    "fast food": "🍔",
    "netflix": "📺",
    "spotify": "🎵",
    "streaming": "📺",
    "gimnasio": "🏋️",
    "librería": "📖",
    "colegio": "🏫",
    "universidad": "🎓",
    "luz": "💡",
    "gas": "🔥",
    "agua": "💧",
    "internet": "🌐",
    "celular": "📱",
    "supermercados": "🛒",
    "almacén": "🛒",
    "verdulería": "🥦",
}


def _cat_emoji(name: str) -> str:
    return _CAT_EMOJI.get(name.lower().strip(), "📂")


# ── 1. Budget status report ──────────────────────────────────────────


def build_budget_status(user_id: int, db: Session) -> BudgetStatusReport:
    """Build budget vs spending status for the current month, group-aware."""
    today = datetime.now(BUE).date()
    y, m = today.year, today.month
    uid_list = get_group_user_ids(user_id, db)
    month_label = f"{y}-{m:02d}"

    # ── Per-category flagged items (budgets with ≥threshold usage) ──
    budgets = db.query(Budget).filter(Budget.user_id == user_id, Budget.is_active == True).all()

    flagged: list[BudgetCategoryRow] = []
    for b in budgets:
        spent = get_spending_for_category(b.category_id, y, m, uid_list, db)
        pct = round((spent / b.amount * 100) if b.amount > 0 else 0, 1)
        threshold = b.alert_threshold * 100
        if pct >= threshold:
            cat = db.query(Category).filter(Category.id == b.category_id).first()
            status = "exceeded" if pct >= 100 else "warning"
            flagged.append(
                BudgetCategoryRow(
                    name=cat.name if cat else "Sin categoría",
                    budget=b.amount,
                    spent=round(spent, 2),
                    pct=pct,
                    status=status,
                )
            )
    flagged.sort(key=lambda x: x.pct, reverse=True)

    # ── Macro groups (50/30/20 or 60/40) ──
    groups = (
        db.query(BudgetGroup)
        .filter(BudgetGroup.user_id == user_id, BudgetGroup.is_active == True)
        .all()
    )
    if not BUDGET_AHORRO_ENABLED:
        groups = [g for g in groups if g.name != "ahorro"]

    group_rows: list[BudgetGroupRow] = []
    for g in groups:
        spent = get_spending_for_group(g.name, y, m, uid_list, db)
        pct = round((spent / g.amount * 100) if g.amount > 0 else 0, 1)
        status = "exceeded" if pct >= 100 else "warning" if pct >= 80 else "ok"
        group_rows.append(
            BudgetGroupRow(
                display_name=g.display_name,
                amount=g.amount,
                spent=round(spent, 2),
                pct=pct,
                status=status,
            )
        )

    total_budget = sum(g.amount for g in groups) if groups else 0
    total_spent = sum(g.spent for g in group_rows) if group_rows else 0
    total_pct = round((total_spent / total_budget * 100) if total_budget > 0 else 0, 1)

    return BudgetStatusReport(
        month=month_label,
        total_budget=total_budget,
        total_spent=round(total_spent, 2),
        total_pct=total_pct,
        groups=group_rows,
        flagged=flagged,
    )


# ── 2. Period summary (week | month) ────────────────────────────────


def _get_category_name(cat_id: int | None, db: Session) -> str:
    if not cat_id:
        return "Sin categoría"
    cat = db.query(Category).filter(Category.id == cat_id).first()
    if not cat:
        return "Sin categoría"
    if cat.parent_id:
        parent = db.query(Category).filter(Category.id == cat.parent_id).first()
        if parent:
            return f"{parent.name} > {cat.name}"
    return cat.name


def build_period_summary(
    user_id: int,
    uid_list: list[int],
    period: Literal["week", "month"],
    db: Session,
) -> PeriodSummaryReport:
    """Build expense+income summary for a period.

    Week: totals + last 10 expenses (chronological, most recent first).
    Month: totals + top 10 expenses (by amount).
    """
    if period == "week":
        start, end = _current_week_range()
        label_start = start.strftime("%d/%m")
        label_end = end.strftime("%d/%m")
        label = f"Semana {label_start} – {label_end}"
    else:
        start, end = _current_month_range()
        label = start.strftime("%B %Y").capitalize()

    expenses = (
        db.query(Expense)
        .filter(Expense.user_id.in_(uid_list), Expense.date >= start, Expense.date <= end)
        .all()
    )

    total = sum(abs(e.amount) for e in expenses if not e.is_income)
    income = sum(abs(e.amount) for e in expenses if e.is_income)
    count = sum(1 for e in expenses if not e.is_income)

    # Top 5 categories by spending
    by_cat: dict[int, dict] = defaultdict(lambda: {"total": 0.0, "name": ""})
    for e in expenses:
        if e.is_income:
            continue
        key = e.category_id or 0
        by_cat[key]["total"] += abs(e.amount)
        if not by_cat[key]["name"]:
            by_cat[key]["name"] = _get_category_name(e.category_id, db)

    top_cats = sorted(by_cat.values(), key=lambda x: x["total"], reverse=True)[:5]
    top_categories = [
        CategorySummary(
            name=c["name"],
            emoji=_cat_emoji(c["name"].split(" > ")[0] if " > " in c["name"] else c["name"]),
            total=round(c["total"], 2),
        )
        for c in top_cats
    ]

    # Expense list: week → last 10 chronological; month → top 10 by amount
    non_income = [e for e in expenses if not e.is_income]
    if period == "week":
        sorted_expenses = sorted(non_income, key=lambda e: (e.date, -abs(e.amount)))[:10]
    else:
        sorted_expenses = sorted(non_income, key=lambda e: abs(e.amount), reverse=True)[:10]

    expense_items = [
        ExpenseItem(
            description=(e.description or "")[:35],
            amount=abs(e.amount),
            date=e.date.strftime("%d/%m"),
            category=_get_category_name(e.category_id, db),
            emoji=_cat_emoji(
                _get_category_name(e.category_id, db).split(" > ")[0]
                if " > " in _get_category_name(e.category_id, db)
                else _get_category_name(e.category_id, db)
            ),
        )
        for e in sorted_expenses
    ]

    return PeriodSummaryReport(
        label=label,
        total=round(total, 2),
        income=round(income, 2),
        net=round(total - income, 2),
        top_categories=top_categories,
        expenses=expense_items,
        count=count,
    )


# ── 3. Upcoming scheduled expenses ──────────────────────────────────


def build_upcoming_scheduled(
    uid_list: list[int], days: int, db: Session
) -> UpcomingScheduledReport:
    """Build upcoming PENDING scheduled expenses grouped by week."""
    today = datetime.now(BUE).date()
    end = today + timedelta(days=days)

    items = (
        db.query(ScheduledExpense)
        .filter(
            ScheduledExpense.user_id.in_(uid_list),
            ScheduledExpense.status == "PENDING",
            ScheduledExpense.scheduled_date >= today,
            ScheduledExpense.scheduled_date <= end,
        )
        .order_by(ScheduledExpense.scheduled_date)
        .all()
    )

    # Load card names
    card_ids = {s.card_id for s in items if s.card_id}
    cards = db.query(Card).filter(Card.id.in_(card_ids)).all() if card_ids else []
    card_map = {c.id: c for c in cards}

    # Group by ISO week
    weeks_map: dict[str, list[ScheduledItem]] = defaultdict(list)
    for s in items:
        week_key = s.scheduled_date.isocalendar()[1]
        card_obj = card_map.get(s.card_id)
        card_name = ""
        if card_obj:
            # Decrypt if needed — card_name is EncryptedType
            card_name = getattr(card_obj.card_name, "decrypt", lambda: card_obj.card_name)()
            if callable(card_name):
                card_name = str(card_name)

        is_inst = s.installment_total > 1
        label = f"{s.installment_number}/{s.installment_total}" if is_inst else ""

        day_label = s.scheduled_date.strftime("%d/%m")
        day_name = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"][s.scheduled_date.weekday()]

        weeks_map[f"{week_key}"].append(
            ScheduledItem(
                description=(s.description or "")[:40],
                amount=abs(s.amount),
                day=f"{day_name} {day_label}",
                card=card_name,
                is_installment=is_inst,
                installment_label=label,
            )
        )

    total_all = 0.0
    week_rows: list[ScheduledWeek] = []
    for week_key in sorted(weeks_map.keys()):
        week_items = weeks_map[week_key]
        week_total = sum(i.amount for i in week_items)
        total_all += week_total

        # Find the first date in this week for a label
        first_date = items[0].scheduled_date  # placeholder
        for s in items:
            if str(s.scheduled_date.isocalendar()[1]) == week_key:
                first_date = s.scheduled_date
                break

        week_label = f"Semana del {first_date.strftime('%d/%m')}"
        week_rows.append(
            ScheduledWeek(label=week_label, items=week_items, total=round(week_total, 2))
        )

    return UpcomingScheduledReport(weeks=week_rows, total=round(total_all, 2), count=len(items))


# ── 4. Upcoming recurring expenses ──────────────────────────────────


def build_upcoming_recurring(
    uid_list: list[int], days: int, db: Session
) -> UpcomingRecurringReport:
    """Build active recurring expenses due within the next N days."""
    today = datetime.now(BUE).date()
    end = today + timedelta(days=days)

    items = (
        db.query(RecurringExpense)
        .filter(
            RecurringExpense.user_id.in_(uid_list),
            RecurringExpense.is_active == True,  # noqa: E712
            RecurringExpense.next_charge_date.isnot(None),
            RecurringExpense.next_charge_date >= today,
            RecurringExpense.next_charge_date <= end,
        )
        .order_by(RecurringExpense.next_charge_date)
        .all()
    )

    total = 0.0
    recurring_items: list[RecurringItem] = []
    for r in items:
        days_until = (r.next_charge_date - today).days
        total += abs(r.amount)
        recurring_items.append(
            RecurringItem(
                description=(r.description or "")[:40],
                amount=abs(r.amount),
                next_date=r.next_charge_date.strftime("%d/%m"),
                days_until=days_until,
                frequency=r.frequency or "monthly",
            )
        )

    return UpcomingRecurringReport(items=recurring_items, total=round(total, 2), count=len(items))


# ── Refactored: weekly report data builder ──────────────────────────


def build_weekly_report_data(user_id: int, start: date, end: date, db) -> dict:
    """Build complete weekly report data for a user.

    Extracted from tasks/weekly_summary.py to be reusable.
    """
    # 1. Weekly expenses
    expenses = (
        db.query(Expense)
        .filter(Expense.user_id == user_id, Expense.date >= start, Expense.date <= end)
        .all()
    )
    total_expenses = sum(abs(e.amount) for e in expenses if not e.is_income)
    transaction_count = sum(1 for e in expenses if not e.is_income)

    # 2. Monthly accumulated
    today = date.today()
    month_start = date(today.year, today.month, 1)
    monthly_expenses = (
        db.query(Expense)
        .filter(Expense.user_id == user_id, Expense.date >= month_start, Expense.date <= today)
        .all()
    )
    monthly_accumulated = sum(abs(e.amount) for e in monthly_expenses if not e.is_income)

    # 3. Category breakdown (top 5)
    by_cat: dict[int, dict] = defaultdict(lambda: {"total": 0.0, "name": ""})
    for e in expenses:
        if e.is_income:
            continue
        key = e.category_id or 0
        by_cat[key]["total"] += abs(e.amount)
        if not by_cat[key]["name"]:
            by_cat[key]["name"] = _get_category_name(e.category_id, db)
    categories = sorted(by_cat.values(), key=lambda x: x["total"], reverse=True)[:5]

    # 4. Top 10 expenses
    top_expenses = sorted(
        [e for e in expenses if not e.is_income], key=lambda e: abs(e.amount), reverse=True
    )[:10]
    top_expenses_data = [
        {
            "date": e.date.strftime("%d/%m"),
            "description": (e.description or "")[:25],
            "amount": abs(e.amount),
            "category": _get_category_name(e.category_id, db)[:12],
        }
        for e in top_expenses
    ]

    # 5. Upcoming expenses (next week)
    next_start, next_end = _next_week_range()
    upcoming = (
        db.query(ScheduledExpense)
        .filter(
            ScheduledExpense.user_id == user_id,
            ScheduledExpense.status == "PENDING",
            ScheduledExpense.scheduled_date >= next_start,
            ScheduledExpense.scheduled_date <= next_end,
        )
        .order_by(ScheduledExpense.scheduled_date)
        .all()
    )
    upcoming_expenses = [
        {
            "date": exp.scheduled_date.strftime("%d/%m"),
            "description": (exp.description or "")[:30],
            "amount": abs(exp.amount),
            "category": _get_category_name(exp.category_id, db),
        }
        for exp in upcoming
    ]

    # 6. Budget warnings (≥80%)
    from app.services.budget_helpers import get_spending_for_event

    uid_list = get_group_user_ids(user_id, db)
    today_bue = datetime.now(BUE).date()
    budgets = db.query(Budget).filter(Budget.user_id == user_id, Budget.is_active == True).all()

    budget_items = []
    for b in budgets:
        spent = get_spending_for_category(
            b.category_id, today_bue.year, today_bue.month, uid_list, db
        )
        pct = round((spent / b.amount * 100) if b.amount > 0 else 0, 1)
        if pct >= 80:
            status = "exceeded" if pct >= 100 else "warning"
            budget_items.append(
                {
                    "category_name": _get_category_name(b.category_id, db),
                    "budget_amount": b.amount,
                    "spent": spent,
                    "percentage": pct,
                    "status": status,
                }
            )

    # 7. Active budget events
    events = (
        db.query(BudgetEvent)
        .filter(
            BudgetEvent.user_id == user_id,
            BudgetEvent.is_active == True,  # noqa: E712
            BudgetEvent.end_date >= today_bue,
        )
        .all()
    )
    event_items = []
    for ev in events:
        cats = json.loads(ev.categories or "[]")
        ev_spent = get_spending_for_event(cats, ev.start_date, ev.end_date, uid_list, db)
        event_items.append(
            {
                "name": ev.name,
                "total_amount": ev.total_amount,
                "spent": ev_spent,
                "remaining": ev.total_amount - ev_spent,
                "end_date": ev.end_date.strftime("%d/%m"),
            }
        )

    # 8. Upcoming recurring (next 7 days)
    upcoming_recurring = (
        db.query(RecurringExpense)
        .filter(
            RecurringExpense.user_id == user_id,
            RecurringExpense.is_active == True,  # noqa: E712
            RecurringExpense.next_charge_date.isnot(None),
            RecurringExpense.next_charge_date >= today_bue,
            RecurringExpense.next_charge_date <= today_bue + timedelta(days=7),
        )
        .order_by(RecurringExpense.next_charge_date)
        .all()
    )
    recurring_items = [
        {
            "description": rec.description[:30],
            "amount": rec.amount,
            "next_date": rec.next_charge_date.strftime("%d/%m"),
            "days_until": (rec.next_charge_date - today_bue).days,
        }
        for rec in upcoming_recurring
    ]

    return {
        "week_start": start.strftime("%d/%m"),
        "week_end": end.strftime("%d/%m/%Y"),
        "total_expenses": total_expenses,
        "monthly_accumulated": monthly_accumulated,
        "transaction_count": transaction_count,
        "categories": categories,
        "upcoming_expenses": upcoming_expenses,
        "top_expenses": top_expenses_data,
        "budgets": sorted(budget_items, key=lambda x: x["percentage"], reverse=True),
        "budget_events": event_items,
        "upcoming_recurring": recurring_items,
        "upcoming_combined_count": len(upcoming_expenses) + len(recurring_items),
        "upcoming_combined_total": sum(e.get("amount", 0) for e in upcoming_expenses)
        + sum(r.get("amount", 0) for r in recurring_items),
    }


def _next_week_range() -> tuple[date, date]:
    """Get the upcoming week range (Monday–Sunday)."""
    today = datetime.now(BUE).date()
    days_until_next_monday = (7 - today.weekday()) % 7
    if days_until_next_monday == 0:
        days_until_next_monday = 7
    start = today + timedelta(days=days_until_next_monday)
    end = start + timedelta(days=6)
    return start, end


def _current_week_range_export() -> tuple[date, date]:
    """Alias for external callers needing the past-week range."""
    return _current_week_range()
