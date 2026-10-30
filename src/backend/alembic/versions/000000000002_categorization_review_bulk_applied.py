"""categorization_reviews.bulk_applied

Flags reviews accepted from the admin UI's bulk action so they do not feed the
manual precision of the detector.

Revision ID: 000000000002
Revises: 000000000001
Create Date: 2026-10-29
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "000000000002"
down_revision: Union[str, Sequence[str], None] = "000000000001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "categorization_reviews",
        sa.Column("bulk_applied", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )


def downgrade() -> None:
    op.drop_column("categorization_reviews", "bulk_applied")
