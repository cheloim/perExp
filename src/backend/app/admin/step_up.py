"""Admin step-up challenge for destructive actions."""

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.admin.common import StepUpRequest, _audit_admin
from app.database import get_db
from app.models import User
from app.services.auth import create_access_token, get_current_admin, verify_password
from app.services.mfa import verify_totp
from app.services.rate_limit import check_rate_limit

router = APIRouter()


@router.post(
    "/step-up",
    summary="Verify the admin password/MFA before a destructive action",
    description="Returns a 5-minute step-up token bound to the current admin.",
)
def admin_step_up(
    body: StepUpRequest,
    request: Request,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    allowed, retry_after = check_rate_limit(f"admin-step-up:{admin.id}", "password_change")
    if not allowed:
        raise HTTPException(
            429,
            f"Demasiados intentos. Intentá de nuevo en {retry_after} segundos",
            headers={"Retry-After": str(retry_after)},
        )

    if not verify_password(body.password, admin.hashed_password):
        raise HTTPException(401, "Contraseña incorrecta")

    if admin.mfa_enabled and not (
        body.mfa_code and admin.mfa_secret and verify_totp(admin.mfa_secret, body.mfa_code)
    ):
        raise HTTPException(401, "Código MFA incorrecto")

    token = create_access_token(admin.id, expires_minutes=5, scope="admin_step_up")
    _audit_admin(db, admin, "admin_step_up", request)
    return {"step_up_token": token, "expires_in": 300}
