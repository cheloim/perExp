"""Grafana OAuth2 provider endpoints.

Implements the OAuth2 Authorization Code flow so Grafana can authenticate
users against Oikonomia's user database. Only admin users are allowed.

Endpoints:
    GET  /auth/oauth/grafana/authorize  — redirect to login or issue auth code
    POST /auth/oauth/grafana/token      — exchange code for access token
    GET  /auth/oauth/grafana/userinfo   — return user profile + role
"""

import json
import logging
import os
import secrets
import time

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User

logger = logging.getLogger(__name__)

router = APIRouter(tags=["grafana-oauth"])

GRAFANA_CLIENT_ID = os.getenv("GRAFANA_OAUTH_CLIENT_ID", "grafana-oikonomia")
GRAFANA_CLIENT_SECRET = os.getenv("GRAFANA_OAUTH_CLIENT_SECRET", "")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")

# ── Helpers ───────────────────────────────────────────────────


def _get_redis():
    from app.services.rate_limit import _get_redis

    return _get_redis()


def _store_auth_code(code: str, user_data: dict, ttl: int = 300) -> None:
    """Store auth code in Redis with TTL."""
    r = _get_redis()
    r.setex(f"grafana_oauth:{code}", ttl, json.dumps(user_data))


def _consume_auth_code(code: str) -> dict | None:
    """Retrieve and delete auth code (single-use)."""
    r = _get_redis()
    key = f"grafana_oauth:{code}"
    data = r.get(key)
    if data:
        r.delete(key)
        return json.loads(data)
    return None


def _get_user_from_session(request: Request, db: Session) -> User | None:
    """Extract user from JWT token in Authorization header or cookie."""
    from app.services.auth import ALGORITHM, JWT_SECRET

    # Try Authorization header
    auth_header = request.headers.get("authorization", "")
    token = None
    if auth_header.startswith("Bearer "):
        token = auth_header[7:]

    # Try cookie (set by login endpoint)
    if not token:
        token = request.cookies.get("oikonomia_auth")

    if not token:
        return None

    try:
        import jwt

        payload = jwt.decode(token, JWT_SECRET, algorithms=[ALGORITHM])
        user_id = payload.get("sub")
        if not user_id:
            return None
        user = db.get(User, int(user_id))
        if user and user.is_active and not user.is_blocked:
            return user
    except Exception:
        pass

    return None


# ── Endpoints ─────────────────────────────────────────────────


@router.get("/auth/oauth/grafana/authorize")
async def grafana_authorize(
    request: Request,
    redirect_uri: str,
    state: str = "",
    client_id: str = "",
    response_type: str = "code",
    scope: str = "",
    db: Session = Depends(get_db),
):
    """OAuth2 Authorization endpoint.

    Grafana redirects here. If user is logged in and is admin,
    generate an auth code and redirect back to Grafana.
    Otherwise redirect to Oikonomia login page.
    """
    # Validate client_id
    if client_id and client_id != GRAFANA_CLIENT_ID:
        raise HTTPException(400, "Invalid client_id")

    # Check if user is logged in
    user = _get_user_from_session(request, db)

    if not user:
        # Build return URL using public BASE_URL
        # Note: /api/ prefix is needed because frontend nginx proxies /api/ → backend
        base_url = os.getenv("BASE_URL", FRONTEND_URL).rstrip("/")
        authorize_path = f"/api/auth/oauth/grafana/authorize?redirect_uri={redirect_uri}&state={state}&client_id={client_id}&response_type={response_type}&scope={scope}"
        return_to = f"{base_url}{authorize_path}"
        login_url = f"{FRONTEND_URL}/login?return_to={return_to}"
        return RedirectResponse(url=login_url)

    # Check admin access
    if not user.is_admin:
        raise HTTPException(
            403,
            detail="Acceso restringido a administradores de Oikonomia",
        )

    # Generate auth code
    code = secrets.token_urlsafe(32)
    _store_auth_code(
        code,
        {
            "user_id": user.id,
            "email": user.email,
            "name": user.full_name,
            "role": "Admin",
            "iat": int(time.time()),
        },
    )

    # Redirect back to Grafana
    separator = "&" if "?" in redirect_uri else "?"
    callback_url = f"{redirect_uri}{separator}code={code}"
    if state:
        callback_url += f"&state={state}"

    return RedirectResponse(url=callback_url)


