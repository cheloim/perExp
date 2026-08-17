"""API endpoints for AI category suggestions."""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import CategorySuggestion, Expense, MerchantPreference, Notification
from app.services.auth import get_current_user
from app.services.categorization import _normalize_merchant_key

router = APIRouter(prefix="/suggestions", tags=["suggestions"])


class SuggestionResponse(BaseModel):
    id: int
    expense_id: int
    description: str
    amount: float
    date: str
    suggested_category_id: int
    category_name: str
    parent_name: str | None = None
    confidence: float
    status: str
    source: str

    model_config = {"from_attributes": True}


@router.get(
    "",
    response_model=list[SuggestionResponse],
    summary="List category suggestions",
    description="Return all AI-generated category suggestions for the current user, filtered by status.",
)
def get_pending_suggestions(
    status: str = "pending",
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Get all suggestions for the current user, optionally filtered by status."""
    suggestions = (
        db.query(CategorySuggestion)
        .filter(
            CategorySuggestion.user_id == current_user.id,
            CategorySuggestion.status == status,
        )
        .all()
    )

    result = []
    for s in suggestions:
        expense = db.query(Expense).filter(Expense.id == s.expense_id).first()
        if not expense:
            continue
        result.append(
            SuggestionResponse(
                id=s.id,
                expense_id=s.expense_id,
                description=expense.description,
                amount=expense.amount,
                date=expense.date.isoformat(),
                suggested_category_id=s.suggested_category_id,
                category_name=s.suggested_category.name if s.suggested_category else "Unknown",
                parent_name=(
                    s.suggested_category.parent.name
                    if s.suggested_category and s.suggested_category.parent
                    else None
                ),
                confidence=s.confidence,
                status=s.status,
                source=s.source,
            )
        )

    return result


@router.post(
    "/{suggestion_id}/approve",
    summary="Approve a suggestion",
    description="Apply the suggested category to the expense and track the merchant preference.",
)
def approve_suggestion(
    suggestion_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Approve a suggestion and apply the category to the expense."""
    suggestion = (
        db.query(CategorySuggestion)
        .filter(
            CategorySuggestion.id == suggestion_id,
            CategorySuggestion.user_id == current_user.id,
        )
        .first()
    )
    if not suggestion:
        raise HTTPException(status_code=404, detail="Sugerencia no encontrada")

    # Apply category to expense
    expense = db.query(Expense).filter(Expense.id == suggestion.expense_id).first()
    if expense:
        expense.category_id = suggestion.suggested_category_id

        # Track merchant preference
        merchant_key = _normalize_merchant_key(expense.description)
        if merchant_key:
            pref = (
                db.query(MerchantPreference)
                .filter(
                    MerchantPreference.user_id == current_user.id,
                    MerchantPreference.merchant_key == merchant_key,
                )
                .first()
            )
            if pref:
                pref.category_id = suggestion.suggested_category_id
                pref.usage_count += 1
                pref.confidence = min(1.0, pref.confidence + 0.1)
                pref.last_used_at = datetime.utcnow()
            else:
                pref = MerchantPreference(
                    user_id=current_user.id,
                    merchant_key=merchant_key,
                    category_id=suggestion.suggested_category_id,
                    confidence=1.0,
                    usage_count=1,
                )
                db.add(pref)

    # Mark suggestion as approved
    suggestion.status = "approved"

    # Check if all suggestions are resolved, cleanup notification
    _cleanup_notification_if_done(current_user.id, db)

    db.commit()
    return {"detail": "Categoría aplicada correctamente"}


@router.post(
    "/{suggestion_id}/reject",
    summary="Reject a suggestion",
    description="Mark a single category suggestion as rejected without applying it.",
)
def reject_suggestion(
    suggestion_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Reject a suggestion."""
    suggestion = (
        db.query(CategorySuggestion)
        .filter(
            CategorySuggestion.id == suggestion_id,
            CategorySuggestion.user_id == current_user.id,
        )
        .first()
    )
    if not suggestion:
        raise HTTPException(status_code=404, detail="Sugerencia no encontrada")

    suggestion.status = "rejected"

    # Check if all suggestions are resolved, cleanup notification
    _cleanup_notification_if_done(current_user.id, db)

    db.commit()
    return {"detail": "Sugerencia descartada"}


@router.post(
    "/approve-all",
    summary="Approve all high-confidence suggestions",
    description="Bulk-approve all pending suggestions with confidence at or above the given threshold.",
)
def approve_all_suggestions(
    min_confidence: float = 0.7,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Approve all pending suggestions with confidence >= threshold."""
    suggestions = (
        db.query(CategorySuggestion)
        .filter(
            CategorySuggestion.user_id == current_user.id,
            CategorySuggestion.status == "pending",
            CategorySuggestion.confidence >= min_confidence,
        )
        .all()
    )

    count = 0
    for s in suggestions:
        expense = db.query(Expense).filter(Expense.id == s.expense_id).first()
        if expense:
            expense.category_id = s.suggested_category_id

            # Track merchant preference
            merchant_key = _normalize_merchant_key(expense.description)
            if merchant_key:
                pref = (
                    db.query(MerchantPreference)
                    .filter(
                        MerchantPreference.user_id == current_user.id,
                        MerchantPreference.merchant_key == merchant_key,
                    )
                    .first()
                )
                if pref:
                    pref.category_id = s.suggested_category_id
                    pref.usage_count += 1
                    pref.confidence = min(1.0, pref.confidence + 0.1)
                    pref.last_used_at = datetime.utcnow()
                else:
                    pref = MerchantPreference(
                        user_id=current_user.id,
                        merchant_key=merchant_key,
                        category_id=s.suggested_category_id,
                        confidence=1.0,
                        usage_count=1,
                    )
                    db.add(pref)

        s.status = "approved"
        count += 1

    _cleanup_notification_if_done(current_user.id, db)
    db.commit()
    return {"detail": f"{count} categorías aplicadas", "count": count}


@router.post(
    "/discard-all",
    summary="Discard all pending suggestions",
    description="Reject all pending category suggestions for the current user.",
)
def discard_all_suggestions(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Reject all pending suggestions."""
    suggestions = (
        db.query(CategorySuggestion)
        .filter(
            CategorySuggestion.user_id == current_user.id,
            CategorySuggestion.status == "pending",
        )
        .all()
    )

    for s in suggestions:
        s.status = "rejected"

    _cleanup_notification_if_done(current_user.id, db)
    db.commit()
    return {"detail": f"{len(suggestions)} sugerencias descartadas"}


def _cleanup_notification_if_done(user_id: int, db: Session):
    """Delete category_suggestions notification if no pending suggestions remain."""
    pending_count = (
        db.query(CategorySuggestion)
        .filter(
            CategorySuggestion.user_id == user_id,
            CategorySuggestion.status == "pending",
        )
        .count()
    )
    if pending_count == 0:
        db.query(Notification).filter(
            Notification.user_id == user_id,
            Notification.type == "category_suggestions",
        ).delete()
