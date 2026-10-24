"""Reconcile Grafana's user list with Oikonomia's admin flag."""

import logging

from app.celery_app import celery_app
from app.database import SessionLocal
from app.models import User
from app.services.grafana_sync import reconcile_admins

logger = logging.getLogger(__name__)


@celery_app.task(name="app.tasks.grafana_reconcile.reconcile_grafana_admins")
def reconcile_grafana_admins():
    """Make Grafana's users match Oikonomia's `is_admin` flag.

    Runs hourly so access does not depend on somebody logging in to the
    platform, and so a Grafana volume that gets recreated is repopulated on its
    own. Passes every active user, not only the admins: that is what removes
    the ones that were demoted.
    """
    db = SessionLocal()
    try:
        users = db.query(User).filter(User.is_active.is_(True)).all()
        snapshot = [(str(u.email), str(u.full_name or u.email), bool(u.is_admin)) for u in users]
    finally:
        db.close()

    result = reconcile_admins(snapshot)
    logger.info("Grafana reconcile: %s", result)
    return result
