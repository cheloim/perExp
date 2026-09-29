"""Telegram OpenID Connect client.

Implements the Authorization Code Flow for Telegram's OIDC provider.
https://core.telegram.org/widgets/login#openid-connect
"""

import logging
import os
import time

import httpx
from jwt import PyJWTError as JWTError

logger = logging.getLogger(__name__)

# Telegram OIDC endpoints
_ISSUER = "https://oauth.telegram.org"
_AUTH_ENDPOINT = f"{_ISSUER}/auth"
_TOKEN_ENDPOINT = f"{_ISSUER}/token"
_JWKS_URI = f"{_ISSUER}/.well-known/jwks.json"
_DISCOVERY_URI = f"{_ISSUER}/.well-known/openid-configuration"

# Environment
CLIENT_ID = os.getenv("TELEGRAM_OIDC_CLIENT_ID", "")
CLIENT_SECRET = os.getenv("TELEGRAM_OIDC_CLIENT_SECRET", "")

# JWKS cache
_jwks_cache: dict = {"keys": None, "fetched_at": 0.0}
_JWKS_TTL = 3600  # 1 hour


async def get_jwks() -> dict:
    """Fetch and cache Telegram's JWKS for token verification."""
    now = time.time()
    if _jwks_cache["keys"] and now - _jwks_cache["fetched_at"] < _JWKS_TTL:
        return _jwks_cache["keys"]

    async with httpx.AsyncClient() as client:
        resp = await client.get(_JWKS_URI, timeout=10)
        resp.raise_for_status()
        jwks = resp.json()

    _jwks_cache["keys"] = jwks
    _jwks_cache["fetched_at"] = now
    return jwks


def _get_signing_key(jwks: dict, token: str):
    """Find the signing key from JWKS that matches the token's kid header."""
    import jwt as pyjwt

    try:
        unverified_header = pyjwt.get_unverified_header(token)
    except Exception:
        return None

    kid = unverified_header.get("kid")
    if not kid:
        return None

    for key in jwks.get("keys", []):
        if key.get("kid") == kid:
            return pyjwt.algorithms.RSAAlgorithm.from_jwk(key)
    return None


async def exchange_code(code: str, redirect_uri: str) -> dict | None:
    """Exchange authorization code for tokens.

    Returns dict with 'id_token', 'access_token' on success, None on failure.
    """
    if not CLIENT_ID or not CLIENT_SECRET:
        logger.error("TELEGRAM_OIDC_CLIENT_ID or CLIENT_SECRET not configured")
        return None

    async with httpx.AsyncClient() as client:
        try:
            resp = await client.post(
                _TOKEN_ENDPOINT,
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "redirect_uri": redirect_uri,
                    "client_id": CLIENT_ID,
                    "client_secret": CLIENT_SECRET,
                },
                timeout=15,
            )
            if resp.status_code != 200:
                logger.warning(
                    "Telegram OIDC token exchange failed: %s %s", resp.status_code, resp.text
                )
                return None
            return resp.json()
        except httpx.HTTPError as e:
            logger.error("Telegram OIDC token exchange error: %s", e)
            return None


async def verify_id_token(id_token: str) -> dict | None:
    """Verify a Telegram OIDC id_token and return its claims.

    Returns claims dict on success, None on failure.
    """
    import jwt as pyjwt

    if not CLIENT_ID:
        logger.error("TELEGRAM_OIDC_CLIENT_ID not configured")
        return None

    try:
        jwks = await get_jwks()
    except Exception as e:
        logger.error("Failed to fetch JWKS: %s", e)
        return None

    signing_key = _get_signing_key(jwks, id_token)
    if not signing_key:
        logger.warning("No matching signing key found in JWKS")
        return None

    try:
        claims = pyjwt.decode(
            id_token,
            signing_key,
            algorithms=["RS256"],
            issuer=_ISSUER,
            audience=CLIENT_ID,
            options={"require": ["exp", "iat", "iss", "sub"]},
        )
        return claims
    except pyjwt.ExpiredSignatureError:
        logger.warning("Telegram OIDC id_token expired")
        return None
    except pyjwt.InvalidAudienceError:
        logger.warning("Telegram OIDC id_token invalid audience")
        return None
    except pyjwt.InvalidIssuerError:
        logger.warning("Telegram OIDC id_token invalid issuer")
        return None
    except JWTError as e:
        logger.warning("Telegram OIDC id_token verification failed: %s", e)
        return None


def get_authorization_url(redirect_uri: str, state: str = "") -> str:
    """Build the Telegram OIDC authorization URL."""
    from urllib.parse import urlencode

    params = {
        "client_id": CLIENT_ID,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": "openid",
    }
    if state:
        params["state"] = state
    return f"{_AUTH_ENDPOINT}?{urlencode(params)}"


# OIDC endpoints deployed
