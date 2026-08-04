"""Daily Celery task to auto-detect recurring expenses from transaction history."""

import json
import logging
from collections import Counter
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from app.celery_app import celery_app
from app.database import SessionLocal
from app.models import Expense, Notification, RecurringExpense, User
from app.services.categorization import _normalize_merchant_key
from app.services.task_tracker import record_task_run

logger = logging.getLogger(__name__)

BUE = ZoneInfo("America/Argentina/Buenos_Aires")

LOOKBACK_DAYS = 90
MIN_OCCURRENCES = 2
AMOUNT_TOLERANCE = 0.10  # 10%


@celery_app.task(name="app.tasks.detect_recurring.detect_recurring_expenses")
def detect_recurring_expenses():
    """Analyze last 90 days of expenses and create RecurringExpense entries for patterns."""
    db = SessionLocal()
    try:
        users = db.query(User).filter(User.is_active == True).all()  # noqa: E712
        total_created = 0
        total_updated = 0
        total_notified = 0

        for user in users:
            created, updated = _detect_for_user(user.id, db)
            total_created += created
            total_updated += updated

            if created > 0:
                _send_notification(user.id, created, db)
                total_notified += 1

        db.commit()
        logger.info(
            f"Detect recurring: created={total_created}, updated={total_updated}, "
            f"notified={total_notified} across {len(users)} users"
        )
        record_task_run("detect-recurring-expenses-daily", success=True)
        return {
            "created": total_created,
            "updated": total_updated,
            "notified": total_notified,
        }

    except Exception as e:
        logger.error(f"Detect recurring failed: {e}")
        record_task_run("detect-recurring-expenses-daily", success=False)
        db.rollback()
        raise
    finally:
        db.close()


def _detect_for_user(user_id: int, db) -> tuple[int, int]:
    """Detect recurring patterns for a single user. Returns (created, updated)."""
    cutoff = datetime.now(BUE).date() - timedelta(days=LOOKBACK_DAYS)

    expenses = (
        db.query(Expense)
        .filter(
            Expense.user_id == user_id,
            Expense.date >= cutoff,
            Expense.is_income == False,  # noqa: E712
        )
        .all()
    )

    if not expenses:
        return 0, 0

    # Group expenses by normalized merchant_key
    merchant_groups: dict[str, list[Expense]] = {}
    for exp in expenses:
        key = _normalize_merchant_key(exp.description)
        if not key or len(key) < 3:
            continue
        merchant_groups.setdefault(key, []).append(exp)

    created = 0
    updated = 0

    for merchant_key, group in merchant_groups.items():
        if len(group) < MIN_OCCURRENCES:
            continue

        amounts = [e.amount for e in group]
        avg_amount = sum(amounts) / len(amounts)
        tolerance = avg_amount * AMOUNT_TOLERANCE

        # All amounts must be within tolerance of the average
        if avg_amount <= 0 or not all(abs(a - avg_amount) <= tolerance for a in amounts):
            continue

        # Determine frequency from date gaps
        sorted_dates = sorted(e.date for e in group)
        frequency = _determine_frequency(sorted_dates)

        # Estimate next charge date
        last_date = max(sorted_dates)
        next_date = _estimate_next_charge(last_date, frequency)

        # Most common category and card
        cat_counts = Counter(e.category_id for e in group if e.category_id)
        category_id = cat_counts.most_common(1)[0][0] if cat_counts else None

        card_counts = Counter(e.card_id for e in group if e.card_id)
        card_id = card_counts.most_common(1)[0][0] if card_counts else None

        account_counts = Counter(e.account_id for e in group if e.account_id)
        account_id = account_counts.most_common(1)[0][0] if account_counts else None

        # Check if already tracked
        existing = (
            db.query(RecurringExpense)
            .filter(
                RecurringExpense.user_id == user_id,
                RecurringExpense.merchant_key == merchant_key,
                RecurringExpense.is_active == True,  # noqa: E712
            )
            .first()
        )

        if existing:
            existing.amount = round(avg_amount, 2)
            existing.last_seen_at = datetime.now(BUE)
            existing.next_charge_date = next_date
            if category_id and not existing.category_id:
                existing.category_id = category_id
            if card_id and not existing.card_id:
                existing.card_id = card_id
            updated += 1
        else:
            new = RecurringExpense(
                user_id=user_id,
                merchant_key=merchant_key,
                description=group[0].description[:500],
                amount=round(avg_amount, 2),
                category_id=category_id,
                card_id=card_id,
                account_id=account_id,
                frequency=frequency,
                next_charge_date=next_date,
                source="auto",
                last_seen_at=datetime.now(BUE),
            )
            db.add(new)
            created += 1

    return created, updated


def _send_notification(user_id: int, count: int, db):
    """Send in-app notification about auto-detected recurring expenses."""
    # Get the auto-detected recurring expenses for this user
    auto_items = (
        db.query(RecurringExpense)
        .filter(
            RecurringExpense.user_id == user_id,
            RecurringExpense.source == "auto",
            RecurringExpense.is_active == True,  # noqa: E712
        )
        .all()
    )

    if not auto_items:
        return

    merchants = [r.merchant_key for r in auto_items[:5]]
    merchants_str = ", ".join(merchants)
    if len(auto_items) > 5:
        merchants_str += f" y {len(auto_items) - 5} más"

    notification = Notification(
        user_id=user_id,
        type="auto_recurring_detected",
        title=f"🤖 Se detectaron {count} gasto{'s' if count != 1 else ''} recurrente{'s' if count != 1 else ''}",
        body=f"{merchants_str}. Revisá en Programados.",
        data=json.dumps(
            {
                "count": count,
                "items": [r.id for r in auto_items],
            }
        ),
        read=False,
    )
    db.add(notification)


def _determine_frequency(sorted_dates: list[date]) -> str:
    """Determine frequency from sorted expense dates."""
    if len(sorted_dates) < 2:
        return "monthly"

    gaps = [(sorted_dates[i + 1] - sorted_dates[i]).days for i in range(len(sorted_dates) - 1)]
    avg_gap = sum(gaps) / len(gaps)

    if avg_gap <= 10:
        return "weekly"
    elif avg_gap <= 45:
        return "monthly"
    elif avg_gap <= 200:
        return "quarterly"
    else:
        return "yearly"


def _estimate_next_charge(last_date: date, frequency: str) -> date:
    """Estimate next charge date based on last occurrence and frequency."""
    today = datetime.now(BUE).date()

    if frequency == "weekly":
        next_d = last_date + timedelta(weeks=1)
    elif frequency == "monthly":
        next_d = last_date + timedelta(days=30)
    elif frequency == "quarterly":
        next_d = last_date + timedelta(days=90)
    elif frequency == "yearly":
        next_d = last_date + timedelta(days=365)
    else:
        next_d = last_date + timedelta(days=30)

    # Always return a future date
    while next_d <= today:
        if frequency == "weekly":
            next_d += timedelta(weeks=1)
        elif frequency == "monthly":
            next_d += timedelta(days=30)
        elif frequency == "quarterly":
            next_d += timedelta(days=90)
        elif frequency == "yearly":
            next_d += timedelta(days=365)

    return next_d
