import os
from datetime import datetime, timedelta
from typing import Optional

import bcrypt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session
import httpx

from app.database import get_db
from app.models import User

SECRET_KEY = os.getenv("SECRET_KEY", "insecure-default-change-me")
ALGORITHM = "HS256"
JWT_EXPIRE_DAYS = int(os.getenv("JWT_EXPIRE_DAYS", "7"))
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
APPLE_CLIENT_ID = os.getenv("APPLE_CLIENT_ID", "")
APPLE_KEY_ID = os.getenv("APPLE_KEY_ID", "")
APPLE_TEAM_ID = os.getenv("APPLE_TEAM_ID", "")

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


def verify_password(plain: str, hashed: str) -> bool:
    if not hashed:
        return False
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def get_password_hash(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def create_access_token(user_id: int) -> str:
    expire = datetime.utcnow() + timedelta(days=JWT_EXPIRE_DAYS)
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
        user_id: Optional[str] = payload.get("sub")
        if user_id is None:
            raise credentials_exc
    except JWTError:
        raise credentials_exc
    user = db.get(User, int(user_id))
    if user is None or not user.is_active:
        raise credentials_exc
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
        return await verify_google_token(id_token)


async def verify_apple_token(code: str) -> dict:
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            "https://appleid.apple.com/auth/token",
            data={
                "grant_type": "authorization_code",
                "code": code,
                "client_id": APPLE_CLIENT_ID,
                "client_secret": _generate_apple_client_secret(),
            },
        )
        if resp.status_code != 200:
            raise HTTPException(status_code=401, detail="Token de Apple inválido")
        data = resp.json()
        id_token = data.get("id_token")
        if not id_token:
            raise HTTPException(status_code=401, detail="No se recibió id_token de Apple")
        return jwt.decode(id_token, "", algorithms=["RS256"])


def _generate_apple_client_secret() -> str:
    from jose import jwt as jose_jwt
    now = datetime.utcnow()
    payload = {
        "iss": APPLE_TEAM_ID,
        "iat": now,
        "exp": now + timedelta(hours=1),
        "aud": "https://appleid.apple.com",
        "sub": APPLE_CLIENT_ID,
    }
    return jose_jwt.encode(payload, "", algorithm="RS256", headers={"kid": APPLE_KEY_ID})
