"""Shared helpers and dependencies for the admin panel routers."""

import json
import secrets

import jwt
from fastapi import Depends, HTTPException, Request
from jwt import PyJWTError as JWTError
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.models import AuditLog, Setting, User
from app.services.auth import ALGORITHM, JWT_SECRET, get_current_admin


def _get_admin_slug(db: Session) -> str:
    setting = db.query(Setting).filter(Setting.key == "admin_panel_slug").first()
    if not setting:
        slug = secrets.token_urlsafe(24)[:32]
        db.add(Setting(key="admin_panel_slug", value=slug))
        db.commit()
        return slug
    return setting.value


class StepUpRequest(BaseModel):
    password: str
    mfa_code: str | None = None


def _audit_admin(
    db: Session,
    admin: User,
    action: str,
    request: Request,
    *,
    target: User | None = None,
    details: dict | None = None,
) -> None:
    payload = dict(details or {})
    if target is not None:
        payload.update({"target_user_id": target.id, "target_email": target.email})
    db.add(
        AuditLog(
            user_id=admin.id,
            action=action,
            ip_address=request.client.host if request.client else "unknown",
            user_agent=request.headers.get("User-Agent", "")[:500],
            details=json.dumps(payload),
        )
    )
    db.commit()


def require_step_up(
    request: Request,
    admin: User = Depends(get_current_admin),
) -> User:
    """Destructive admin actions require a fresh password/MFA proof.

    The proof is a 5-minute JWT with ``scope=admin_step_up`` bound to the
    admin's id. It is kept in frontend memory and sent as a header.
    """
    token = request.headers.get("X-Step-Up-Token", "")
    if not token:
        raise HTTPException(403, "Step-up requerido")

    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[ALGORITHM])
    except JWTError:
        raise HTTPException(403, "Step-up inválido o expirado")

    if payload.get("scope") != "admin_step_up" or payload.get("sub") != str(admin.id):
        raise HTTPException(403, "Step-up inválido o expirado")
    return admin
