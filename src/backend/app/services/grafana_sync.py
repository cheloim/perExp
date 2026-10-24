"""Grafana user reconciliation.

Grafana's *authentication* is Google's; its *authorization* is Oikonomia's
`is_admin` flag. The two are deliberately decoupled: when the platform is down
you still need to read the dashboards that explain why, so signing in to Grafana
must not require the backend to be up.

The flag is materialized as Grafana users by this module: admins are provisioned
with the Admin role, everyone else is removed. Grafana runs with
`allow_sign_up=false`, so a user that was not provisioned cannot sign in at all.

Consistency is eventual on purpose — reconciliation runs when the flag changes
and periodically from celery beat, never during a login.
"""

import logging
import os
from collections.abc import Iterable

import httpx

logger = logging.getLogger(__name__)

GRAFANA_URL = os.getenv("GRAFANA_INTERNAL_URL", "http://localhost:3000")
GRAFANA_ADMIN_USER = os.getenv("GF_SECURITY_ADMIN_USER", "admin")
GRAFANA_ADMIN_PASSWORD = os.getenv("GRAFANA_ADMIN_PASSWORD", "oikonomia2026")


def _grafana_admin_auth() -> tuple[str, str]:
    return (GRAFANA_ADMIN_USER, GRAFANA_ADMIN_PASSWORD)


def sync_user_to_grafana(email: str, name: str, is_admin: bool = False) -> bool:
    """Make Grafana match Oikonomia for a single user.

    Admins end up provisioned with the Admin role; everyone else ends up
    removed. Returns True when Grafana is in the desired state (absence counts
    as the desired state for non-admins). Never raises: Grafana being
    unreachable must not break an Oikonomia login.
    """
    try:
        with httpx.Client(base_url=GRAFANA_URL, timeout=5.0) as client:
            auth = _grafana_admin_auth()
            resp = client.get("/api/users/lookup", params={"loginOrEmail": email}, auth=auth)

            if resp.status_code == 200:
                user_id = resp.json()["id"]
            elif resp.status_code == 404:
                user_id = None
            else:
                logger.warning("Grafana: status inesperado %d para %s", resp.status_code, email)
                return False

            if not is_admin:
                if user_id is None:
                    return True
                client.delete(f"/api/admin/users/{user_id}", auth=auth)
                logger.info("Grafana: removed %s (no es admin)", email)
                return True

            if user_id is not None:
                client.patch(f"/api/org/users/{user_id}", json={"role": "Admin"}, auth=auth)
                logger.info("Grafana: %s confirmado como Admin", email)
                return True

            client.post(
                "/api/admin/users",
                json={
                    "email": email,
                    "name": name,
                    "login": email,
                    # Contraseña aleatoria: el acceso es por Google. Un usuario
                    # creado no debe poder entrar con credenciales locales.
                    "password": os.urandom(16).hex(),
                },
                auth=auth,
            )
            # El rol se asigna después de crear: /api/admin/users no lo acepta.
            created = client.get("/api/users/lookup", params={"loginOrEmail": email}, auth=auth)
            if created.status_code == 200:
                client.patch(
                    f"/api/org/users/{created.json()['id']}",
                    json={"role": "Admin"},
                    auth=auth,
                )
            logger.info("Grafana: created %s as Admin", email)
            return True

    except Exception as e:  # noqa: BLE001 — Grafana caído no debe romper el login
        logger.warning("Grafana sync failed for %s: %s", email, e)
        return False


def reconcile_admins(users: Iterable[tuple[str, str, bool]]) -> dict:
    """Reconcile Grafana against a snapshot of Oikonomia users.

    `users` is an iterable of (email, name, is_admin). Pass every active user,
    not only the admins: that is what removes the ones that were demoted.

    Returns {"synced": int, "removed": int, "failed": int}:
    `synced` counts admins confirmed or provisioned, `removed` counts non-admins
    removed (or already absent), `failed` counts anything Grafana rejected.
    Never raises.
    """
    synced = 0
    removed = 0
    failed = 0
    for email, name, is_admin in users:
        if not sync_user_to_grafana(email, name, bool(is_admin)):
            failed += 1
        elif is_admin:
            synced += 1
        else:
            removed += 1
    return {"synced": synced, "removed": removed, "failed": failed}
