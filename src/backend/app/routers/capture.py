"""Authenticated, transient capture endpoints for voice and receipts."""

import logging

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from app.models import User
from app.schemas.capture import ExpenseImageResponse, TranscriptionResponse
from app.services.auth import get_current_user
from app.services.capture import (
    MAX_AUDIO_BYTES,
    MAX_IMAGE_BYTES,
    ExpenseImageResult,
    MediaTooLargeError,
    MediaTooLongError,
    UnsupportedMediaError,
    extract_expense_from_image,
    transcribe_audio,
)
from app.services.llm.client import LLMError
from app.services.rate_limit import check_rate_limit

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/capture", tags=["capture"])


def _rate_limit(user: User) -> None:
    try:
        allowed, retry_after = check_rate_limit(f"capture:{user.id}", "capture")
    except Exception:
        # Capture remains available during a Redis outage; the monthly LLM
        # budget remains an independent limit.
        logger.warning("Rate limit de captura no disponible; se permite la solicitud")
        return
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail="Alcanzaste el límite de capturas por ahora. Probá de nuevo más tarde.",
            headers={"Retry-After": str(retry_after)},
        )


def _map_capture_error(exc: Exception) -> HTTPException:
    if isinstance(exc, UnsupportedMediaError):
        return HTTPException(status_code=400, detail=str(exc))
    if isinstance(exc, MediaTooLargeError):
        return HTTPException(status_code=413, detail=str(exc))
    if isinstance(exc, MediaTooLongError):
        return HTTPException(status_code=400, detail=str(exc))
    if isinstance(exc, LLMError):
        return HTTPException(
            status_code=503,
            detail="El servicio de captura no está disponible en este momento.",
        )
    logger.warning("Falló el proveedor de captura (%s)", type(exc).__name__)
    return HTTPException(
        status_code=502,
        detail="No pude procesar el archivo. Probá de nuevo más tarde.",
    )


@router.post(
    "/transcribe",
    response_model=TranscriptionResponse,
    operation_id="transcribeAudio",
    summary="Transcribe a short audio recording",
)
def transcribe(
    file: UploadFile = File(...),
    duration_seconds: float | None = Form(default=None),
    current_user: User = Depends(get_current_user),
):
    _rate_limit(current_user)
    data = file.file.read(MAX_AUDIO_BYTES + 1)
    try:
        result = transcribe_audio(
            data=data,
            filename=file.filename or "voice-audio",
            mime_type=file.content_type or "application/octet-stream",
            duration_hint=duration_seconds,
        )
    except Exception as exc:
        raise _map_capture_error(exc) from exc
    return TranscriptionResponse(**result.model_dump())


@router.post(
    "/expense-image",
    response_model=ExpenseImageResponse,
    operation_id="extractExpenseFromImage",
    summary="Extract one expense from a payment proof image",
)
def expense_image(
    file: UploadFile = File(...),
    hint: str | None = Form(default=None),
    current_user: User = Depends(get_current_user),
):
    _rate_limit(current_user)
    data = file.file.read(MAX_IMAGE_BYTES + 1)
    try:
        result: ExpenseImageResult = extract_expense_from_image(
            data=data,
            mime_type=file.content_type or "application/octet-stream",
            hint=hint,
        )
    except Exception as exc:
        raise _map_capture_error(exc) from exc
    return ExpenseImageResponse(**result.model_dump())
