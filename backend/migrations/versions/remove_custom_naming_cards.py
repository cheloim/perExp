"""remove custom_naming from cards

Revision ID: remove_custom_naming_cards
Revises: 6e6e66850562
Create Date: 2026-06-11 20:10:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'remove_custom_naming_cards'
down_revision = '6e6e66850562'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column('cards', 'custom_naming')


def downgrade() -> None:
    op.add_column('cards', sa.Column('custom_naming', sa.String(), nullable=False))