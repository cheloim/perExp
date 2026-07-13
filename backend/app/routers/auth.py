import contextlib
import logging
import os
import secrets
import string
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import AuditLog, User
from app.schemas import (
    ChangePasswordRequest,
    EmailVerificationRequest,
    ForceChangePasswordRequest,
    ForgotPasswordRequest,
    LoginRequest,
    MFALoginRequest,
    OAuthRequest,
    ResetPasswordRequest,
    Token,
    UserCreate,
    UserResponse,
)
from app.services.auth import (
    create_access_token,
    exchange_google_code,
    get_current_user,
    get_password_hash,
    verify_google_token,
    verify_password,
)
from app.services.email import send_password_reset_email, send_verification_email
from app.services.mfa import verify_totp
from app.services.rate_limit import (
    check_rate_limit,
    is_account_locked,
    record_failed_login,
    reset_failed_logins,
)

router = APIRouter(prefix="/auth", tags=["auth"])

logger = logging.getLogger(__name__)


def _get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _log_audit(
    db: Session,
    user_id: int | None,
    action: str,
    request: Request,
    details: str | None = None,
):
    log = AuditLog(
        user_id=user_id,
        action=action,
        ip_address=_get_client_ip(request),
        user_agent=request.headers.get("User-Agent", "")[:500],
        details=details,
    )
    db.add(log)
    db.commit()


@router.post("/login", response_model=Token)
def login(body: LoginRequest, request: Request, db: Session = Depends(get_db)):
    # Rate limit check
    client_ip = _get_client_ip(request)
    allowed, retry_after = check_rate_limit(client_ip, "login")
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Demasiados intentos. Intentá de nuevo en {retry_after} segundos",
            headers={"Retry-After": str(retry_after)},
        )

    user = db.query(User).filter(User.email == body.email.lower().strip()).first()

    if not user or not verify_password(body.password, user.hashed_password):
        if user:
            remaining = record_failed_login(user.id)
            _log_audit(db, user.id, "login_failed", request)
            if remaining == 0:
                raise HTTPException(
                    status_code=status.HTTP_423_LOCKED,
                    detail="Cuenta bloqueada por 15 minutos por demasiados intentos fallidos",
                )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Email o contraseña incorrectos",
        )

    # Check account lockout
    locked, retry_after = is_account_locked(user.id)
    if locked:
        raise HTTPException(
            status_code=status.HTTP_423_LOCKED,
            detail=f"Cuenta bloqueada. Intentá de nuevo en {retry_after} segundos",
            headers={"Retry-After": str(retry_after)},
        )

    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Usuario inactivo")

    # Check email verification
    if not user.email_verified and user.provider is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Verificá tu email antes de iniciar sesión",
        )

    # Reset failed attempts on successful password verification
    reset_failed_logins(user.id)

    # Check MFA
    if user.mfa_enabled:
        # Return partial token - MFA required
        partial_token = create_access_token(user.id, expires_minutes=5)
        _log_audit(db, user.id, "login_mfa_required", request)
        return Token(
            access_token=partial_token,
            token_type="bearer",
            mfa_required=True,
        )

    # Check forced password change
    if user.force_password_change:
        force_token = create_access_token(user.id, expires_minutes=5)
        _log_audit(db, user.id, "login_force_password_change", request)
        return Token(
            access_token=force_token,
            token_type="bearer",
            force_password_change=True,
        )

    _log_audit(db, user.id, "login_success", request)
    return Token(access_token=create_access_token(user.id), token_type="bearer")


