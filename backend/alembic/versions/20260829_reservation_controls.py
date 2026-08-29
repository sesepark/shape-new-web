"""운영진이 시간을 막고, 예약 규칙을 화면에서 조절할 수 있게 한다

Revision ID: 20260829_res_controls
Revises: 20260829_res_upgrade
Create Date: 2026-08-29

부원이 100명 가까이 되면서 두 가지가 막힌다.

**시간을 막을 수단이 없었다.** 지금까지 방법은 장비 **전체**를 `MAINTENANCE` 로
돌리는 것뿐이라, 목요일 저녁 교육 실습 때문에 SO-ARM 을 막으려면 나머지 엿새까지
함께 닫혔다. 그래서 실제로는 아무도 그 방법을 쓰지 못했고, "그 시간대 개인 예약은
피해 주세요" 라는 문장이 장비 설명에 **글로만** 남아 있었다. `reservation_blackouts`
가 그 문장을 규칙으로 바꾼다.

규칙의 모양은 하나뿐이다 — **요일 집합 + 시각 범위 + 날짜 범위**. 하루만 막는 것은
시작 날짜와 끝 날짜를 같은 날로 두면 되고, 사흘 내리 막는 것은 요일 일곱 개를 모두
고르고 시각을 0~24시로 두면 된다. 모양이 하나면 겹침을 따지는 코드도 화면도 하나뿐
이고, 바로 위에 있는 정기 예약 입력과 생김새가 같아진다.

시각을 `Integer` 로 두는 것은 **한국 시각 자정에서부터 잰 분**이기 때문이다.
`TIMESTAMPTZ` 로 두면 "매주 목요일 19시" 를 적을 수 없고, UTC 로 재면 날짜 경계가
아홉 시간 밀려 목요일 저녁이 수요일로 넘어간다.

**규칙 값이 코드에 박혀 있었다.** 자동 확정 한 시간, 운영진 독촉 두 시간, 사용 시작
10분 전, 사진 독촉 30분, 한 건 12시간, 180일 앞까지, 정기 예약 30건. 운영을 맡은
사람이 학기 사정에 맞춰 조절하려면 코드를 고치고 다시 배포해야 했다.
`reservation_policy` 는 **행이 하나뿐인 표**다. UUID 를 쓰면 "어느 행이 진짜인가" 를
매번 정해야 하는데, 설정은 하나여야 뜻이 분명하므로 `id` 를 1 로 고정한다.

행은 여기서 만들지 않는다. 관리자 화면이 처음 열릴 때 기본값으로 만들어지고, 그
전까지는 읽는 쪽이 코드의 기본값을 쓴다(`services/reservation_policy.py`). 그래야
이 마이그레이션이 값을 하나도 지어내지 않는다.
"""

import sqlalchemy as sa

from alembic import op

revision = "20260829_res_controls"
down_revision = "20260829_res_upgrade"
branch_labels = None
depends_on = None

BLACKOUTS = "reservation_blackouts"
POLICY = "reservation_policy"


def has_table(bind, name: str) -> bool:
    """이미 표가 있는지.

    첫 마이그레이션이 `Base.metadata.create_all` 이라 **빈 데이터베이스에 올리면
    지금 모델 그대로** 만들어진다. 그러면 여기서 같은 표를 또 만들려다 멈춘다.
    앞선 마이그레이션들이 칸 단위로 같은 확인을 하는 것과 같은 사정이다.
    """
    return name in sa.inspect(bind).get_table_names()


def upgrade() -> None:
    bind = op.get_bind()

    if not has_table(bind, BLACKOUTS):
        op.create_table(
            BLACKOUTS,
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("equipment_id", sa.Uuid(), sa.ForeignKey("equipment.id", ondelete="CASCADE"), nullable=False),
            # 비어 있으면 그 장비의 모든 호기를 막는다.
            sa.Column("equipment_unit_id", sa.Uuid(), sa.ForeignKey("equipment_units.id", ondelete="CASCADE")),
            sa.Column("reason", sa.String(length=200), nullable=False, server_default=""),
            # 0=월요일. 파이썬 `date.weekday()` 와 같은 기준이다.
            sa.Column("weekdays", sa.JSON(), nullable=False),
            sa.Column("start_minute", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("end_minute", sa.Integer(), nullable=False, server_default="1440"),
            sa.Column("from_date", sa.Date(), nullable=False),
            sa.Column("until_date", sa.Date(), nullable=False),
            sa.Column("created_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL")),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )
        # 예약 가능 시간 창구가 **장비 단위로** 한 번만 읽고 호기별 판정은
        # 파이썬이 한다. 그래서 날짜 범위와 장비를 함께 거르는 인덱스를 둔다.
        op.create_index("ix_blackouts_equipment_span", BLACKOUTS, ["equipment_id", "from_date", "until_date"])
        op.create_index("ix_blackouts_unit", BLACKOUTS, ["equipment_unit_id"])

    if not has_table(bind, POLICY):
        op.create_table(
            POLICY,
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("auto_approve_minutes", sa.Integer(), nullable=False, server_default="60"),
            sa.Column("staff_reminder_minutes", sa.Integer(), nullable=False, server_default="120"),
            sa.Column("start_grace_minutes", sa.Integer(), nullable=False, server_default="10"),
            sa.Column("before_photo_grace_minutes", sa.Integer(), nullable=False, server_default="30"),
            sa.Column("max_hours", sa.Integer(), nullable=False, server_default="12"),
            sa.Column("booking_window_days", sa.Integer(), nullable=False, server_default="180"),
            sa.Column("recurring_max", sa.Integer(), nullable=False, server_default="30"),
            sa.Column("updated_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL")),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )


def downgrade() -> None:
    """되돌리면 막아 둔 시간과 고쳐 둔 정책이 함께 사라진다.

    정책은 사라져도 코드의 기본값이 그 자리를 채우므로 예약은 계속 돌아간다.
    사용 제한은 표가 없어지면 그 시간이 다시 열린다 — 되돌리기 전에 알고 있어야
    하는 부분이라 여기 적어 둔다.
    """
    bind = op.get_bind()
    if has_table(bind, POLICY):
        op.drop_table(POLICY)
    if has_table(bind, BLACKOUTS):
        op.drop_index("ix_blackouts_unit", table_name=BLACKOUTS)
        op.drop_index("ix_blackouts_equipment_span", table_name=BLACKOUTS)
        op.drop_table(BLACKOUTS)
