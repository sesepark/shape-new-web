"""SHAPE-UP team results, written by members and shown publicly

Revision ID: 20260823_shapeup
Revises: 20260823_resources
Create Date: 2026-08-23
"""

import sqlalchemy as sa
from alembic import op

revision = "20260823_shapeup"
down_revision = "20260823_resources"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if "shape_up_posts" in sa.inspect(op.get_bind()).get_table_names():
        return
    op.create_table(
        "shape_up_posts",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("author_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False, server_default=""),
        sa.Column("cohort", sa.String(length=20), nullable=False, server_default=""),
        sa.Column("team_name", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("team_members", sa.JSON(), nullable=False),
        sa.Column("cover_image", sa.String(length=1000), nullable=True),
        sa.Column("content_json", sa.JSON(), nullable=False),
        sa.Column("content_html", sa.Text(), nullable=False, server_default=""),
        sa.Column("github_url", sa.String(length=1000), nullable=True),
        sa.Column("video_url", sa.String(length=1000), nullable=True),
        sa.Column("is_published", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_shape_up_posts_author_id", "shape_up_posts", ["author_id"])


def downgrade() -> None:
    if "shape_up_posts" in sa.inspect(op.get_bind()).get_table_names():
        op.drop_table("shape_up_posts")