@router.post("/login/mfa", response_model=Token)
def login_mfa(body: MFALoginRequest, request: Request, db: Session = Depends(get_db)):
    # Validate the partial token
    from jose import JWTError, jwt

    from app.services.auth import ALGORITHM, SECRET_KEY

    try:
        payload = jwt.decode(body.token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str | None = payload.get("sub")
        if user_id is None:
            raise HTTPException(status_code=401, detail="Token inválido")
    except JWTError:
        raise HTTPException(status_code=401, detail="Token inválido o expirado")

    user = db.get(User, int(user_id))
    if user is None or not user.is_active:
        raise HTTPException(status_code=401, detail="Token inválido")

    if not user.mfa_enabled or not user.mfa_secret:
        raise HTTPException(status_code=400, detail="MFA no está habilitado")

    # Rate limit MFA attempts
    allowed, retry_after = check_rate_limit(f"mfa:{user.id}", "mfa")
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Demasiados intentos de MFA. Intentá de nuevo en {retry_after} segundos",
            headers={"Retry-After": str(retry_after)},
        )

    if not verify_totp(user.mfa_secret, body.code):
        _log_audit(db, user.id, "mfa_failed", request)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Código MFA incorrecto",
        )

    _log_audit(db, user.id, "login_success", request, details="mfa_verified")
    return Token(access_token=create_access_token(user.id), token_type="bearer")


@router.post("/register", response_model=Token, status_code=status.HTTP_201_CREATED)
def register(body: UserCreate, request: Request, db: Session = Depends(get_db)):
    # Rate limit check
    client_ip = _get_client_ip(request)
    allowed, retry_after = check_rate_limit(client_ip, "register")
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Demasiados registros. Intentá de nuevo en {retry_after} segundos",
            headers={"Retry-After": str(retry_after)},
        )

    email = body.email.lower().strip()
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="El email ya está registrado"
        )

    # Generate email verification token
    verification_token = secrets.token_hex(32)

    user = User(
        full_name=body.full_name,
        email=email,
        hashed_password=get_password_hash(body.password),
        email_verification_token=verification_token,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    from app.seed import _apply_base_hierarchy_for_user

    _apply_base_hierarchy_for_user(db, user.id)

    # Send verification email
    base_url = os.getenv("FRONTEND_URL", "http://localhost:8082")
    import contextlib

    with contextlib.suppress(Exception):
        send_verification_email(user.email, verification_token, base_url)

    _log_audit(db, user.id, "register", request)
    return Token(access_token=create_access_token(user.id), token_type="bearer")


@router.post("/verify-email", status_code=status.HTTP_200_OK)
def verify_email(body: EmailVerificationRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email_verification_token == body.token).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Token de verificación inválido",
        )
    user.email_verified = True
    user.email_verification_token = None
    db.commit()
    return {"detail": "Email verificado correctamente"}


@router.post("/resend-verification", status_code=status.HTTP_200_OK)
def resend_verification(body: ForgotPasswordRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == body.email.lower().strip()).first()
    if not user or user.email_verified:
        return {"detail": "Si el email existe y no fue verificado, recibirás un enlace"}

    verification_token = secrets.token_hex(32)
    user.email_verification_token = verification_token
    db.commit()

    base_url = os.getenv("FRONTEND_URL", "http://localhost:8082")
    with contextlib.suppress(Exception):
        send_verification_email(user.email, verification_token, base_url)

    return {"detail": "Si el email existe y no fue verificado, recibirás un enlace"}


