"""Daily task to detect recurring expenses from transaction history."""

import logging
from collections import defaultdict
from datetime import date, datetime, timedelta

from app.celery_app import celery_app
from app.database import SessionLocal
from app.models import Expense, RecurringExpense, User

logger = logging.getLogger(__name__)


def _normalize_merchant_key(description: str) -> str:
    """Normalize merchant description for grouping."""
    import re

    from app.services.import_utils import _normalize_text, _strip_installment_suffix

    # Strip payment prefixes
    payment_prefixes = [
        "MERPAGO*",
        "MP*",
        "MERCADOPAGO*",
        "PAGO*MISCUENTAS*",
        "PAGO*",
        "DEB.CAJERO*",
        "DEBITO*",
        "DEB*",
        "COMPRA*",
    ]
    text = description.strip()
    upper = text.upper()
    for prefix in payment_prefixes:
        if upper.startswith(prefix):
            text = text[len(prefix) :].strip()
            break

    # Strip installment suffixes
    text = _strip_installment_suffix(text)

    # Normalize to uppercase
    text = _normalize_text(text)

    # Remove common noise words
    noise_words = ["COMPRA", "DEBITO", "CREDITO", "CONSUMO", "APROBADA", "APROBADO"]
    for word in noise_words:
        text = re.sub(rf"\b{word}\b", "", text, flags=re.IGNORECASE)

    # Clean up whitespace
    text = " ".join(text.split()).strip()

    return text[:255] if text else ""


@celery_app.task(name="app.tasks.detect_recurring.detect_recurring_expenses")
def detect_recurring_expenses():
    """Detect recurring expenses from transaction history.

    Finds merchants with 2+ occurrences in the last 90 days,
    checks amount similarity (within 10%), and creates
    RecurringExpense entries.
    """
    db = SessionLocal()
    try:
        users = db.query(User).filter(User.is_active == True).all()  # noqa: E712
        total_new = 0
        total_updated = 0

        for user in users:
            # Get expenses from last 90 days
            cutoff = date.today() - timedelta(days=90)
            expenses = (
                db.query(Expense)
                .filter(
                    Expense.user_id == user.id,
                    Expense.date >= cutoff,
                )
                .all()
            )

            if not expenses:
                continue

            # Group by normalized merchant_key
            groups: dict[str, list] = defaultdict(list)
            for exp in expenses:
                key = _normalize_merchant_key(exp.description)
                if key and len(key) >= 2:
                    groups[key].append(exp)

            for merchant_key, exps in groups.items():
                if len(exps) < 2:
                    continue

                # Check amount similarity (within 10%)
                amounts = [e.amount for e in exps]
                avg_amount = sum(amounts) / len(amounts)
                if avg_amount <= 0:
                    continue
                if not all(abs(a - avg_amount) / avg_amount < 0.1 for a in amounts):
                    continue

                # Check if already tracked
                existing = (
                    db.query(RecurringExpense)
                    .filter(
                        RecurringExpense.user_id == user.id,
                        RecurringExpense.merchant_key == merchant_key,
                    )
                    .first()
                )

                if existing:
                    existing.last_seen_at = datetime.utcnow()
                    existing.amount = round(avg_amount, 2)
                    total_updated += 1
                    continue

                # Calculate next charge date from pattern
                dates = sorted([e.date for e in exps])
                if len(dates) >= 2:
                    avg_days = (dates[-1] - dates[0]).days / (len(dates) - 1)
                    next_date = dates[-1] + timedelta(days=max(1, int(avg_days)))
                else:
                    next_date = None

                # Create recurring expense
                recurring = RecurringExpense(
                    user_id=user.id,
                    merchant_key=merchant_key,
                    description=exps[0].description,
                    amount=round(avg_amount, 2),
                    currency=exps[0].currency,
                    category_id=exps[0].category_id,
                    card_id=exps[0].card_id,
                    account_id=exps[0].account_id,
                    next_charge_date=next_date,
                    last_seen_at=datetime.utcnow(),
                )
                db.add(recurring)
                total_new += 1

        db.commit()
        logger.info("Detect recurring: created %d, updated %d", total_new, total_updated)
    except Exception as e:
        logger.error("Detect recurring task failed: %s", e)
        db.rollback()
    finally:
        db.close()
