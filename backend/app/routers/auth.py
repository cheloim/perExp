import secrets
import string

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User
from app.schemas import LoginRequest, UserCreate, UserResponse, Token, ChangePasswordRequest
from app.services.auth import (
    create_access_token,
    get_current_user,
    get_password_hash,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=Token)
def login(body: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.dni == body.dni).first()
    if not user or not verify_password(body.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="DNI o contraseña incorrectos",
        )
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Usuario inactivo")
    return Token(access_token=create_access_token(user.id), token_type="bearer")


@router.post("/register", response_model=Token, status_code=status.HTTP_201_CREATED)
def register(body: UserCreate, db: Session = Depends(get_db)):
    if db.query(User).filter(User.dni == body.dni).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="El DNI ya está registrado")
    if body.email and db.query(User).filter(User.email == body.email).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="El email ya está registrado")
    user = User(
        dni=body.dni,
        full_name=body.full_name,
        email=body.email,
        hashed_password=get_password_hash(body.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    from app.seed import _apply_base_hierarchy_for_user
    _apply_base_hierarchy_for_user(db, user.id)
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
