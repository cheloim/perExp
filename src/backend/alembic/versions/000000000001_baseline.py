"""baseline: current schema

This revision bootstraps the schema from the SQLAlchemy models. It is
**idempotent**: on an existing database `create_all(checkfirst=True)` only
creates what is missing, and revisions 2/3 add the columns that the ad-hoc
scripts introduced before Alembic was adopted.

Revision ID: 000000000001
Revises:
Create Date: 2026-10-04
"""

from collections.abc import Sequence

from alembic import op

revision: str = "000000000001"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Import acá adentro para que `alembic history`/`check` no carguen modelos
    # innecesariamente, y porque el baseline sólo debe tocar la base al correr.
    import app.models  # noqa: F401 — registra las tablas en Base.metadata
    from app.database import Base

    Base.metadata.create_all(bind=op.get_bind(), checkfirst=True)


def downgrade() -> None:
    """Un baseline no se revierte: borraría toda la base."""
    pass
