"""link roadmap projects to the members working on them

Revision ID: 20260823_roadmap_members
Revises: 20260822_notice_category
Create Date: 2026-08-23
"""

import sqlalchemy as sa
from alembic import op

revision = "20260823_roadmap_members"
down_revision = "20260822_notice_category"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # The initial migration builds the whole ORM metadata, so a fresh database
    # already has this table; only an existing deployment needs the create.
    if "roadmap_members" in sa.inspect(op.get_bind()).get_table_names():
        return
    op.create_table(
        "roadmap_members",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("roadmap_item_id", sa.Uuid(), sa.ForeignKey("roadmap_items.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("roadmap_item_id", "user_id", name="uq_roadmap_member"),
    )
    op.create_index("ix_roadmap_members_roadmap_item_id", "roadmap_members", ["roadmap_item_id"])
    op.create_index("ix_roadmap_members_user_id", "roadmap_members", ["user_id"])


def downgrade() -> None:
    if "roadmap_members" in sa.inspect(op.get_bind()).get_table_names():
        op.drop_table("roadmap_members")
