"""Tests for the Grafana admin reconciliation.

Grafana's *authorization* source of truth is Oikonomia's `is_admin` flag, but
its *authentication* must not depend on the platform being up: when the platform
is down you need the dashboards that explain why.

These tests pin the reconciliation semantics that make that possible — admins
are provisioned with the Admin role, everyone else is removed — plus the
contract that Grafana being unreachable never breaks an Oikonomia login.
"""

from types import SimpleNamespace

import pytest

from app.services import grafana_sync


class FakeResponse:
    def __init__(self, status_code, json_data=None):
        self.status_code = status_code
        self._json = json_data or {}

    def json(self):
        return self._json


class FakeClient:
    """Records Grafana API calls against an in-memory user store."""

    def __init__(self, state):
        self.state = state

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def get(self, path, params=None, auth=None):
        self.state.calls.append(("GET", path, params))
        email = (params or {}).get("loginOrEmail")
        if email in self.state.users:
            return FakeResponse(200, {"id": self.state.users[email]})
        return FakeResponse(404)

    def post(self, path, json=None, auth=None):
        self.state.calls.append(("POST", path, json))
        if path == "/api/admin/users":
            self.state.users[json["email"]] = 100 + len(self.state.users)
        return FakeResponse(200, {})

    def patch(self, path, json=None, auth=None):
        self.state.calls.append(("PATCH", path, json))
        if getattr(self.state, "reject_patches", False):
            return FakeResponse(500, {"message": "rejected"})
        self.state.roles[path] = json
        return FakeResponse(200, {})

    def delete(self, path, auth=None):
        self.state.calls.append(("DELETE", path, None))
        for email, uid in list(self.state.users.items()):
            if path.endswith(f"/{uid}"):
                del self.state.users[email]
        return FakeResponse(200, {})


class FakeHttpx:
    """Stand-in for the httpx module: no network, no real HTTP."""

    def __init__(self, state, down=False):
        self.state = state
        self.down = down

    def client(self, base_url=None, timeout=None):
        if self.down:
            raise ConnectionError("grafana is down")
        return FakeClient(self.state)


@pytest.fixture
def state():
    return SimpleNamespace(users={}, roles={}, calls=[])


@pytest.fixture
def grafana(monkeypatch, state):
    """Wire grafana_sync to a fake Grafana and give back the fake state."""
    down = False

    def set_down(value=True):
        nonlocal down
        down = value
        monkeypatch.setattr(
            grafana_sync, "httpx", SimpleNamespace(Client=FakeHttpx(state, down).client)
        )

    monkeypatch.setattr(grafana_sync, "GRAFANA_URL", "http://grafana:3000")
    monkeypatch.setattr(grafana_sync, "GRAFANA_ADMIN_PASSWORD", "test-admin-password")
    monkeypatch.setattr(
        grafana_sync, "httpx", SimpleNamespace(Client=FakeHttpx(state, down).client)
    )
    yield SimpleNamespace(state=state, set_down=set_down)


def _paths(calls):
    return [(method, path) for method, path, _ in calls]


