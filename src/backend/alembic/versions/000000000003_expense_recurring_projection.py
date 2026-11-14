"""expenses.is_recurring_projection

Marks expenses that were materialized automatically from a recurring charge and
have not been reconciled against a real imported statement row yet.

Revision ID: 000000000003
Revises: 000000000002
Create Date: 2026-11-10
"""

from collections.abc import Sequence

from alembic import op

revision: str = "000000000003"
down_revision: str | Sequence[str] | None = "000000000002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # IF NOT EXISTS keeps this revision compatible with the idempotent bridge
    # script used by migrations.yml (which may run before Alembic).
    op.execute(
        "ALTER TABLE expenses "
        "ADD COLUMN IF NOT EXISTS is_recurring_projection BOOLEAN NOT NULL DEFAULT false"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE expenses DROP COLUMN IF EXISTS is_recurring_projection")
