import hashlib
import hmac
import json
import os
import time
import urllib.parse
from datetime import UTC, datetime, timedelta

import bcrypt
import httpx
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jwt import PyJWTError as JWTError
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User

SECRET_KEY = os.getenv("SECRET_KEY", "")
if not SECRET_KEY:
    raise RuntimeError("SECRET_KEY environment variable is required")
if len(SECRET_KEY) < 32:
    raise RuntimeError(
        "SECRET_KEY must be at least 32 characters. "
        'Generate one with: python -c "import secrets; print(secrets.token_urlsafe(64))"'
    )
ALGORITHM = "HS256"
JWT_EXPIRE_DAYS = int(os.getenv("JWT_EXPIRE_DAYS", "7"))
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


def verify_password(plain: str, hashed: str) -> bool:
    if not hashed:
        return False
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def get_password_hash(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def create_access_token(user_id: int, expires_minutes: int | None = None) -> str:
    if expires_minutes:
        expire = datetime.now(UTC) + timedelta(minutes=expires_minutes)
    else:
        expire = datetime.now(UTC) + timedelta(days=JWT_EXPIRE_DAYS)
    return jwt.encode({"sub": str(user_id), "exp": expire}, SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    credentials_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Token inválido o expirado",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str | None = payload.get("sub")
        if user_id is None:
            raise credentials_exc
    except JWTError:
        raise credentials_exc
    user = db.get(User, int(user_id))
    if user is None or not user.is_active:
        raise credentials_exc
    return user


def get_current_admin(user: User = Depends(get_current_user)) -> User:
    if not user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return user


async def verify_google_token(id_token: str) -> dict:
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            "https://www.googleapis.com/oauth2/v3/tokeninfo",
            params={"id_token": id_token},
        )
        if resp.status_code != 200:
            raise HTTPException(status_code=401, detail="Token de Google inválido")
        return resp.json()


async def exchange_google_code(code: str, redirect_uri: str) -> dict:
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "code": code,
                "client_id": GOOGLE_CLIENT_ID,
                "client_secret": GOOGLE_CLIENT_SECRET,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            },
        )
        if resp.status_code != 200:
            raise HTTPException(status_code=400, detail="Error al intercambiar código con Google")
        data = resp.json()
        id_token = data.get("id_token")
        if not id_token:
            raise HTTPException(status_code=400, detail="No se recibió id_token de Google")
        google_data = await verify_google_token(id_token)
        google_data["refresh_token"] = data.get("refresh_token")
        return google_data


TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")


def verify_telegram_webapp(init_data: str, max_age: int = 300) -> dict | None:
    """Verify Telegram Mini App initData.

    Returns parsed user dict on success, None on failure.
    https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
    """
    if not TELEGRAM_BOT_TOKEN or not init_data:
        return None

    parsed = dict(urllib.parse.parse_qsl(init_data))
    received_hash = parsed.pop("hash", None)
    if not received_hash:
        return None

    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(parsed.items()))
    secret_key = hmac.new(b"WebAppData", TELEGRAM_BOT_TOKEN.encode(), hashlib.sha256).digest()
    computed_hash = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()

    if not hmac.compare_digest(computed_hash, received_hash):
        return None

    auth_date = int(parsed.get("auth_date", "0"))
    if time.time() - auth_date > max_age:
        return None

    user_json = parsed.get("user")
    if not user_json:
        return None

    try:
        return json.loads(user_json)
    except (json.JSONDecodeError, TypeError):
        return None


def verify_telegram_login_widget(data: dict, max_age: int = 300) -> dict | None:
    """Verify Telegram Login Widget callback data.

    Returns user dict on success, None on failure.
    https://core.telegram.org/widgets/login#checking-authorization
    """
    if not TELEGRAM_BOT_TOKEN:
        return None

    received_hash = data.get("hash")
    auth_date = data.get("auth_date")
    if not received_hash or not auth_date:
        return None

    if time.time() - int(auth_date) > max_age:
        return None

    check_data = {k: v for k, v in sorted(data.items()) if k != "hash"}
    data_check_string = "\n".join(f"{k}={v}" for k, v in check_data.items())
    secret = hashlib.sha256(TELEGRAM_BOT_TOKEN.encode()).digest()
    computed_hash = hmac.new(secret, data_check_string.encode(), hashlib.sha256).hexdigest()

    if not hmac.compare_digest(computed_hash, received_hash):
        return None

    return data
