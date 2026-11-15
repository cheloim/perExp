"""categorization_reviews.bulk_applied

Flags reviews accepted from the admin UI's bulk action so they do not feed the
manual precision of the detector.

Revision ID: 000000000002
Revises: 000000000001
Create Date: 2026-10-29
"""

from collections.abc import Sequence

from alembic import op

revision: str = "000000000002"
down_revision: str | Sequence[str] | None = "000000000001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # IF NOT EXISTS: el baseline crea el esquema desde los modelos actuales, que
    # ya incluyen esta columna. También lo usa el puente idempotente de
    # migrations.yml cuando corre antes que Alembic.
    op.execute(
        "ALTER TABLE categorization_reviews "
        "ADD COLUMN IF NOT EXISTS bulk_applied BOOLEAN NOT NULL DEFAULT false"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE categorization_reviews DROP COLUMN IF EXISTS bulk_applied")
