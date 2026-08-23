"""shared file library for 자료실

Revision ID: 20260823_resources
Revises: 20260823_board
Create Date: 2026-08-23
"""

import sqlalchemy as sa
from alembic import op

revision = "20260823_resources"
down_revision = "20260823_board"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if "resources" in sa.inspect(op.get_bind()).get_table_names():
        return
    op.create_table(
        "resources",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("author_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("category", sa.String(length=40), nullable=False, server_default="기타"),
        sa.Column("file_url", sa.String(length=1000), nullable=True),
        sa.Column("file_name", sa.String(length=255), nullable=True),
        sa.Column("file_size", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("link_url", sa.String(length=1000), nullable=True),
        sa.Column("is_public", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_resources_author_id", "resources", ["author_id"])


def downgrade() -> None:
    if "resources" in sa.inspect(op.get_bind()).get_table_names():
        op.drop_table("resources")
