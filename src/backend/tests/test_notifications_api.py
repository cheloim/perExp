from fastapi.testclient import TestClient

from app.database import get_db
from app.models import Notification, User
from app.services.auth import get_current_user, get_password_hash
from main import app


def _make_user(db, email: str) -> User:
    user = User(
        email=email,
        full_name="Notification User",
        hashed_password=get_password_hash("testpassword"),
        email_verified=True,
    )
    db.add(user)
    db.flush()
    return user


def _make_notification(db, user_id: int, title: str) -> Notification:
    notification = Notification(
        user_id=user_id,
        type="test",
        title=title,
        body="body",
        data="{}",
        read=False,
    )
    db.add(notification)
    db.flush()
    return notification


def test_delete_all_notifications_only_affects_the_current_user(db):
    user = _make_user(db, "delete-all@test.com")
    other = _make_user(db, "keep-me@test.com")
    _make_notification(db, user.id, "one")
    _make_notification(db, user.id, "two")
    _make_notification(db, other.id, "other")
    db.commit()

    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    try:
        response = TestClient(app).delete("/notifications/all")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json() == {"ok": True, "deleted": 2}
    assert db.query(Notification).filter(Notification.user_id == user.id).count() == 0
    assert db.query(Notification).filter(Notification.user_id == other.id).count() == 1
