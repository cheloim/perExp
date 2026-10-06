"""Grafana user sync service.

Automatically provisions/removes admin users in Grafana when their
admin status changes in Oikonomia. Uses Grafana's HTTP API.

Grafana is configured with Google OAuth (allow_sign_up=false), so
only pre-provisioned users can log in.
"""

import logging
import os

import httpx

logger = logging.getLogger(__name__)

GRAFANA_URL = os.getenv("GRAFANA_INTERNAL_URL", "http://localhost:3000")
GRAFANA_ADMIN_USER = os.getenv("GF_SECURITY_ADMIN_USER", "admin")
GRAFANA_ADMIN_PASSWORD = os.getenv("GRAFANA_ADMIN_PASSWORD", "oikonomia2026")


def _grafana_admin_auth() -> tuple[str, str]:
    return (GRAFANA_ADMIN_USER, GRAFANA_ADMIN_PASSWORD)


def sync_user_to_grafana(email: str, name: str, is_admin: bool = False) -> bool:
    """Create or update a user in Grafana.

    Called when a user is created or their admin status changes.
    Returns True if successful.
    """
    role = "Admin" if is_admin else "Viewer"

    try:
        with httpx.Client(base_url=GRAFANA_URL, timeout=5.0) as client:
            # Check if user already exists
            resp = client.get(
                "/api/users/lookup",
                params={"loginOrEmail": email},
                auth=_grafana_admin_auth(),
            )

            if resp.status_code == 200:
                # User exists — update role
                user_id = resp.json()["id"]
                client.patch(
                    f"/api/users/{user_id}",
                    json={"role": role},
                    auth=_grafana_admin_auth(),
                )
                logger.info("Grafana: updated %s role to %s", email, role)
                return True

            if resp.status_code == 404:
                # User doesn't exist — create
                client.post(
                    "/api/admin/users",
                    json={
                        "email": email,
                        "name": name,
                        "login": email,
                        "password": os.urandom(16).hex(),  # random password (OAuth only)
                    },
                    auth=_grafana_admin_auth(),
                )
                # Set role after creation
                resp2 = client.get(
                    "/api/users/lookup",
                    params={"loginOrEmail": email},
                    auth=_grafana_admin_auth(),
                )
                if resp2.status_code == 200:
                    user_id = resp2.json()["id"]
                    client.patch(
                        f"/api/users/{user_id}",
                        json={"role": role},
                        auth=_grafana_admin_auth(),
                    )
                logger.info("Grafana: created %s as %s", email, role)
                return True

            logger.warning("Grafana: unexpected status %d for %s", resp.status_code, email)
            return False

    except Exception as e:
        logger.warning("Grafana sync failed for %s: %s", email, e)
        return False


def remove_user_from_grafana(email: str) -> bool:
    """Remove a user from Grafana.

    Called when a user is deleted from Oikonomia.
    """
    try:
        with httpx.Client(base_url=GRAFANA_URL, timeout=5.0) as client:
            resp = client.get(
                "/api/users/lookup",
                params={"loginOrEmail": email},
                auth=_grafana_admin_auth(),
            )
            if resp.status_code == 200:
                user_id = resp.json()["id"]
                client.delete(
                    f"/api/admin/users/{user_id}",
                    auth=_grafana_admin_auth(),
                )
                logger.info("Grafana: removed user %s", email)
                return True
            return False
    except Exception as e:
        logger.warning("Grafana remove failed for %s: %s", email, e)
        return False


def sync_all_admins(users: list[dict]) -> dict:
    """Sync all admin users to Grafana. Used for initial setup.

    Args:
        users: list of {"email": str, "name": str, "is_admin": bool}

    Returns:
        {"synced": int, "failed": int}
    """
    synced = 0
    failed = 0
    for user in users:
        if sync_user_to_grafana(user["email"], user["name"], user.get("is_admin", False)):
            synced += 1
        else:
            failed += 1
    return {"synced": synced, "failed": failed}
