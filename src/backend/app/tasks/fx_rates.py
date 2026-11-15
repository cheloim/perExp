"""Persist the daily BNA rate (issue #508b).

The expense rate snapshot and the budget conversion need yesterday's rate to
still be yesterday's rate tomorrow. The task is idempotent: the unique
(date, source, base, quote) constraint makes a re-run an update.
"""

import logging

from app.celery_app import celery_app
from app.database import SessionLocal
from app.services import fx

logger = logging.getLogger(__name__)


@celery_app.task(name="app.tasks.fx_rates.persist_daily_fx_rate")
def persist_daily_fx_rate() -> dict:
    db = SessionLocal()
    try:
        row = fx.save_rate(db, fx.get_usd_rate("budget"))
        db.commit()
        return {"date": row.date.isoformat(), "source": row.source, "rate": row.rate}
    except Exception as exc:
        db.rollback()
        logger.warning("Could not persist the daily FX rate: %s", exc)
        return {"error": str(exc)}
    finally:
        db.close()
