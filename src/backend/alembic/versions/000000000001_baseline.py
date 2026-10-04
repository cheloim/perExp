"""baseline: current schema

This migration marks the current database schema as the Alembic baseline.
All tables already exist (created by app.database.Base.metadata.create_all).
No actual DDL is executed — this is a reference point for future migrations.

Revision ID: 000000000001
Revises:
Create Date: 2026-10-04
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "000000000001"
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No-op — all tables already exist."""
    pass


def downgrade() -> None:
    """No-op — baseline cannot be downgraded."""
    pass