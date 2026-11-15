"""fx_rates and the expense rate snapshot

Stores the daily BNA rate so a historical total does not change with today's
rate, and keeps the rate used by each USD expense on the row itself.

Revision ID: 000000000004
Revises: 000000000003
Create Date: 2026-11-15
"""

from collections.abc import Sequence

from alembic import op

revision: str = "000000000004"
down_revision: str | Sequence[str] | None = "000000000003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS fx_rates (
            id SERIAL PRIMARY KEY,
            date DATE NOT NULL,
            source VARCHAR(20) NOT NULL DEFAULT 'BNA',
            base VARCHAR(3) NOT NULL DEFAULT 'USD',
            quote VARCHAR(3) NOT NULL DEFAULT 'ARS',
            rate DOUBLE PRECISION NOT NULL,
            fetched_at TIMESTAMP NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_fx_rates_date_source_pair "
        "ON fx_rates (date, source, base, quote)"
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_fx_rates_date ON fx_rates (date)")

    op.execute("ALTER TABLE expenses ADD COLUMN IF NOT EXISTS fx_rate DOUBLE PRECISION")
    op.execute("ALTER TABLE expenses ADD COLUMN IF NOT EXISTS fx_rate_date DATE")
    op.execute("ALTER TABLE expenses ADD COLUMN IF NOT EXISTS fx_rate_source VARCHAR(20)")


def downgrade() -> None:
    op.execute("ALTER TABLE expenses DROP COLUMN IF EXISTS fx_rate_source")
    op.execute("ALTER TABLE expenses DROP COLUMN IF EXISTS fx_rate_date")
    op.execute("ALTER TABLE expenses DROP COLUMN IF EXISTS fx_rate")
    op.execute("DROP TABLE IF EXISTS fx_rates")
