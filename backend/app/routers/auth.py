import os
import secrets
import string

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User
from app.schemas import LoginRequest, UserCreate, UserResponse, Token, ChangePasswordRequest, OAuthRequest
from app.services.auth import (
    create_access_token,
    get_current_user,
    get_password_hash,
    verify_password,
    verify_google_token,
    exchange_google_code,
)

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=Token)
def login(body: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == body.email.lower().strip()).first()
    if not user or not verify_password(body.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Email o contraseña incorrectos",
        )
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Usuario inactivo")
    return Token(access_token=create_access_token(user.id), token_type="bearer")


@router.post("/register", response_model=Token, status_code=status.HTTP_201_CREATED)
def register(body: UserCreate, db: Session = Depends(get_db)):
    email = body.email.lower().strip()
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="El email ya está registrado")
    user = User(
        full_name=body.full_name,
        email=email,
        hashed_password=get_password_hash(body.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    from app.seed import _apply_base_hierarchy_for_user
    _apply_base_hierarchy_for_user(db, user.id)
    return Token(access_token=create_access_token(user.id), token_type="bearer")


@router.post("/oauth", response_model=Token)
async def oauth_login(body: OAuthRequest, db: Session = Depends(get_db)):
    if body.provider != "google":
        raise HTTPException(status_code=400, detail="Proveedor no soportado")
    if not body.id_token:
        raise HTTPException(status_code=400, detail="Falta id_token de Google")
    google_data = await verify_google_token(body.id_token)
    email = google_data.get("email", "").lower()
    provider_id = google_data.get("sub")
    full_name = google_data.get("name", "")
    avatar_url = google_data.get("picture")

    if not email:
        raise HTTPException(status_code=400, detail="No se pudo obtener el email del proveedor")

    user = db.query(User).filter(
        User.provider == body.provider,
        User.provider_id == provider_id
    ).first()

    if not user:
        existing = db.query(User).filter(User.email == email).first()
        if existing and existing.provider:
            raise HTTPException(
                status_code=409,
                detail="Este email ya está vinculado a otra cuenta. Iniciá sesión con tu proveedor original."
            )
        if existing and not existing.provider:
            existing.provider = body.provider
            existing.provider_id = provider_id
            existing.avatar_url = avatar_url
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
            )
            db.add(user)
            db.commit()
            db.refresh(user)
            from app.seed import _apply_base_hierarchy_for_user
            _apply_base_hierarchy_for_user(db, user.id)

    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Usuario inactivo")

    return Token(access_token=create_access_token(user.id), token_type="bearer")


@router.post("/oauth/callback", response_model=Token)
async def oauth_callback(
    body: OAuthRequest,
    db: Session = Depends(get_db),
):
    if body.provider != "google":
        raise HTTPException(status_code=400, detail="Proveedor no soportado")
    if not body.code:
        raise HTTPException(status_code=400, detail="Falta código de autorización")

    redirect_uri = f"{os.getenv('FRONTEND_URL', 'http://localhost:5173')}/oauth/google/callback"
    google_data = await exchange_google_code(body.code, redirect_uri)

    email = google_data.get("email", "").lower()
    provider_id = google_data.get("sub")
    full_name = google_data.get("name", "")
    avatar_url = google_data.get("picture")

    if not email:
        raise HTTPException(status_code=400, detail="No se pudo obtener el email del proveedor")

    user = db.query(User).filter(
        User.provider == body.provider,
        User.provider_id == provider_id
    ).first()

    if not user:
        existing = db.query(User).filter(User.email == email).first()
        if existing and existing.provider:
            raise HTTPException(
                status_code=409,
                detail="Este email ya está vinculado a otra cuenta. Iniciá sesión con tu proveedor original."
            )
        if existing and not existing.provider:
            existing.provider = body.provider
            existing.provider_id = provider_id
            existing.avatar_url = avatar_url
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
            )
            db.add(user)
            db.commit()
            db.refresh(user)
            from app.seed import _apply_base_hierarchy_for_user
            _apply_base_hierarchy_for_user(db, user.id)

    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Usuario inactivo")

    return Token(access_token=create_access_token(user.id), token_type="bearer")


@router.get("/me", response_model=UserResponse)
def me(current_user: User = Depends(get_current_user)):
    return current_user


@router.put("/password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(
    body: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not verify_password(body.current_password, current_user.hashed_password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Contraseña actual incorrecta")
    current_user.hashed_password = get_password_hash(body.new_password)
    db.commit()


class TelegramKeyResponse(BaseModel):
    telegram_key: str


def _generate_telegram_key() -> str:
    alphabet = string.ascii_letters + string.digits
    return ''.join(secrets.choice(alphabet) for _ in range(12))


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
    current_user.telegram_key = _generate_telegram_key()
    current_user.telegram_chat_id = None
    db.commit()
    db.refresh(current_user)
    return TelegramKeyResponse(telegram_key=current_user.telegram_key)
