"""Create or promote an administrator explicitly.

This replaces the old lifespan seed: a fresh install no longer gets an admin
with a known default password. Run from ``src/backend``:

    python -m scripts.create_admin --email admin@example.com --name "Admin"

If ``--password`` is omitted, it is prompted without echoing. Prefer the prompt
on a shared shell; the flag exists for automation.
"""

import argparse
import getpass
import sys

from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import User
from app.schemas.common import _validate_password_strength
from app.services.auth import get_password_hash


def create_admin(db: Session, email: str, name: str, password: str) -> tuple[User, bool]:
    """Create a new admin or promote/reset an existing user. Returns (user, created)."""
    email = email.strip().lower()
    user = db.query(User).filter(User.email == email).first()
    created = user is None
    if user is None:
        user = User(
            email=email,
            full_name=name,
            hashed_password=get_password_hash(password),
            email_verified=True,
            is_admin=True,
        )
        db.add(user)
    else:
        user.full_name = name or user.full_name
        user.hashed_password = get_password_hash(password)
        user.email_verified = True
        user.is_admin = True
        user.is_active = True
        user.is_blocked = False
    db.commit()
    db.refresh(user)
    return user, created


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Create or promote an administrator.")
    parser.add_argument("--email", required=True)
    parser.add_argument("--name", default="Admin")
    parser.add_argument(
        "--password",
        help="Password. Omit it to be prompted without echoing.",
    )
    args = parser.parse_args(argv)

    if not args.email.strip() or "@" not in args.email:
        print("Email inválido.", file=sys.stderr)
        return 2

    password = args.password or getpass.getpass("Password: ")
    try:
        _validate_password_strength(password)
    except ValueError as exc:
        print(f"Password inválida: {exc}", file=sys.stderr)
        return 2

    db = SessionLocal()
    try:
        user, created = create_admin(db, args.email, args.name, password)
    finally:
        db.close()

    print(f"Administrador {'creado' if created else 'actualizado'}: {user.email} (id={user.id})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
