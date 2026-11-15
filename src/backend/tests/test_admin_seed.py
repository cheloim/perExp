"""The lifespan must not create a default administrator (GHSA-p86h).

Admins are created explicitly with ``python -m scripts.create_admin``.
"""

from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.models import User
from main import app
from scripts.create_admin import create_admin, main


def test_startup_does_not_create_the_default_administrator():
    # Behavior, not source text: boot the app and look at the DB.
    with TestClient(app) as client:
        assert client.get("/health").status_code == 200
        db = SessionLocal()
        try:
            assert db.query(User).filter(User.email == "admin@nikofin.com").first() is None
        finally:
            db.close()


def test_create_admin_creates_an_admin(db):
    user, created = create_admin(db, "NewAdmin@Example.com", "New Admin", "StrongPass1!")

    assert created is True
    assert user.email == "newadmin@example.com"
    assert user.is_admin is True
    assert user.email_verified is True
    assert user.hashed_password


def test_create_admin_promotes_an_existing_user(db):
    existing = User(email="existing@example.com", full_name="Existing", email_verified=False)
    db.add(existing)
    db.commit()

    user, created = create_admin(db, "existing@example.com", "Existing", "StrongPass1!")

    assert created is False
    assert user.is_admin is True
    assert user.email_verified is True
    assert user.hashed_password


def test_main_rejects_a_weak_password(capsys):
    result = main(["--email", "x@example.com", "--password", "weak"])

    assert result == 2
    assert "Password inválida" in capsys.readouterr().err
