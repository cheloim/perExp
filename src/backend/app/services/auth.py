import hashlib
import hmac
import json
import os
import secrets
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
from app.models import RefreshToken, User

SECRET_KEY = os.getenv("SECRET_KEY", "")
if not SECRET_KEY:
    raise RuntimeError("SECRET_KEY environment variable is required")
if len(SECRET_KEY) < 32:
    raise RuntimeError(
        "SECRET_KEY must be at least 32 characters. "
        'Generate one with: python -c "import secrets; print(secrets.token_urlsafe(64))"'
    )

# JWT_SECRET: separate key for signing JWT tokens.
# Falls back to SECRET_KEY for backward compatibility with existing tokens.
JWT_SECRET = os.getenv("JWT_SECRET") or SECRET_KEY
ALGORITHM = "HS256"
# Short-lived access token; the long session lives in the rotating refresh
# token. A stolen access token stops working within the hour.
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))
REFRESH_TOKEN_EXPIRE_DAYS = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "30"))
# Two tabs racing on the same cookie must not look like a stolen token.
REFRESH_REUSE_GRACE_SECONDS = int(os.getenv("REFRESH_REUSE_GRACE_SECONDS", "30"))
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


class RefreshTokenError(Exception):
    """The presented refresh token is missing, expired, revoked or reused."""


def verify_password(plain: str, hashed: str) -> bool:
    if not hashed:
        return False
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def get_password_hash(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def create_access_token(user_id: int, expires_minutes: int | None = None) -> str:
    minutes = expires_minutes if expires_minutes is not None else ACCESS_TOKEN_EXPIRE_MINUTES
    now = datetime.now(UTC)
    payload = {
        "sub": str(user_id),
        "iat": now,
        "exp": now + timedelta(minutes=minutes),
        # Without a unique id, two logins in the same second produce the same
        # token (and the refresh response would look like a no-op).
        "jti": secrets.token_hex(16),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=ALGORITHM)


def hash_refresh_token(raw_token: str) -> str:
    """The database only ever sees this digest, never the bearer value."""
    return hashlib.sha256(raw_token.encode()).hexdigest()


def _token_expiry() -> datetime:
    return datetime.utcnow() + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)


def create_refresh_token(
    db: Session,
    user_id: int,
    *,
    user_agent: str = "",
    ip_address: str = "",
    family_id: str | None = None,
) -> str:
    """Issue a new refresh token and return the opaque value.

    A fresh login starts a new family (one per device); a rotation keeps the
    family so reuse detection can revoke the whole chain.
    """
    # Opportunistic cleanup: expired rows for this user are dead weight and
    # there is no dedicated retention job.
    db.query(RefreshToken).filter(
        RefreshToken.user_id == user_id,
        RefreshToken.expires_at <= datetime.utcnow(),
        RefreshToken.revoked_at.is_(None),
    ).update(
        {"revoked_at": datetime.utcnow(), "revoked_reason": "expired"}, synchronize_session=False
    )

    raw_token = secrets.token_urlsafe(48)
    db.add(
        RefreshToken(
            user_id=user_id,
            token_hash=hash_refresh_token(raw_token),
            family_id=family_id or secrets.token_hex(16),
            user_agent=(user_agent or "")[:255] or None,
            ip_address=(ip_address or "")[:45] or None,
            expires_at=_token_expiry(),
        )
    )
    db.commit()
    return raw_token


def _revoke_family(db: Session, family_id: str, reason: str, *, commit: bool = True) -> None:
    db.query(RefreshToken).filter(
        RefreshToken.family_id == family_id,
        RefreshToken.revoked_at.is_(None),
    ).update({"revoked_at": datetime.utcnow(), "revoked_reason": reason}, synchronize_session=False)
    if commit:
        db.commit()


def rotate_refresh_token(
    db: Session,
    raw_token: str,
    *,
    user_agent: str = "",
    ip_address: str = "",
) -> tuple[User, str]:
    """Validate and rotate a refresh token, returning the user and the new one.

    Presenting an already-rotated token means someone kept a copy: the whole
    family is revoked, which logs the device out instead of letting the thief
    race the legitimate client forever.
    """
    row = (
        db.query(RefreshToken)
        .filter(RefreshToken.token_hash == hash_refresh_token(raw_token))
        .with_for_update()
        .first()
    )
    if row is None:
        raise RefreshTokenError("unknown refresh token")

    now = datetime.utcnow()
    if row.revoked_at is not None:
        # A rotation a moment ago is usually two tabs racing, not theft: reject
        # this one but leave the family alive. An older replay revokes it all.
        recently_rotated = (
            row.revoked_reason == "rotated"
            and (now - row.revoked_at).total_seconds() <= REFRESH_REUSE_GRACE_SECONDS
        )
        if recently_rotated:
            raise RefreshTokenError("concurrent rotation")
        _revoke_family(db, row.family_id, "reuse_detected")
        raise RefreshTokenError("refresh token reuse detected")

    if row.expires_at <= now:
        row.revoked_at = now
        row.revoked_reason = "expired"
        db.commit()
        raise RefreshTokenError("refresh token expired")

    user = db.get(User, row.user_id)
    if user is None or not user.is_active or user.is_blocked:
        _revoke_family(db, row.family_id, "user_inactive")
        raise RefreshTokenError("user cannot refresh")

    new_raw = secrets.token_urlsafe(48)
    new_row = RefreshToken(
        user_id=user.id,
        token_hash=hash_refresh_token(new_raw),
        family_id=row.family_id,
        user_agent=(user_agent or "")[:255] or None,
        ip_address=(ip_address or "")[:45] or None,
        expires_at=_token_expiry(),
    )
    db.add(new_row)
    db.flush()
    row.revoked_at = now
    row.revoked_reason = "rotated"
    row.replaced_by_id = new_row.id
    db.commit()
    return user, new_raw


def revoke_refresh_token(db: Session, raw_token: str) -> bool:
    """Log out this device: the token and the rest of its family go away."""
    row = (
        db.query(RefreshToken)
        .filter(RefreshToken.token_hash == hash_refresh_token(raw_token))
        .first()
    )
    if row is None:
        return False
    _revoke_family(db, row.family_id, "logout")
    return True


def revoke_all_refresh_tokens(db: Session, user_id: int, reason: str = "revoked") -> int:
    """Kill every device session for a user (password change, block, reset)."""
    revoked = (
        db.query(RefreshToken)
        .filter(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
        .update(
            {"revoked_at": datetime.utcnow(), "revoked_reason": reason}, synchronize_session=False
        )
    )
    db.commit()
    return revoked


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
        # Try JWT_SECRET first, fall back to SECRET_KEY for backward compat
        try:
            payload = jwt.decode(token, JWT_SECRET, algorithms=[ALGORITHM])
        except JWTError:
            if JWT_SECRET != SECRET_KEY:
                payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
            else:
                raise
        user_id: str | None = payload.get("sub")
        if user_id is None:
            raise credentials_exc
    except JWTError:
        raise credentials_exc
    user = db.get(User, int(user_id))
    if user is None or not user.is_active:
        raise credentials_exc
    if user.is_blocked:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tu cuenta ha sido bloqueada. Contactá al administrador.",
        )
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
