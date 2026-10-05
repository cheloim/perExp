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

    # Try cookie
    if not token:
        token = request.cookies.get("access_token")

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
        # Redirect to Oikonomia login with return URL
        return_to = str(request.url)
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
async def grafana_token(request: Request):
    """OAuth2 Token endpoint.

    Grafana calls this to exchange the authorization code for an access token.
    """
    # Parse form data
    form = await request.form()
    grant_type = form.get("grant_type", "")
    code = form.get("code", "")
    client_id = form.get("client_id", "")
    client_secret = form.get("client_secret", "")

    # Validate grant type
    if grant_type != "authorization_code":
        raise HTTPException(400, "Unsupported grant_type")

    # Validate client credentials
    if client_id != GRAFANA_CLIENT_ID:
        raise HTTPException(401, "Invalid client_id")
    if GRAFANA_CLIENT_SECRET and client_secret != GRAFANA_CLIENT_SECRET:
        raise HTTPException(401, "Invalid client_secret")

    # Consume auth code
    user_data = _consume_auth_code(code)
    if not user_data:
        raise HTTPException(400, "Invalid or expired authorization code")

    # Generate access token (simple JWT)
    import jwt as pyjwt

    from app.services.auth import ALGORITHM, JWT_SECRET

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
        "token_type": "Bearer",
        "expires_in": 3600,
        "id_token": access_token,  # Grafana expects id_token for OIDC
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