@router.post("/oauth", response_model=Token)
async def oauth_login(body: OAuthRequest, request: Request, db: Session = Depends(get_db)):
    logger.info(f"[OAuth] Login request: provider={body.provider}, has_id_token={bool(body.id_token)}")
    if body.provider != "google":
        raise HTTPException(status_code=400, detail="Proveedor no soportado")
    if not body.id_token:
        raise HTTPException(status_code=400, detail="Falta id_token de Google")
    google_data = await verify_google_token(body.id_token)
    email = google_data.get("email", "").lower()
    provider_id = google_data.get("sub")
    full_name = google_data.get("name", "")
    avatar_url = google_data.get("picture")
    logger.info(f"[OAuth] Google data: email={email}, provider_id={provider_id}")

    if not email:
        raise HTTPException(status_code=400, detail="No se pudo obtener el email del proveedor")

    user = (
        db.query(User)
        .filter(User.provider == body.provider, User.provider_id == provider_id)
        .first()
    )

    if not user:
        existing = db.query(User).filter(User.email == email).first()
        if existing and existing.provider:
            raise HTTPException(
                status_code=409,
                detail="Este email ya está vinculado a otra cuenta. Iniciá sesión con tu proveedor original.",
            )
        if existing and not existing.provider:
            existing.provider = body.provider
            existing.provider_id = provider_id
            existing.avatar_url = avatar_url
            existing.email_verified = True
            if not existing.full_name:
                existing.full_name = full_name
            db.commit()
            db.refresh(existing)
            user = existing
        else:
            user = User(
                email=email,
                full_name=full_name,
                provider=body.provider,
                provider_id=provider_id,
                avatar_url=avatar_url,
                email_verified=True,
            )
            db.add(user)
            db.commit()
            db.refresh(user)
            from app.seed import _apply_base_hierarchy_for_user

            _apply_base_hierarchy_for_user(db, user.id)

    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Usuario inactivo")

    _log_audit(db, user.id, "oauth_login", request, details=body.provider)
    if user.mfa_enabled:
        force_token = create_access_token(user.id, expires_minutes=5)
        _log_audit(db, user.id, "login_mfa_required", request)
        return Token(access_token=force_token, token_type="bearer", mfa_required=True)
    return Token(access_token=create_access_token(user.id), token_type="bearer")


