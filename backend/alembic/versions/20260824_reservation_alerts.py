"""예약 알림을 한 번만 보내도록 표시할 칸을 더한다

Revision ID: 20260824_res_alerts
Revises: 20260824_equip_name
Create Date: 2026-08-24

사용 시작 시각과 사용 종료 뒤 사진 요청은 시간이 되면 보내는 알림이다. 보낸 적이
있는지 적어 두지 않으면 확인할 때마다 같은 알림이 다시 나간다.
"""

import sqlalchemy as sa

from alembic import op

revision = "20260824_res_alerts"
down_revision = "20260824_equip_name"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("reservations", sa.Column("start_notified_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("reservations", sa.Column("photo_notified_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("reservations", "photo_notified_at")
    op.drop_column("reservations", "start_notified_at")
