"""알림에 갈 곳을 담는 칸을 더한다

Revision ID: 20260824_notif_url
Revises: 20260824_viewer
Create Date: 2026-08-24

알림은 지금까지 게시판 공지뿐이어서 누르면 무조건 /notices 로 갔다. 장비 예약
신청 알림이 운영진에게 가면서, 알림마다 갈 곳이 달라졌다. 비어 있으면 예전처럼
게시판으로 간다.
"""

import sqlalchemy as sa

from alembic import op

revision = "20260824_notif_url"
down_revision = "20260824_viewer"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("notifications", sa.Column("url", sa.String(length=300), nullable=True))


def downgrade() -> None:
    op.drop_column("notifications", "url")