@router.post("/oauth/callback", response_model=Token)
async def oauth_callback(
    body: OAuthRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    if body.provider != "google":
        raise HTTPException(status_code=400, detail="Proveedor no soportado")
    if not body.code:
        raise HTTPException(status_code=400, detail="Falta código de autorización")

    redirect_uri = f"{os.getenv('FRONTEND_URL', 'http://localhost:8082')}/oauth/google/callback"
    google_data = await exchange_google_code(body.code, redirect_uri)

    email = google_data.get("email", "").lower()
    provider_id = google_data.get("sub")
    full_name = google_data.get("name", "")
    avatar_url = google_data.get("picture")

    if not email:
        raise HTTPException(status_code=400, detail="No se pudo obtener el email del proveedor")

    user = (
        db.query(User)
        .filter(User.provider == body.provider, User.provider_id == provider_id)
        .first()
    )

    if not user:
        existing = db.query(User).filter(User.email == email).first()
        if existing and existing.provider:
            raise HTTPException(
                status_code=409,
                detail="Este email ya está vinculado a otra cuenta. Iniciá sesión con tu proveedor original.",
            )
        if existing and not existing.provider:
            existing.provider = body.provider
            existing.provider_id = provider_id
            existing.avatar_url = avatar_url
            existing.email_verified = True
            if not existing.full_name:
                existing.full_name = full_name
            db.commit()
            db.refresh(existing)
            user = existing
        else:
            user = User(
                email=email,
                full_name=full_name,
                provider=body.provider,
                provider_id=provider_id,
                avatar_url=avatar_url,
                email_verified=True,
            )
            db.add(user)
            db.commit()
            db.refresh(user)
            from app.seed import _apply_base_hierarchy_for_user

            _apply_base_hierarchy_for_user(db, user.id)

    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Usuario inactivo")
    _log_audit(db, user.id, "oauth_login", request, details=f"{body.provider}_callback")
    if user.mfa_enabled:
        force_token = create_access_token(user.id, expires_minutes=5)
        _log_audit(db, user.id, "login_mfa_required", request)
        return Token(access_token=force_token, token_type="bearer", mfa_required=True)
    return Token(access_token=create_access_token(user.id), token_type="bearer")


@router.get("/me", response_model=UserResponse)
def me(current_user: User = Depends(get_current_user)):
    return current_user


@router.put("/password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(
    body: ChangePasswordRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not verify_password(body.current_password, current_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Contraseña actual incorrecta"
        )
    current_user.hashed_password = get_password_hash(body.new_password)
    current_user.force_password_change = False
    db.commit()
    _log_audit(db, current_user.id, "password_changed", request)


@router.post("/force-change-password", response_model=Token)
def force_change_password(
    body: ForceChangePasswordRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """Force password change using a short-lived token (no current password required)."""
    from jose import JWTError, jwt

    from app.services.auth import ALGORITHM, SECRET_KEY

    try:
        payload = jwt.decode(body.token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str | None = payload.get("sub")
        if user_id is None:
            raise HTTPException(status_code=401, detail="Token inválido")
    except JWTError:
        raise HTTPException(status_code=401, detail="Token inválido o expirado")

    user = db.get(User, int(user_id))
    if user is None or not user.is_active:
        raise HTTPException(status_code=401, detail="Token inválido")

    if not user.force_password_change:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No se requiere cambio de contraseña",
        )

    user.hashed_password = get_password_hash(body.new_password)
    user.force_password_change = False
    db.commit()

    _log_audit(db, user.id, "force_password_changed", request)
    return Token(access_token=create_access_token(user.id), token_type="bearer")


class TelegramKeyResponse(BaseModel):
    telegram_key: str


class TelegramStatusResponse(BaseModel):
    connected: bool


def _generate_telegram_key() -> str:
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(12))


@router.get("/me/telegram-key", response_model=TelegramKeyResponse)
def get_telegram_key(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not current_user.telegram_key:
        current_user.telegram_key = _generate_telegram_key()
        db.commit()
        db.refresh(current_user)
    return TelegramKeyResponse(telegram_key=current_user.telegram_key)


@router.post("/me/telegram-key/regenerate", response_model=TelegramKeyResponse)
def regenerate_telegram_key(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # Notify the bot before clearing the session
    if current_user.telegram_chat_id:
        from app.telegram_bot import send_disconnect_notification

        send_disconnect_notification(current_user.telegram_chat_id)

    current_user.telegram_key = _generate_telegram_key()
    current_user.telegram_chat_id = None
    db.commit()
    db.refresh(current_user)
    return TelegramKeyResponse(telegram_key=current_user.telegram_key)


@router.get("/me/telegram-status", response_model=TelegramStatusResponse)
def get_telegram_status(
    current_user: User = Depends(get_current_user),
):
    return TelegramStatusResponse(connected=bool(current_user.telegram_chat_id))


@router.post("/refresh", response_model=Token)
def refresh_token(current_user: User = Depends(get_current_user)):
    return Token(access_token=create_access_token(current_user.id), token_type="bearer")


RESET_TOKEN_EXPIRY_MINUTES = 15


@router.post("/forgot-password", status_code=status.HTTP_200_OK)
def forgot_password(body: ForgotPasswordRequest, request: Request, db: Session = Depends(get_db)):
    # Rate limit check
    client_ip = _get_client_ip(request)
    allowed, retry_after = check_rate_limit(client_ip, "forgot_password")
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Demasiados intentos. Intentá de nuevo en {retry_after} segundos",
            headers={"Retry-After": str(retry_after)},
        )

    user = db.query(User).filter(User.email == body.email.lower().strip()).first()
    if not user:
        return {"detail": "Si el email existe, recibirás un enlace para restablecer tu contraseña"}

    token = secrets.token_hex(32)
    user.reset_token = token
    user.reset_token_expires = datetime.utcnow() + timedelta(minutes=RESET_TOKEN_EXPIRY_MINUTES)
    db.commit()

    base_url = os.getenv("FRONTEND_URL", "http://localhost:8082")
    send_password_reset_email(user.email, token, base_url)

    _log_audit(db, user.id, "forgot_password", request)
    return {"detail": "Si el email existe, recibirás un enlace para restablecer tu contraseña"}


@router.post("/reset-password", status_code=status.HTTP_200_OK)
def reset_password(body: ResetPasswordRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.reset_token == body.token).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Token inválido o expirado",
        )

    if user.reset_token_expires and user.reset_token_expires < datetime.utcnow():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Token inválido o expirado",
        )

    user.hashed_password = get_password_hash(body.new_password)
    user.reset_token = None
    user.reset_token_expires = None
    db.commit()

    return {"detail": "Contraseña actualizada correctamente"}
