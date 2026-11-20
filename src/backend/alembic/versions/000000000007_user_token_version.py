"""users.token_version: invalidate access tokens

Password reset/change, logout-all and blocking bump this counter. Access JWTs
carry the value they were issued with, so older tokens fail immediately
instead of remaining valid for the rest of their hour.

Revision ID: 000000000007
Revises: 000000000006
Create Date: 2026-11-20
"""

from collections.abc import Sequence

from alembic import op

revision: str = "000000000007"
down_revision: str | Sequence[str] | None = "000000000006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER "
        "NOT NULL DEFAULT 0"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS token_version")
