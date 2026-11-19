"""budgets.currency and budget_groups.currency

A budget declares the currency its amount is expressed in. Existing rows are
ARS, matching the previous implicit behaviour. Mixed-currency sets are rejected
at the API so a summary total always has one unit.

Revision ID: 000000000006
Revises: 000000000005
Create Date: 2026-11-19
"""

from collections.abc import Sequence

from alembic import op

revision: str = "000000000006"
down_revision: str | Sequence[str] | None = "000000000005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE budgets ADD COLUMN IF NOT EXISTS currency VARCHAR(3) "
        "NOT NULL DEFAULT 'ARS'"
    )
    op.execute(
        "ALTER TABLE budget_groups ADD COLUMN IF NOT EXISTS currency VARCHAR(3) "
        "NOT NULL DEFAULT 'ARS'"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE budget_groups DROP COLUMN IF EXISTS currency")
    op.execute("ALTER TABLE budgets DROP COLUMN IF EXISTS currency")
