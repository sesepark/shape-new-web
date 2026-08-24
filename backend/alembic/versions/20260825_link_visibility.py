"""바로가기 링크에 공개 범위를 더한다

Revision ID: 20260825_link_vis
Revises: 20260824_companions
Create Date: 2026-08-25

관련 링크는 지금까지 등록하면 누구에게나 보였다. 그런데 실제로 등록하고 싶은
주소에는 세 종류가 섞여 있다. 홍보용 인스타그램처럼 아무나 봐도 되는 것,
부원용 Drive 나 Notion 처럼 로그인한 부원만 봐야 하는 것, 그리고 운영진끼리
쓰는 관리 도구처럼 운영진만 봐야 하는 것이다.

`is_published` 는 그대로 둔다. 그쪽은 '내보냈는가'(임시 저장이면 관리 화면에만
남는다)이고, 새 칸은 '내보낸 것을 누가 보는가'다. 서로 다른 축이다.

이미 있는 링크는 지금까지 전부 공개였으므로 PUBLIC 으로 채운다. 값을 바꾸는
마이그레이션이 아니라 지금 상태를 그대로 적어 두는 것이다.
"""

import sqlalchemy as sa
from alembic import op

revision = "20260825_link_vis"
down_revision = "20260824_companions"
branch_labels = None
depends_on = None

# 이름을 명시한다. 이름을 주지 않으면 SQLAlchemy 가 파이썬 클래스 이름에서
# 만들어 내는데, 그 규칙에 기대면 모델 쪽 클래스 이름을 바꾸는 순간 이 파일이
# 가리키는 타입과 어긋난다.
VISIBILITY = sa.Enum("PUBLIC", "MEMBER", "STAFF", name="linkvisibility")


def has_column(bind) -> bool:
    """이미 칸이 있는지.

    첫 마이그레이션이 `Base.metadata.create_all` 이라, **빈 데이터베이스에
    올리면 지금 모델 그대로 만들어집니다.** 그 뒤로 칸을 더하는 마이그레이션은
    이미 있는 칸을 또 만들려다 멈춥니다. 운영 데이터베이스는 차례대로 올라와
    있어 여기 걸리지 않지만, 새로 만든 데이터베이스에서는 걸립니다. 그래서
    있으면 그냥 넘어갑니다.
    """
    return any(column["name"] == "visibility" for column in sa.inspect(bind).get_columns("related_links"))


def upgrade() -> None:
    bind = op.get_bind()
    if has_column(bind):
        return
    # PostgreSQL 은 컬럼을 만들기 전에 타입이 있어야 한다. SQLite 는 enum 을
    # VARCHAR + CHECK 로 흉내 내므로 이 호출이 아무 일도 하지 않는다.
    VISIBILITY.create(bind, checkfirst=True)
    op.add_column(
        "related_links",
        sa.Column("visibility", VISIBILITY, nullable=False, server_default="PUBLIC"),
    )


def downgrade() -> None:
    bind = op.get_bind()
    if not has_column(bind):
        return
    op.drop_column("related_links", "visibility")
    VISIBILITY.drop(bind, checkfirst=True)
