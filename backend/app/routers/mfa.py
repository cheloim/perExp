from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User
from app.schemas import MFAVerifyRequest
from app.services.auth import get_current_user
from app.services.mfa import generate_mfa_secret, get_mfa_setup_data, verify_totp

router = APIRouter(prefix="/mfa", tags=["mfa"])


class MFAStatusResponse(BaseModel):
    enabled: bool


class MFASetupInitResponse(BaseModel):
    secret: str
    qr_code: str


@router.get("/status", response_model=MFAStatusResponse)
def mfa_status(current_user: User = Depends(get_current_user)):
    return MFAStatusResponse(enabled=bool(current_user.mfa_enabled))


@router.post("/setup", response_model=MFASetupInitResponse)
def mfa_setup(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.mfa_enabled:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="MFA ya está habilitado. Deshabilitarlo primero para reconfigurar.",
        )

    secret = generate_mfa_secret()
    setup_data = get_mfa_setup_data(secret, current_user.email)

    # Store secret temporarily (not enabled yet)
    current_user.mfa_secret = secret
    db.commit()

    return MFASetupInitResponse(secret=setup_data["secret"], qr_code=setup_data["qr_code"])


@router.post("/verify", status_code=status.HTTP_200_OK)
def mfa_verify(
    body: MFAVerifyRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not current_user.mfa_secret:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Primero debés iniciar el setup de MFA con POST /mfa/setup",
        )

    if not verify_totp(current_user.mfa_secret, body.code):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Código MFA incorrecto. Verificá la hora de tu dispositivo.",
        )

    # Enable MFA
    current_user.mfa_enabled = True
    db.commit()

    return {"detail": "MFA habilitado correctamente"}


@router.post("/disable", status_code=status.HTTP_200_OK)
def mfa_disable(
    body: MFAVerifyRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not current_user.mfa_enabled:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="MFA no está habilitado",
        )

    if not current_user.mfa_secret:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error de configuración MFA",
        )

    if not verify_totp(current_user.mfa_secret, body.code):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Código MFA incorrecto",
        )

    current_user.mfa_enabled = False
    current_user.mfa_secret = None
    db.commit()

    return {"detail": "MFA deshabilitado correctamente"}
