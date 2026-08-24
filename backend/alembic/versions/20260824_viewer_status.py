"""계정 상태에 VIEWER 를 더한다

Revision ID: 20260824_viewer
Revises: 20260824_list_indexes
Create Date: 2026-08-24

멤버(직전 학기에는 활동했지만 이번 학기에는 활동하지 않는 인원)에게 줄 등급이다.
로그인해서 공지·자료실·예약 현황을 **보기만** 하고, 글쓰기·댓글·예약 신청은 하지
않는다. 승인 회원(APPROVED)과 정지(SUSPENDED) 사이의 자리다.

PostgreSQL 은 상태를 네이티브 enum 으로 들고 있어 값을 하나 더 붙여야 한다.
PostgreSQL 12 부터는 트랜잭션 안에서도 `ADD VALUE` 가 되고, 다만 그 트랜잭션이
끝나기 전에는 새 값을 쓸 수 없다. 이 마이그레이션은 값만 더하고 쓰지는 않으므로
그대로 둔다. SQLite 는 enum 을 VARCHAR 로 저장해 할 일이 없다.
"""

import sqlalchemy as sa
from alembic import op

revision = "20260824_viewer"
down_revision = "20260824_list_indexes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.execute("ALTER TYPE userstatus ADD VALUE IF NOT EXISTS 'VIEWER'")


def downgrade() -> None:
    """enum 값은 되돌리지 않는다.

    PostgreSQL 은 enum 값을 지우는 문법이 없다. 타입을 새로 만들어 갈아 끼워야
    하는데, 그 사이 VIEWER 로 저장된 회원이 갈 곳이 없어진다. 되돌릴 일이
    생기면 먼저 그 회원들을 다른 상태로 옮긴 뒤 손으로 처리한다.
    """
    _ = sa
