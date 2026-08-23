"""board posts written by members, with one level of comments

Revision ID: 20260823_board
Revises: 20260823_member_intro
Create Date: 2026-08-23
"""

import sqlalchemy as sa
from alembic import op

revision = "20260823_board"
down_revision = "20260823_member_intro"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "author_id" not in {column["name"] for column in inspector.get_columns("notices")}:
        op.add_column("notices", sa.Column("author_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True))
        op.create_index("ix_notices_author_id", "notices", ["author_id"])
    if "comments" not in inspector.get_table_names():
        op.create_table(
            "comments",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("notice_id", sa.Uuid(), sa.ForeignKey("notices.id", ondelete="CASCADE"), nullable=False),
            sa.Column("parent_id", sa.Uuid(), sa.ForeignKey("comments.id", ondelete="CASCADE"), nullable=True),
            sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("body", sa.Text(), nullable=False),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )
        op.create_index("ix_comments_notice_id", "comments", ["notice_id"])
        op.create_index("ix_comments_parent_id", "comments", ["parent_id"])


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "comments" in inspector.get_table_names():
        op.drop_table("comments")
    if "author_id" in {column["name"] for column in inspector.get_columns("notices")}:
        op.drop_column("notices", "author_id")
