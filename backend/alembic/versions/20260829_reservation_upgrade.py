"""예약에 분류·시급도·덧붙일 말을 더하고, 시계가 결정한 자국을 남긴다

Revision ID: 20260829_res_upgrade
Revises: 20260825_audit
Create Date: 2026-08-29

같은 시간에 신청이 둘 겹쳤을 때 운영진이 무엇을 보고 고를지가 없었다. 자유서술
한 줄만으로는 대회 마감 때문에 오늘이어야 하는 신청과 다음 주에 해도 되는 연습이
똑같아 보인다. 그래서 축을 둘 세운다 — **분류**(무엇을 위한 것인가)와
**시급도**(얼마나 급한가)다.

기존 `purpose` 칸은 `note` 로 이름을 바꾼다. 새로 들어오는 `purpose_category` 가
진짜 '사용 목적' 이라, 옛 이름을 그대로 두면 `purpose` 는 덧붙인 말이고
`purpose_category` 가 목적인 상태가 된다. 다음에 이 표를 읽는 사람이 반드시
헷갈린다. 이름만 바꾸는 것이라 적혀 있던 내용은 그대로 살아남는다.

이미 있는 예약은 분류를 알 길이 없다. 없는 값을 지어내는 대신 '기타'·'보통' 에
둔다 — "그때는 묻지 않았다" 는 뜻이다.

`EXPIRED` 는 아무도 손대지 않은 채 사용 시간이 다 지나간 신청이 갈 자리다.
`CANCELLED` 로 뭉뚱그리면 '사람이 물린 것' 과 '그냥 지나간 것' 이 관리자 목록에서
구분되지 않는다.

인덱스 하나를 더한다. 대기 신청을 호기별로 훑는 질의가 셋 생겼다 — 예약 가능
시간의 대기 표시, 관리 목록의 겹침 찾기, 자동 확정이다. `equipment_unit_id`
단독 인덱스로는 상태와 시각까지 걸러 내지 못한다.
"""

import sqlalchemy as sa

from alembic import op
from app.models import UtcDateTime

revision = "20260829_res_upgrade"
down_revision = "20260825_audit"
branch_labels = None
depends_on = None

# 이름을 명시한다. 주지 않으면 SQLAlchemy 가 파이썬 클래스 이름에서 만들어 내는데,
# 그 규칙에 기대면 모델 쪽 이름을 바꾸는 순간 이 파일과 어긋난다.
PURPOSE = sa.Enum("CONTEST", "SHAPE_UP", "EDUCATION", "OTHER", name="reservationpurpose")
URGENCY = sa.Enum("HIGH", "NORMAL", "LOW", name="reservationurgency")

INDEX_NAME = "ix_reservations_unit_pending"


def has_column(bind, table: str, name: str) -> bool:
    """이미 칸이 있는지.

    첫 마이그레이션이 `Base.metadata.create_all` 이라 **빈 데이터베이스에 올리면
    지금 모델 그대로** 만들어진다. 그 뒤로 칸을 더하는 마이그레이션은 이미 있는
    칸을 또 만들려다 멈춘다(`20260825_link_visibility.py` 와 같은 사정).
    """
    return any(column["name"] == name for column in sa.inspect(bind).get_columns(table))


def upgrade() -> None:
    bind = op.get_bind()

    # 상태 목록에 값을 하나 더한다. PostgreSQL 에서는 타입을 고치는 일이라
    # 따로 문장을 낸다. 값을 **추가만** 하고 같은 트랜잭션 안에서 쓰지는 않으므로
    # PG12 이상에서 안전하다. SQLite 는 enum 을 VARCHAR 로 흉내 내 할 일이 없다.
    if bind.dialect.name == "postgresql":
        op.execute("ALTER TYPE reservationstatus ADD VALUE IF NOT EXISTS 'EXPIRED'")

    if has_column(bind, "reservations", "purpose") and not has_column(bind, "reservations", "note"):
        op.alter_column("reservations", "purpose", new_column_name="note")

    if not has_column(bind, "reservations", "purpose_category"):
        # PostgreSQL 은 컬럼을 만들기 전에 타입이 있어야 한다.
        PURPOSE.create(bind, checkfirst=True)
        URGENCY.create(bind, checkfirst=True)
        # NOT NULL 에 server_default 가 붙어 있으므로, 이미 있는 행은 이 한
        # 문장으로 채워진다. 따로 UPDATE 를 돌릴 필요가 없다.
        op.add_column("reservations", sa.Column("purpose_category", PURPOSE, nullable=False, server_default="OTHER"))
        op.add_column("reservations", sa.Column("urgency", URGENCY, nullable=False, server_default="NORMAL"))

    for name in ("staff_reminded_at", "auto_decided_at"):
        if not has_column(bind, "reservations", name):
            op.add_column("reservations", sa.Column(name, UtcDateTime(), nullable=True))
    if not has_column(bind, "reservations", "recurrence_group_id"):
        op.add_column("reservations", sa.Column("recurrence_group_id", sa.Uuid(), nullable=True))
        op.create_index("ix_reservations_recurrence", "reservations", ["recurrence_group_id"], if_not_exists=True)

    op.create_index(INDEX_NAME, "reservations", ["equipment_unit_id", "status", "starts_at"], if_not_exists=True)


def downgrade() -> None:
    """되돌린다. 다만 `EXPIRED` 만은 남는다.

    PostgreSQL 은 enum 에서 값 하나만 빼는 방법을 주지 않는다(타입을 새로 만들어
    옮겨 붙여야 한다). 쓰지 않는 값이 목록에 하나 남아 있는 것은 해가 없으므로
    그대로 둔다. 되돌린 뒤에도 `EXPIRED` 인 행이 남아 있으면 그 행만 손으로
    `CANCELLED` 로 옮겨야 한다.
    """
    bind = op.get_bind()
    op.drop_index(INDEX_NAME, table_name="reservations", if_exists=True)
    if has_column(bind, "reservations", "recurrence_group_id"):
        op.drop_index("ix_reservations_recurrence", table_name="reservations", if_exists=True)
        op.drop_column("reservations", "recurrence_group_id")
    for name in ("auto_decided_at", "staff_reminded_at"):
        if has_column(bind, "reservations", name):
            op.drop_column("reservations", name)
    if has_column(bind, "reservations", "purpose_category"):
        op.drop_column("reservations", "urgency")
        op.drop_column("reservations", "purpose_category")
        URGENCY.drop(bind, checkfirst=True)
        PURPOSE.drop(bind, checkfirst=True)
    if has_column(bind, "reservations", "note") and not has_column(bind, "reservations", "purpose"):
        op.alter_column("reservations", "note", new_column_name="purpose")