@router.post("/auth/oauth/grafana/token")
async def grafana_token(request: Request, db: Session = Depends(get_db)):
    """OAuth2 Token endpoint.

    Supports:
    - grant_type=authorization_code: exchange code for access token
    - grant_type=refresh_token: refresh an expired access token
    """
    import jwt as pyjwt

    from app.services.auth import ALGORITHM, JWT_SECRET

    form = await request.form()
    grant_type = form.get("grant_type", "")
    client_id = form.get("client_id", "")
    client_secret = form.get("client_secret", "")

    # Validate client credentials
    if client_id != GRAFANA_CLIENT_ID:
        raise HTTPException(401, "Invalid client_id")
    if GRAFANA_CLIENT_SECRET and client_secret != GRAFANA_CLIENT_SECRET:
        raise HTTPException(401, "Invalid client_secret")

    user_data = None

    if grant_type == "authorization_code":
        code = form.get("code", "")
        user_data = _consume_auth_code(code)
        if not user_data:
            raise HTTPException(400, "Invalid or expired authorization code")

    elif grant_type == "refresh_token":
        refresh_token = form.get("refresh_token", "")
        if not refresh_token:
            raise HTTPException(400, "Missing refresh_token")
        # Validate the refresh token (which is actually the expired access token)
        try:
            # Allow expired tokens for refresh
            payload = pyjwt.decode(
                refresh_token, JWT_SECRET, algorithms=[ALGORITHM], options={"verify_exp": False}
            )
        except Exception:
            raise HTTPException(401, "Invalid refresh_token")

        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(401, "Invalid token payload")

        # Verify user still exists and is admin
        user = db.get(User, int(user_id))
        if not user or not user.is_active or not user.is_admin:
            raise HTTPException(401, "User not found, inactive, or not admin")

        user_data = {
            "user_id": user.id,
            "email": user.email,
            "name": user.full_name,
            "role": "Admin",
        }
    else:
        raise HTTPException(400, f"Unsupported grant_type: {grant_type}")

    # Generate access token
    access_token = pyjwt.encode(
        {
            "sub": str(user_data["user_id"]),
            "email": user_data["email"],
            "name": user_data["name"],
            "role": user_data["role"],
            "exp": int(time.time()) + 3600,  # 1 hour
            "iat": int(time.time()),
        },
        JWT_SECRET,
        algorithm=ALGORITHM,
    )

    return {
        "access_token": access_token,
        "refresh_token": access_token,  # Same token, Grafana sends it back for refresh
        "token_type": "Bearer",
        "expires_in": 3600,
        "id_token": access_token,
    }


@router.get("/auth/oauth/grafana/userinfo")
async def grafana_userinfo(request: Request, db: Session = Depends(get_db)):
    """OAuth2 UserInfo endpoint.

    Grafana calls this to get the user's profile and role.
    """
    # Extract token from Authorization header
    auth_header = request.headers.get("authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(401, "Missing or invalid Authorization header")

    token = auth_header[7:]

    # Validate token
    import jwt as pyjwt

    from app.services.auth import ALGORITHM, JWT_SECRET

    try:
        payload = pyjwt.decode(token, JWT_SECRET, algorithms=[ALGORITHM])
    except Exception:
        raise HTTPException(401, "Invalid or expired token")

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(401, "Invalid token payload")

    # Verify user still exists and is admin
    user = db.get(User, int(user_id))
    if not user or not user.is_active:
        raise HTTPException(401, "User not found or inactive")

    if not user.is_admin:
        raise HTTPException(403, "Admin access required")

    return {
        "sub": str(user.id),
        "email": user.email,
        "name": user.full_name,
        "role": "Admin",
        "groups": ["admin"] if user.is_admin else [],
    }
