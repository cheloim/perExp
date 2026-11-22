"""Admin panel router — thin HTTP composition of the admin use cases.

Endpoint implementations live in :mod:`app.admin`, grouped by use case.
This module only wires their routers together; paths, permissions, payloads
and audit behavior are unchanged.
"""

from fastapi import APIRouter

from app.admin import audit, impersonation, platform, reports, step_up, users
from app.admin.common import StepUpRequest, _audit_admin, _get_admin_slug, require_step_up
from app.admin.platform import FEATURE_FLAGS, TASK_NAME_MAP

__all__ = [
    "FEATURE_FLAGS",
    "TASK_NAME_MAP",
    "StepUpRequest",
    "_audit_admin",
    "_get_admin_slug",
    "require_step_up",
    "router",
]

router = APIRouter(prefix="/admin", tags=["admin"])
router.include_router(step_up.router)
router.include_router(users.router)
router.include_router(audit.router)
router.include_router(reports.router)
router.include_router(platform.router)
router.include_router(impersonation.router)
