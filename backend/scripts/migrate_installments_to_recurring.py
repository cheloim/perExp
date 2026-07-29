"""Migration: Auto-detect recurring expenses from installment history."""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from collections import defaultdict
from datetime import date, timedelta
from app.database import SessionLocal
from app.models import Expense, RecurringExpense


def _normalize_merchant_key(description: str) -> str:
    import re
    from app.services.import_utils import _normalize_text, _strip_installment_suffix

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

    text = _strip_installment_suffix(text)
    text = _normalize_text(text)

    noise_words = ["COMPRA", "DEBITO", "CREDITO", "CONSUMO", "APROBADA", "APROBADO"]
    for word in noise_words:
        text = re.sub(rf"\b{word}\b", "", text, flags=re.IGNORECASE)

    text = " ".join(text.split()).strip()
    return text[:255] if text else ""


def migrate():
    db = SessionLocal()
    try:
        groups = defaultdict(list)
        for exp in db.query(Expense).filter(Expense.installment_group_id.isnot(None)).all():
            groups[exp.installment_group_id].append(exp)

        created = 0
        for group_id, expenses in groups.items():
            if len(expenses) < 2:
                continue

            merchant_key = _normalize_merchant_key(expenses[0].description)

            existing = (
                db.query(RecurringExpense)
                .filter(RecurringExpense.merchant_key == merchant_key)
                .first()
            )
            if existing:
                continue

            amounts = [e.amount for e in expenses]
            avg_amount = sum(amounts) / len(amounts)

            recurring = RecurringExpense(
                user_id=expenses[0].user_id,
                merchant_key=merchant_key,
                description=expenses[0].description,
                amount=round(avg_amount, 2),
                currency=expenses[0].currency,
                category_id=expenses[0].category_id,
                card_id=expenses[0].card_id,
                account_id=expenses[0].account_id,
                next_charge_date=expenses[-1].date + timedelta(days=30),
                last_seen_at=expenses[-1].date,
            )
            db.add(recurring)
            created += 1

        db.commit()
        print(f"✅ Created {created} recurring expenses from installments")
    finally:
        db.close()


if __name__ == "__main__":
    migrate()
