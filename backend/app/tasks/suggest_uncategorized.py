"""Daily task to suggest categories for uncategorized expenses using AI."""

import json
import logging

from app.celery_app import celery_app
from app.database import SessionLocal
from app.models import Expense, Notification, User
from app.services.categorization import llm_categorize

logger = logging.getLogger(__name__)


@celery_app.task(name="app.tasks.suggest_uncategorized.suggest_uncategorized_categories")
def suggest_uncategorized_categories():
    """Find uncategorized expenses and suggest categories via LLM (high temperature).

    Creates in-app notifications with suggestions — does NOT modify expenses.
    """
    db = SessionLocal()
    try:
        users = db.query(User).filter(User.is_active == True).all()  # noqa: E712
        total_users_notified = 0

        for user in users:
            # Skip if AI suggestions are disabled for this user
            from app.services.categorization import _get_setting
            enabled = _get_setting(db, "ai_suggestions_enabled", user.id)
            if enabled == "false":
                continue

            # Skip if unread suggestion notification already exists
            existing = (
                db.query(Notification)
                .filter(
                    Notification.user_id == user.id,
                    Notification.type == "category_suggestions",
                    Notification.read == False,  # noqa: E712
                )
                .first()
            )
            if existing:
                continue

            # Get uncategorized expenses from last 30 days
            from datetime import date, timedelta
            cutoff = date.today() - timedelta(days=30)
            expenses = (
                db.query(Expense)
                .filter(
                    Expense.user_id == user.id,
                    Expense.category_id.is_(None),
                    Expense.date >= cutoff,
                )
                .all()
            )
            if not expenses:
                continue

            # Get user categories
            from app.models import Category
            cats = db.query(Category).filter(Category.user_id == user.id).all()
            if not cats:
                continue

            # Suggest categories for each expense (high temperature for ambiguous descriptions)
            suggestions = []
            for exp in expenses:
                result = llm_categorize(
                    exp.description, exp.amount, cats, user.id, db,
                    temperature=0.7,
                )
                if result and result["confidence"] >= 0.4:
                    suggestions.append({
                        "expense_id": exp.id,
                        "description": exp.description,
                        "amount": exp.amount,
                        "date": exp.date.isoformat(),
                        "suggested_category_id": result["category_id"],
                        "category_name": result["category_name"],
                        "parent_name": result.get("parent_name"),
                        "confidence": round(result["confidence"], 2),
                    })

            if not suggestions:
                continue

            # Create single notification with all suggestions
            count = len(suggestions)
            notification = Notification(
                user_id=user.id,
                type="category_suggestions",
                title=f"✨ {count} gasto{'s' if count != 1 else ''} sugieren categorías",
                body="La IA encontró categorías sugeridas para gastos sin clasificar.",
                data=json.dumps({"suggestions": suggestions, "count": count}),
                read=False,
            )
            db.add(notification)
            total_users_notified += 1

        db.commit()
        logger.info(f"Suggest uncategorized: notified {total_users_notified}/{len(users)} users")
    except Exception as e:
        logger.error(f"Suggest uncategorized task failed: {e}")
        db.rollback()
    finally:
        db.close()
