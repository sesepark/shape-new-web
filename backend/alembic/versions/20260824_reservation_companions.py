"""공동 사용자를 담는 표를 만든다

Revision ID: 20260824_companions
Revises: 20260824_before_photo
Create Date: 2026-08-24

장비 하나를 여러 명이 함께 쓰는 경우가 있다. 예전에는 신청한 사람만 남아서,
예약 현황만 보고는 실제로 누가 함께 쓰는지 알 수 없었다. 사고나 파손이 있을 때
누구에게 물어봐야 하는지도 알 수 없다.

신청한 사람(reservations.user_id)은 그대로 두고, 함께 쓰는 사람만 여기에 담는다.
"""

import sqlalchemy as sa

from alembic import op

revision = "20260824_companions"
down_revision = "20260824_before_photo"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "reservation_companions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("reservation_id", sa.Uuid(), sa.ForeignKey("reservations.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.UniqueConstraint("reservation_id", "user_id", name="uq_reservation_companion"),
    )


def downgrade() -> None:
    op.drop_table("reservation_companions")
