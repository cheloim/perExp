"""Backfill for the blind n-gram search index.

The column is added by Alembic without a data migration: the release runs
Alembic with the production key, but the migration-fixture job does not, so
decrypting there would write garbage. The application backfills in batches at
startup, where the encryption key is guaranteed to be the one that encrypted
the rows.
"""

from __future__ import annotations

import logging

from app.database import SessionLocal
from app.models import Expense
from app.services.expense_search import build_search_grams

logger = logging.getLogger(__name__)


def backfill_search_grams(batch_size: int = 500) -> int:
    """Index expenses whose ``search_grams`` is still NULL. Idempotent."""
    db = SessionLocal()
    total = 0
    try:
        while True:
            rows = db.query(Expense).filter(Expense.search_grams.is_(None)).limit(batch_size).all()
            if not rows:
                break
            for expense in rows:
                expense.search_grams = build_search_grams(expense.description, expense.notes)
            db.commit()
            total += len(rows)
            logger.info("[SEARCH INDEX] Backfilled %d expenses", total)
    except Exception:
        db.rollback()
        logger.exception("[SEARCH INDEX] Backfill failed after %d expenses", total)
    finally:
        db.close()
    return total
