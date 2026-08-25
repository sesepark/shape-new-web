"""운영진의 수정 내역을 남길 표를 만든다

Revision ID: 20260825_audit
Revises: 20260825_link_vis
Create Date: 2026-08-25

누가 언제 무엇을 고쳤는지 남길 곳이 없었다. 관리자 화면에서 일어난 쓰기를
빠짐없이 여기에 쌓는다(`app/services/audit.py`).

이름과 이메일을 회원 표에서 이어 붙이지 않고 **그때 값을 그대로 박아 둔다.**
회원이 탈퇴하거나 이름을 바꾸면 지난 기록까지 함께 바뀌기 때문이다. 수정 내역은
그 시점을 남기는 것이므로 그러면 안 된다. `actor_id` 는 같은 사람의 기록을 모아
보려고 함께 두고, 회원이 지워지면 NULL 이 된다.

인덱스 둘. 목록이 최신순이라 `created_at`, 사람으로 거를 때 쓰는 `actor_id` 다.
"""

import sqlalchemy as sa
from alembic import op

from app.models import UtcDateTime

revision = "20260825_audit"
down_revision = "20260825_link_vis"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "audit_logs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("created_at", UtcDateTime(), nullable=False),
        sa.Column("actor_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("actor_name", sa.String(120), nullable=False, server_default=""),
        sa.Column("actor_email", sa.String(320), nullable=False, server_default=""),
        sa.Column("action", sa.String(20), nullable=False, server_default="update"),
        sa.Column("area", sa.String(40), nullable=False, server_default=""),
        sa.Column("target", sa.String(200), nullable=False, server_default=""),
        sa.Column("detail", sa.String(400), nullable=False, server_default=""),
        sa.Column("method", sa.String(10), nullable=False, server_default=""),
        sa.Column("path", sa.String(300), nullable=False, server_default=""),
    )
    op.create_index("ix_audit_logs_created_at", "audit_logs", ["created_at"], if_not_exists=True)
    op.create_index("ix_audit_logs_actor_id", "audit_logs", ["actor_id"], if_not_exists=True)


def downgrade() -> None:
    op.drop_index("ix_audit_logs_actor_id", table_name="audit_logs", if_exists=True)
    op.drop_index("ix_audit_logs_created_at", table_name="audit_logs", if_exists=True)
    op.drop_table("audit_logs")
