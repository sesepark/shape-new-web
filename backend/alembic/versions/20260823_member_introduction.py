"""let a member write their own one-line introduction

Revision ID: 20260823_member_intro
Revises: 20260823_roadmap_members
Create Date: 2026-08-23
"""

import sqlalchemy as sa
from alembic import op

revision = "20260823_member_intro"
down_revision = "20260823_roadmap_members"
branch_labels = None
depends_on = None


def upgrade() -> None:
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("users")}
    if "introduction" not in columns:
        op.add_column("users", sa.Column("introduction", sa.Text(), nullable=True))


def downgrade() -> None:
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("users")}
    if "introduction" in columns:
        op.drop_column("users", "introduction")
