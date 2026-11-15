"""Destructive admin actions require a step-up proof and leave an audit trail (#516)."""

import pytest
from fastapi.testclient import TestClient

from app.database import get_db
from app.models import AuditLog, User
from app.routers import admin as admin_router
from app.services.auth import create_access_token, get_current_user, get_password_hash
from main import app


def _user(db, email: str, *, is_admin: bool = False, **overrides) -> User:
    user = User(
        email=email,
        full_name=email,
        hashed_password=get_password_hash("admin-pass-123"),
        email_verified=True,
        is_admin=is_admin,
        **overrides,
    )
    db.add(user)
    db.flush()
    return user


def _step_up(admin: User) -> dict[str, str]:
    token = create_access_token(admin.id, expires_minutes=5, scope="admin_step_up")
    return {"X-Step-Up-Token": token}


@pytest.fixture
def client(db):
    admin = _user(db, "admin@example.com", is_admin=True)
    target = _user(db, "target@example.com")
    db.commit()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        yield TestClient(app), admin, target
    finally:
        app.dependency_overrides.clear()


def test_step_up_rejects_a_wrong_password(client):
    http, _admin, _target = client

    response = http.post("/admin/step-up", json={"password": "wrong"})

    assert response.status_code == 401


def test_step_up_returns_a_scoped_token(client):
    http, admin, _target = client

    response = http.post("/admin/step-up", json={"password": "admin-pass-123"})

    assert response.status_code == 200
    token = response.json()["step_up_token"]
    import jwt

    from app.services.auth import ALGORITHM, JWT_SECRET

    payload = jwt.decode(token, JWT_SECRET, algorithms=[ALGORITHM])
    assert payload["sub"] == str(admin.id)
    assert payload["scope"] == "admin_step_up"


@pytest.mark.parametrize(
    "method,path,body",
    [
        ("put", "/admin/users/{target}/admin", None),
        ("put", "/admin/users/{target}/block", {"reason": "test"}),
        ("put", f"/admin/feature-flags/{admin_router.FEATURE_FLAGS[0]['key']}", {"value": "on"}),
        ("post", "/admin/cleanup/audit-logs", None),
        ("post", "/admin/impersonate/request/{target}", None),
    ],
)
def test_destructive_admin_action_requires_step_up(client, method, path, body):
    http, _admin, target = client
    url = path.format(target=target.id)

    response = getattr(http, method)(url, json=body)

    assert response.status_code == 403
    assert "Step-up" in response.json()["detail"]


def test_step_up_allows_the_action_and_writes_audit(client, db):
    http, admin, target = client

    response = http.put(
        f"/admin/users/{target.id}/admin",
        headers=_step_up(admin),
    )

    assert response.status_code == 200
    log = (
        db.query(AuditLog)
        .filter(AuditLog.user_id == admin.id, AuditLog.action == "admin_toggle_admin")
        .order_by(AuditLog.id.desc())
        .first()
    )
    assert log is not None
    assert str(target.id) in (log.details or "")
    assert target.email in (log.details or "")


def test_step_up_token_is_bound_to_the_admin(client):
    http, _admin, target = client
    foreign_token = create_access_token(999999, expires_minutes=5, scope="admin_step_up")

    response = http.put(
        f"/admin/users/{target.id}/admin",
        headers={"X-Step-Up-Token": foreign_token},
    )

    assert response.status_code == 403
