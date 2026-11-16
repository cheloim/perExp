"""expenses.search_grams: blind n-gram index for free-text search

Search used to decrypt every expense of the group on each keystroke. This
column stores HMACs of the 2- and 3-grams of description + notes, so a GIN
index narrows the candidates and only those rows are decrypted and verified.
The column starts NULL and the application backfills it with the encryption
key at startup; the migration deliberately does not decrypt data.

Revision ID: 000000000005
Revises: 000000000004
Create Date: 2026-11-16
"""

from collections.abc import Sequence

from alembic import op

revision: str = "000000000005"
down_revision: str | Sequence[str] | None = "000000000004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TABLE expenses ADD COLUMN IF NOT EXISTS search_grams TEXT")
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_expenses_search_grams_tsv "
        "ON expenses USING gin (to_tsvector('simple'::regconfig, search_grams))"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_expenses_search_grams_tsv")
    op.execute("ALTER TABLE expenses DROP COLUMN IF EXISTS search_grams")
