"""문의 표와 알림 인덱스.

두 가지를 더합니다.

1. `contact_messages` — `/contact` 폼이 `mailto:` 를 여는 대신 표에 담습니다.
   메일 앱이 걸려 있지 않은 기기에서 문의가 조용히 사라지던 문제입니다.
2. `ix_notifications_user_unread` — 머리글의 안 읽은 알림 배지가 쓰는 `COUNT`
   질의가 그 사람 알림 전체를 훑지 않도록 합니다.

첫 마이그레이션이 `Base.metadata.create_all` 이라 **빈 데이터베이스에 올리면
모델 그대로 만들어집니다.** 그래서 `20260825_link_visibility.py` 와 같은 방식으로
이미 있으면 건너뛰는 가드를 둡니다.
"""

import sqlalchemy as sa
from alembic import op

revision = "20260830_contact"
down_revision = "20260829_res_controls"
branch_labels = None
depends_on = None


def _has_table(name: str) -> bool:
    return name in sa.inspect(op.get_bind()).get_table_names()


def _has_index(table: str, name: str) -> bool:
    if not _has_table(table):
        return False
    return any(index["name"] == name for index in sa.inspect(op.get_bind()).get_indexes(table))


def upgrade() -> None:
    if not _has_table("contact_messages"):
        op.create_table(
            "contact_messages",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("name", sa.String(length=80), nullable=False, server_default=""),
            sa.Column("reply_to", sa.String(length=200), nullable=False, server_default=""),
            sa.Column("subject", sa.String(length=160), nullable=False, server_default=""),
            sa.Column("message", sa.Text(), nullable=False, server_default=""),
            sa.Column("is_read", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("handled_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("handled_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        )
    if not _has_index("contact_messages", "ix_contact_unread_recent"):
        op.create_index("ix_contact_unread_recent", "contact_messages", ["is_read", "created_at"])
    if not _has_index("notifications", "ix_notifications_user_unread"):
        op.create_index("ix_notifications_user_unread", "notifications", ["user_id", "is_read"])


def downgrade() -> None:
    if _has_index("notifications", "ix_notifications_user_unread"):
        op.drop_index("ix_notifications_user_unread", table_name="notifications")
    if _has_index("contact_messages", "ix_contact_unread_recent"):
        op.drop_index("ix_contact_unread_recent", table_name="contact_messages")
    if _has_table("contact_messages"):
        op.drop_table("contact_messages")
