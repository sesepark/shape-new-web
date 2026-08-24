"""사용 전 사진 재촉 알림을 한 번만 보내도록 표시할 칸

Revision ID: 20260824_before_photo
Revises: 20260824_res_alerts
Create Date: 2026-08-24

사용 시간이 지났는데 사용 전 사진이 없으면 한 번 더 알린다. 보낸 적이 있는지
적어 두지 않으면 확인할 때마다 같은 알림이 다시 나간다.
"""

import sqlalchemy as sa

from alembic import op

revision = "20260824_before_photo"
down_revision = "20260824_res_alerts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("reservations", sa.Column("before_photo_notified_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("reservations", "before_photo_notified_at")
