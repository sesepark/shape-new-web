"""add board post category

Revision ID: 20260822_notice_category
Revises: 20260822_initial
Create Date: 2026-08-22
"""

from alembic import op
import sqlalchemy as sa

revision = "20260822_notice_category"
down_revision = "20260822_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # The initial migration builds the ORM metadata for new deployments.  Check
    # first so both a fresh database and an already-deployed database migrate
    # safely without attempting the same column twice.
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("notices")}
    if "category" not in columns:
        op.add_column("notices", sa.Column("category", sa.String(length=20), nullable=False, server_default="일반"))
        op.alter_column("notices", "category", server_default=None)


def downgrade() -> None:
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("notices")}
    if "category" in columns:
        op.drop_column("notices", "category")
