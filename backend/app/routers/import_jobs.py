"""
Import Jobs API - Asynchronous file import with background processing
"""

import json
from datetime import datetime, timedelta

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.database import get_db

_log = lambda msg: print(f"{datetime.now().isoformat()} {msg}")
from app.models import ImportJob, User
from app.schemas import ImportJobResponse, RowsConfirmBody
from app.services.auth import get_current_user
from app.services.import_utils import _normalize_text
from app.tasks.import_processor import sync_process_import_job

router = APIRouter(prefix="/import-jobs", tags=["import-jobs"])

# TTL for import jobs in hours
IMPORT_JOB_TTL_HOURS = 24


@router.post("", response_model=ImportJobResponse)
async def create_import_job(
    file: UploadFile = File(...),
    background_tasks: BackgroundTasks = BackgroundTasks(),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """
    Create an import job and process it in the background.
    Returns job_id immediately without waiting for the result.
    """
    content = await file.read()

    # Validate file size (10MB limit)
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(400, "Archivo muy grande (máximo 10MB)")

    # Validate file type
    filename = (file.filename or "").lower()
    if not filename.endswith((".pdf", ".csv", ".xls", ".xlsx")):
        raise HTTPException(415, "Formato no soportado. Usá PDF, CSV o Excel.")

    # Create job record
    job = ImportJob(
        user_id=user.id,
        filename=file.filename or "unknown",
        file_content=content,
        status="PROCESSING",
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    # Start background processing
    background_tasks.add_task(sync_process_import_job, job.id)

    return ImportJobResponse(
        id=job.id,
        filename=job.filename,
        status=job.status,
        created_at=job.created_at,
        completed_at=job.completed_at,
        error_message=job.error_message,
        preview_data=None,
    )


@router.get("", response_model=list[ImportJobResponse])
def list_import_jobs(
    status: str | None = None,
    limit: int = 50,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """List user's import jobs, optionally filtered by status."""
    query = db.query(ImportJob).filter(ImportJob.user_id == user.id)
    if status:
        query = query.filter(ImportJob.status == status)
    jobs = query.order_by(ImportJob.created_at.desc()).limit(limit).all()

    # Parse preview_data JSON
    result = []
    for job in jobs:
        result.append(
            ImportJobResponse(
                id=job.id,
                filename=job.filename,
                status=job.status,
                created_at=job.created_at,
                completed_at=job.completed_at,
                error_message=job.error_message,
                preview_data=json.loads(job.preview_data) if job.preview_data else None,
            )
        )
    return result


@router.get("/{job_id}", response_model=ImportJobResponse)
def get_import_job(
    job_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    """Get a specific import job. Jobs expire after 24 hours."""
    # SECURITY: Only user's own jobs
    job = db.query(ImportJob).filter(ImportJob.id == job_id, ImportJob.user_id == user.id).first()

    if not job:
        raise HTTPException(404, "Import job not found")

    # SECURITY: Check TTL (24 hours)
    if job.created_at < datetime.utcnow() - timedelta(hours=IMPORT_JOB_TTL_HOURS):
        # Job expired - delete and return 410 Gone
        db.delete(job)
        db.commit()
        raise HTTPException(410, f"Import job expired (TTL: {IMPORT_JOB_TTL_HOURS}h)")

    return ImportJobResponse(
        id=job.id,
        filename=job.filename,
        status=job.status,
        created_at=job.created_at,
        completed_at=job.completed_at,
        error_message=job.error_message,
        preview_data=json.loads(job.preview_data) if job.preview_data else None,
    )


@router.put("/{job_id}/preview")
def update_import_preview(
    job_id: int, body: dict, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    """Update preview_data for an import job (e.g., after bulk editing)."""
    # SECURITY: Only user's own jobs
    job = db.query(ImportJob).filter(ImportJob.id == job_id, ImportJob.user_id == user.id).first()

    if not job:
        raise HTTPException(404, "Import job not found")

    # SECURITY: Check TTL
    if job.created_at < datetime.utcnow() - timedelta(hours=IMPORT_JOB_TTL_HOURS):
        db.delete(job)
        db.commit()
        raise HTTPException(410, "Import job expired")

    if job.status != "READY_PREVIEW":
        raise HTTPException(400, f"Cannot update preview for job in status {job.status}")

    # Update preview_data
    job.preview_data = json.dumps(body)
    db.commit()

    return {"updated": True}


@router.post("/{job_id}/confirm")
async def confirm_import_job(
    job_id: int,
    body: RowsConfirmBody,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """
    Confirm import job - saves rows to database.
    Uses the same logic as POST /import/rows-confirm.
    """
    from app.models import Card, Category, Expense, ScheduledExpense
    from app.services.normalizers import first_card_word, normalize_bank, title_case_single

    _log(f"[IMPORT CONFIRM] User {user.id} confirming job {job_id} with {len(body.rows)} rows")

    # SECURITY: Only user's own jobs
    job = db.query(ImportJob).filter(ImportJob.id == job_id, ImportJob.user_id == user.id).first()

    if not job:
        raise HTTPException(404, "Import job not found")

    # SECURITY: Check TTL
    if job.created_at < datetime.utcnow() - timedelta(hours=IMPORT_JOB_TTL_HOURS):
        db.delete(job)
        db.commit()
        raise HTTPException(410, "Import job expired")

    if job.status != "READY_PREVIEW":
        raise HTTPException(400, f"Cannot confirm job in status {job.status}")

    # Log sample row for debugging
    if body.rows:
        sample = body.rows[0]
        _log(f"[IMPORT CONFIRM] Sample row keys: {list(sample.keys())}")

    cards_mapping = body.cards_mapping or {}
    _log(f"[IMPORT CONFIRM] Received cards_mapping: {cards_mapping}")
    _log(f"[IMPORT CONFIRM] cards_mapping length: {len(cards_mapping)}")

    def get_card_key(bank: str, card: str, holder: str) -> str:
        return f"{bank}|{card}|{holder}"

    def find_or_create_card(bank: str, card: str, holder: str, card_type: str = "credito") -> tuple:
        norm_bank = normalize_bank(bank)
        norm_card = first_card_word(card)
        norm_holder = title_case_single(holder)

        _log(
            f"[FIND_OR_CREATE_CARD] bank={norm_bank}, card={norm_card}, holder={norm_holder}, card_type={card_type}"
        )
        _log(
            f"[FIND_OR_CREATE_CARD] user_cards count={len(user_cards)}, names: {[c.card_name for c in user_cards]}"
        )

        existing = next(
            (
                c
                for c in user_cards
                if c.card_name.lower() == norm_card.lower()
                and c.bank.lower() == norm_bank.lower()
                and c.holder.lower() == norm_holder.lower()
            ),
            None,
        )
        if existing:
            _log(f"[FIND_OR_CREATE_CARD] Found existing card: {existing.card_name}")
            if existing.holder.lower() != norm_holder.lower():
                existing.holder = norm_holder
            if existing.card_type != card_type:
                existing.card_type = card_type
            return existing, False

        new_card = Card(
            card_name=norm_card,
            bank=norm_bank,
            holder=norm_holder,
            card_type=card_type,
            user_id=user.id,
        )
        db.add(new_card)
        db.flush()
        user_cards.append(new_card)
        _log(
            f"[FIND_OR_CREATE_CARD] Created new card: card_name={norm_card}, bank={norm_bank}, holder={norm_holder}"
        )
        return new_card, True

    # Reuse rows-confirm logic
    cats = db.query(Category).all()
    user_cards = db.query(Card).filter(Card.user_id == user.id).all()

    imported_count = 0
    skipped_count = 0
    scheduled_count = 0

    for r in body.rows:
        is_scheduled = r.get("is_scheduled", False)

        # Skip duplicates (both regular expenses and scheduled installments)
        if r.get("is_duplicate"):
            skipped_count += 1
            continue

        # Find category
        cat_name = r.get("suggested_category")
        category_id = None
        if cat_name:
            cat = next((c for c in cats if c.name == cat_name), None)
            if cat:
                category_id = cat.id

        # Parse date
        raw_date = r.get("date", "")
        try:
            row_date = datetime.strptime(raw_date, "%d-%m-%Y").date()
        except Exception:
            try:
                row_date = datetime.strptime(raw_date, "%Y-%m-%d").date()
            except Exception:
                raise HTTPException(
                    400, f"Fecha inválida: '{raw_date}' en '{r.get('description', 'N/A')}'"
                )

        # Validate amount
        try:
            amount_value = float(r.get("amount", 0) or 0)
        except (ValueError, TypeError):
            raise HTTPException(
                400, f"Monto inválido: '{r.get('amount')}' en '{r.get('description', 'N/A')}'"
            )

        raw_txn_id = r.get("transaction_id")
        txn_id = str(raw_txn_id).strip() if raw_txn_id else None
        if txn_id:
            txn_id = txn_id.lstrip("0") or "0"

        # Card matching via card_header
        card_header = str(r.get("card_header", "") or "").strip()
        mapping_entry = cards_mapping.get(card_header, {})

        if is_scheduled:
            # Create ScheduledExpense
            try:
                scheduled = ScheduledExpense(
                    scheduled_date=row_date,
                    description=_normalize_text(r.get("description", "")),
                    amount=amount_value,
                    currency=r.get("currency", "ARS"),
                    category_id=category_id,
                    transaction_id=txn_id,
                    installment_number=r.get("installment_number"),
                    installment_total=r.get("installment_total"),
                    installment_group_id=r.get("installment_group_id"),
                    status="PENDING",
                    user_id=user.id,
                )
                db.add(scheduled)
                scheduled_count += 1
            except Exception as e:
                raise HTTPException(
                    500,
                    f"Error al crear gasto programado '{r.get('description', 'N/A')}': {str(e)}",
                )
        else:
            # Create Expense with card from card_header mapping
            if isinstance(mapping_entry, dict) and mapping_entry.get("card_id"):
                card_id = mapping_entry["card_id"]
            elif isinstance(mapping_entry, dict) and mapping_entry.get("bank"):
                # Create new card from mapping
                card_obj, _ = find_or_create_card(
                    mapping_entry.get("bank", ""),
                    mapping_entry.get("card_name", ""),
                    mapping_entry.get(
                        "holder", user.full_name.split()[0] if user.full_name else ""
                    ),
                    mapping_entry.get("card_type", "credito"),
                )
                card_id = card_obj.id
            else:
                # Fallback: create card from card_header
                from app.services.smart_import_core import _parse_card_header

                detected_bank, detected_card = _parse_card_header(card_header)
                card_obj, _ = find_or_create_card(
                    detected_bank or "",
                    detected_card or "",
                    user.full_name.split()[0] if user.full_name else "",
                    "credito",
                )
                card_id = card_obj.id

            try:
                expense = Expense(
                    date=row_date,
                    description=_normalize_text(r.get("description", "")),
                    amount=amount_value,
                    currency=r.get("currency", "ARS"),
                    category_id=category_id,
                    transaction_id=txn_id,
                    installment_number=r.get("installment_number"),
                    installment_total=r.get("installment_total"),
                    installment_group_id=r.get("installment_group_id"),
                    user_id=user.id,
                    card_id=card_id,
                )
                db.add(expense)
                imported_count += 1
            except Exception as e:
                raise HTTPException(
                    500, f"Error al crear gasto '{r.get('description', 'N/A')}': {str(e)}"
                )

    # Mark job as completed
    job.status = "COMPLETED"

    # Delete associated notification (job is completed, no longer needed)
    from app.models import Notification

    notifications = (
        db.query(Notification)
        .filter(
            Notification.user_id == user.id,
            Notification.type.in_(["import_ready", "import_failed"]),
        )
        .all()
    )

    for notif in notifications:
        try:
            data = json.loads(notif.data)
            if data.get("job_id") == job_id:
                db.delete(notif)
        except Exception:
            pass  # Ignore JSON parse errors

    try:
        db.commit()
    except Exception as e:
        db.rollback()
        import traceback

        _log(f"[ERROR] Failed to commit import: {e}")
        _log(traceback.format_exc())
        raise HTTPException(500, f"Database error: {str(e)}")

    _log(
        f"[IMPORT CONFIRM] Success: imported={imported_count}, scheduled={scheduled_count}, skipped={skipped_count}"
    )

    return {"imported": imported_count, "skipped": skipped_count, "scheduled": scheduled_count}


@router.delete("/{job_id}")
def delete_import_job(
    job_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    """Delete an import job."""
    import json

    from app.models import Notification

    job = db.query(ImportJob).filter(ImportJob.id == job_id, ImportJob.user_id == user.id).first()

    if not job:
        raise HTTPException(404, "Import job not found")

    # Eliminar notificación asociada (si existe)
    notifications = (
        db.query(Notification)
        .filter(
            Notification.user_id == user.id,
            Notification.type.in_(["import_ready", "import_failed"]),
        )
        .all()
    )

    for notif in notifications:
        try:
            data = json.loads(notif.data)
            if data.get("job_id") == job_id:
                db.delete(notif)
                _log(f"[DELETE JOB] Deleted associated notification {notif.id}")
        except Exception as e:
            _log(f"[DELETE JOB] Error checking notification: {e}")

    db.delete(job)
    db.commit()
    return {"message": "Job deleted"}