class TestGrafanaSync:
    def test_provisions_an_admin_with_the_admin_role(self, grafana):
        ok = grafana_sync.sync_user_to_grafana("admin@example.com", "Admin", is_admin=True)

        assert ok is True
        assert "admin@example.com" in grafana.state.users
        assert ("POST", "/api/admin/users") in _paths(grafana.state.calls)
        assert ("PATCH", "/api/org/users/100") in _paths(grafana.state.calls)

    def test_does_not_provision_non_admins(self, grafana):
        """A non-admin must never reach Grafana: sign-up is disabled there, so
        the only way in is being pre-provisioned."""
        ok = grafana_sync.sync_user_to_grafana("user@example.com", "User", is_admin=False)

        assert ok is True
        assert grafana.state.users == {}, "a non-admin must not be created in Grafana"
        assert not [c for c in grafana.state.calls if c[0] == "POST"], "no user may be created"

    def test_demotion_removes_the_grafana_user(self, grafana):
        grafana.state.users["admin@example.com"] = 42

        ok = grafana_sync.sync_user_to_grafana("admin@example.com", "Admin", is_admin=False)

        assert ok is True
        assert "admin@example.com" not in grafana.state.users, (
            "a demoted admin must lose access, not become a Viewer"
        )
        assert ("DELETE", "/api/admin/users/42") in _paths(grafana.state.calls)

    def test_grafana_being_down_never_raises(self, grafana):
        """Grafana being unreachable must not break an Oikonomia login."""
        grafana.set_down(True)

        ok = grafana_sync.sync_user_to_grafana("admin@example.com", "Admin", is_admin=True)

        assert ok is False
        assert grafana.state.users == {}, "nothing may be provisioned while down"

    def test_without_the_admin_password_it_refuses_to_guess(self, monkeypatch, grafana):
        """`oikonomia2026` was the password production ran with. Without the
        secret the sync must fail, not try a known password."""
        monkeypatch.setattr(grafana_sync, "GRAFANA_ADMIN_PASSWORD", "")

        ok = grafana_sync.sync_user_to_grafana("admin@example.com", "Admin", is_admin=True)

        assert ok is False
        assert grafana.state.calls == [], "it must not call Grafana without credentials"

    def test_a_rejected_role_is_a_failure_not_a_success(self, grafana):
        """A PATCH that Grafana rejects must not be reported as provisioned:
        the admin would land in Grafana as a Viewer with no signal."""
        grafana.state.users["admin@example.com"] = 7
        grafana.state.reject_patches = True

        ok = grafana_sync.sync_user_to_grafana("admin@example.com", "Admin", is_admin=True)

        assert ok is False


class TestGrafanaReconcile:
    def test_reconciles_only_admins(self, grafana):
        users = [
            ("admin@example.com", "Admin", True),
            ("user@example.com", "User", False),
        ]

        result = grafana_sync.reconcile_admins(users)

        assert result["synced"] == 1, "only the admin is provisioned"
        assert result["removed"] == 1, "the non-admin is reconciled away"
        assert result["failed"] == 0
        assert set(grafana.state.users) == {"admin@example.com"}

    def test_reconcile_reports_failures_without_raising(self, grafana):
        grafana.set_down(True)

        result = grafana_sync.reconcile_admins([("admin@example.com", "Admin", True)])

        assert result["failed"] == 1
        assert result["synced"] == 0


class TestGrafanaOAuthProviderIsGone:
    def test_main_no_longer_registers_the_own_oauth_router(self):
        """Grafana authenticates against Google now; the home-grown OAuth
        provider only existed to gate access on `is_admin`, and it made Grafana
        depend on the platform being up."""
        import os

        main_path = os.path.join(os.path.dirname(__file__), "..", "main.py")
        with open(main_path) as f:
            content = f.read()

        assert "grafana_oauth" not in content


class TestCeleryRegistration:
    def test_reconcile_task_is_registered(self):
        """celery beat can only enqueue a task that is registered, and tasks are
        registered by being imported in app.tasks.__init__. An unregistered task
        is enqueued, answered 'unregistered' by the worker, and quietly never
        runs — which is how the hourly reconciliation was silently dead."""
        import app.tasks  # noqa: F401 — registers every task module
        from app.celery_app import celery_app

        name = "app.tasks.grafana_reconcile.reconcile_grafana_admins"
        assert name in celery_app.tasks, f"{name} is not registered"

    def test_every_scheduled_task_is_registered(self):
        """Whatever celery beat schedules has to exist."""
        import app.tasks  # noqa: F401
        from app import celery_schedule
        from app.celery_app import celery_app

        scheduled = {
            entry["task"] for entry in celery_schedule.celery_app.conf.beat_schedule.values()
        }
        missing = scheduled - set(celery_app.tasks)
        assert not missing, f"scheduled but unregistered: {sorted(missing)}"
