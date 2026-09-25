"""Shared service for editing expenses with authorization, validation, and audit.

Used by both the API endpoint (PUT /expenses/{id}) and the Telegram bot (/editar).
"""

import json
import logging
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy.orm import Session

from app.models import AuditLog, Expense
from app.services.encryption import compute_hmac
from app.services.import_utils import _is_duplicate

logger = logging.getLogger(__name__)

EDITABLE_WINDOW_HOURS = 48


class ExpenseEditError(Exception):
    """Raised when an expense edit is rejected."""

    pass


def _log_expense_audit(
    db: Session,
    user_id: int,
    expense_id: int,
    old_values: dict[str, Any],
    new_values: dict[str, Any],
) -> None:
    """Write an audit log entry for an expense edit (no Request required)."""
    diff = {}
    for key in new_values:
        if key in old_values and old_values[key] != new_values[key]:
            diff[key] = {"old": str(old_values[key]), "new": str(new_values[key])}

    if not diff:
        return

    details = json.dumps(
        {"expense_id": expense_id, "changes": diff},
        default=str,
        ensure_ascii=False,
    )

    log = AuditLog(
        user_id=user_id,
        action="expense.update",
        details=details,
    )
    db.add(log)
    # Don't commit here — caller commits as part of the transaction


def _track_merchant_preference(
    user_id: int, description: str, category_id: int, db: Session
) -> None:
    """Track merchant→category preference for future auto-categorization."""
    from app.models import MerchantPreference

    if not description or not category_id:
        return

    merchant_key = description.lower().strip()[:255]
    existing = (
        db.query(MerchantPreference)
        .filter(
            MerchantPreference.user_id == user_id, MerchantPreference.merchant_key == merchant_key
        )
        .first()
    )
    if existing:
        existing.category_id = category_id
        existing.usage_count += 1
        existing.confidence = min(1.0, existing.confidence + 0.1)
        existing.last_used_at = datetime.utcnow()
    else:
        pref = MerchantPreference(
            user_id=user_id,
            merchant_key=merchant_key,
            category_id=category_id,
            confidence=0.8,
            usage_count=1,
        )
        db.add(pref)


def update_expense_checked(
    db: Session,
    user_id: int,
    expense: Expense,
    changes: dict[str, Any],
    *,
    skip_48h_check: bool = False,
    commit: bool = True,
) -> Expense:
    """Apply validated changes to an expense with full checks.

    Checks performed:
    1. Ownership (caller must own the expense)
    2. 48-hour window (created_at non-NULL and ≤48h) — skippable for API
    3. Blocks edits on expenses linked to budget_event, installments, or recurring
    4. Duplicate re-check (excludes self) when date/amount/description change
    5. HMAC recompute when description changes
    6. Audit log with JSON diff
    7. Merchant preference tracking when category changes

    Args:
        db: Active database session
        user_id: ID of the user performing the edit
        expense: The Expense ORM object to edit
        changes: Dict of field→new_value (same keys as Expense columns)
        skip_48h_check: If True, bypass the 48-hour window (used by API for admin edits)

    Returns:
        The updated Expense object

    Raises:
        ExpenseEditError: If any check fails
    """
    # 1. Ownership
    if expense.user_id != user_id:
        raise ExpenseEditError("No tenés permiso para editar este gasto.")

    # 2. 48-hour window
    if not skip_48h_check:
        if expense.created_at is None:
            raise ExpenseEditError("Este gasto fue creado antes de la migración y no es editable.")
        cutoff = datetime.utcnow() - timedelta(hours=EDITABLE_WINDOW_HOURS)
        if expense.created_at < cutoff:
            hours_ago = (datetime.utcnow() - expense.created_at).total_seconds() / 3600
            raise ExpenseEditError(
                f"Este gasto tiene {hours_ago:.0f}h y solo se pueden editar los últimos {EDITABLE_WINDOW_HOURS}h."
            )

    # 3. Block linked expenses (only structural fields for installments)
    if expense.budget_event_id is not None:
        raise ExpenseEditError("No se puede editar un gasto vinculado a un presupuesto/evento.")
    if expense.installment_group_id is not None and (expense.installment_total or 0) > 1:
        blocked_fields = {
            "amount",
            "date",
            "description",
            "installment_number",
            "installment_total",
            "installment_group_id",
        }
        requested_blocked = blocked_fields & set(changes.keys())
        if requested_blocked:
            # Remove blocked fields from changes (allow non-structural edits)
            for field in requested_blocked:
                changes.pop(field, None)
            logger.info(
                "Stripped blocked fields %s from installment expense %s edit",
                requested_blocked,
                expense.id,
            )
            if not changes:
                # Only blocked fields were requested — show helpful message
                raise ExpenseEditError(
                    f"No se puede editar {', '.join(sorted(requested_blocked))} de una cuota. "
                    f"Podés editar: categoría, cuenta. Usá la gestión de cuotas para cambios estructurales."
                )
    if expense.recurring_expense_id is not None:
        raise ExpenseEditError("No se puede editar un gasto recurrente. Editá la suscripción.")

    # Capture old values for audit
    old_values = {}
    for key in changes:
        if hasattr(expense, key):
            old_val = getattr(expense, key)
            if key == "description" and hasattr(old_val, "decrypt"):
                old_val = str(old_val)
            old_values[key] = old_val

    # 4. Duplicate re-check (when date/amount/description change)
    dup_fields = {"date", "amount", "description"} & set(changes.keys())
    if dup_fields:
        check_date = changes.get("date", expense.date)
        check_amount = changes.get("amount", expense.amount)
        check_desc = changes.get("description", expense.description)
        if hasattr(check_desc, "decrypt"):
            check_desc = str(check_desc)

        if _is_duplicate(
            db,
            exp_date=check_date,
            amount=check_amount,
            description=check_desc,
            transaction_id=expense.transaction_id,
            installment_number=expense.installment_number,
            installment_total=expense.installment_total,
            installment_group_id=expense.installment_group_id,
        ):
            # Exclude self from duplicate check
            dup_count = (
                db.query(Expense)
                .filter(
                    Expense.date == check_date,
                    Expense.amount == check_amount,
                    Expense.description_hmac == compute_hmac(check_desc),
                    Expense.id != expense.id,
                )
                .count()
            )
            if dup_count > 0:
                raise ExpenseEditError(
                    "Ya existe un gasto similar (misma fecha, monto y descripción)."
                )

    # Apply changes
    for key, value in changes.items():
        if hasattr(expense, key):
            setattr(expense, key, value)

    # 5. HMAC recompute
    if "description" in changes:
        desc = changes["description"]
        if hasattr(desc, "decrypt"):
            desc = str(desc)
        expense.description_hmac = compute_hmac(desc)

    # 6. Audit log
    _log_expense_audit(db, user_id, expense.id, old_values, changes)

    # 7. Merchant preference tracking
    if "category_id" in changes and changes["category_id"] is not None:
        desc = expense.description
        if hasattr(desc, "decrypt"):
            desc = str(desc)
        _track_merchant_preference(user_id, desc, changes["category_id"], db)

    if commit:
        db.commit()
        db.refresh(expense)
    return expense
