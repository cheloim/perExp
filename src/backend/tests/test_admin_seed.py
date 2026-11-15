"""The lifespan must not create a default administrator (GHSA-p86h).

Admins are created explicitly with ``python -m scripts.create_admin``.
"""

from pathlib import Path

from app.models import User
from scripts.create_admin import create_admin, main

BACKEND_DIR = Path(__file__).resolve().parents[1]


def test_lifespan_does_not_seed_a_default_admin():
    source = (BACKEND_DIR / "main.py").read_text(encoding="utf-8")

    assert "SEED_USER_PASSWORD" not in source
    assert "ChangeMe123!" not in source


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
