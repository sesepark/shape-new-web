"""SHAPE-UP 결과물을 논문 프로젝트 페이지 형식으로.

자유 편집기 본문(`content_json`·`content_html`) 하나를 정해진 칸으로 나눕니다.
왜 그렇게 하는지는 `models.ShapeUpPost` 설명에 있습니다.

## 본문을 옮기지 않고 버립니다

**결과물이 아직 한 건도 없어서** 옮길 것이 없습니다(운영 API 로 확인했습니다).
글이 있는 상태에서 이 마이그레이션을 돌리면 본문이 사라지므로, 되돌리기
(`downgrade`)는 칸을 되살리기만 하고 **내용은 되돌리지 못합니다** — 그 사실을
여기 적어 둡니다.

첫 마이그레이션이 `Base.metadata.create_all` 이라 빈 데이터베이스에 올리면 모델
그대로 만들어집니다. 그래서 칸마다 있는지 보고 건너뜁니다.
"""

import sqlalchemy as sa
from alembic import op

revision = "20260830_shapeup_paper"
down_revision = "20260830_contact"
branch_labels = None
depends_on = None

TABLE = "shape_up_posts"
# (칸 이름, 형, 기본값) — 모델과 같은 모양이어야 합니다.
ADDED = [
    ("slides_url", sa.String(length=1000), None),
    ("abstract", sa.Text(), ""),
    ("problem", sa.Text(), ""),
    ("limitations", sa.Text(), ""),
    ("method_blocks", sa.JSON(), "[]"),
    ("result_blocks", sa.JSON(), "[]"),
]
DROPPED = ["content_json", "content_html"]


def _columns() -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(TABLE)}


def upgrade() -> None:
    have = _columns()
    for name, kind, default in ADDED:
        if name in have:
            continue
        # 기본값이 없는 칸(발표자료 주소)은 비워 둘 수 있어야 합니다. 조건을
        # 거꾸로 쓰면 NOT NULL 이 되어, 발표자료를 안 낸 팀의 글이 저장되지
        # 않습니다(실제로 그렇게 걸렸습니다).
        op.add_column(TABLE, sa.Column(
            name, kind,
            nullable=default is None,
            server_default=sa.text(f"'{default}'") if default is not None else None,
        ))
    for name in DROPPED:
        if name in have:
            op.drop_column(TABLE, name)


def downgrade() -> None:
    """칸은 되살리지만 **본문 내용은 되돌아오지 않습니다**(위 설명)."""
    have = _columns()
    if "content_json" not in have:
        op.add_column(TABLE, sa.Column("content_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'")))
    if "content_html" not in have:
        op.add_column(TABLE, sa.Column("content_html", sa.Text(), nullable=False, server_default=sa.text("''")))
    for name, _, _ in ADDED:
        if name in have:
            op.drop_column(TABLE, name)
