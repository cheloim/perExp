"""Shared account deletion logic used by both auth.py and whatsapp_webhook.py."""

import logging

from sqlalchemy.orm import Session

from app.models import (
    Account,
    AnalysisHistory,
    Card,
    CardClosing,
    Category,
    Expense,
    ExpenseTag,
    ImportJob,
    Investment,
    MonthlyReport,
    Notification,
    ScheduledExpense,
    Tag,
    User,
)

logger = logging.getLogger(__name__)


def delete_user_and_all_data(db: Session, user: User) -> None:
    """Permanently delete a user and all associated data.

    Handles FK constraints by deleting child records first, then the user.
    Also removes the user from any family group.
    """
    user_id = user.id

    # Leave family group first (if in one)
    try:
        from app.services.group_helpers import get_user_group, remove_member

        membership = get_user_group(user_id, db)
        if membership:
            remove_member(db, user_id, user_id)
    except Exception:
        logger.warning("Could not leave family group for user %s", user_id)

    # Delete data in order (handle FK constraints manually)
    db.query(ExpenseTag).filter(
        ExpenseTag.tag_id.in_(db.query(Tag.id).filter(Tag.user_id == user_id))
    ).delete(synchronize_session=False)
    db.query(Tag).filter(Tag.user_id == user_id).delete(synchronize_session=False)
    db.query(Notification).filter(Notification.user_id == user_id).delete()
    db.query(Expense).filter(Expense.user_id == user_id).delete()
    db.query(Category).filter(Category.user_id == user_id).delete()
    db.query(Account).filter(Account.user_id == user_id).delete()
    db.query(Card).filter(Card.user_id == user_id).delete()
    db.query(AnalysisHistory).filter(AnalysisHistory.user_id == user_id).delete()
    db.query(Investment).filter(Investment.user_id == user_id).delete()
    db.query(CardClosing).filter(CardClosing.user_id == user_id).delete()
    db.query(ScheduledExpense).filter(ScheduledExpense.user_id == user_id).delete()
    db.query(ImportJob).filter(ImportJob.user_id == user_id).delete()
    db.query(MonthlyReport).filter(MonthlyReport.user_id == user_id).delete()

    # Delete user last
    db.delete(user)
    db.commit()
    logger.info("Account deleted: user_id=%s", user_id)
