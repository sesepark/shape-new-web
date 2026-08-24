"""부원 카드에서 '팀' 값을 지운다

Revision ID: 20260824_drop_team
Revises: 20260824_notif_url
Create Date: 2026-08-24

부원을 Reasoning·Navigation 같은 기술 팀으로 나누던 구분을 쓰지 않기로 했다.
화면과 관리자 폼, 스키마에서는 이미 뺐지만 카드가 JSON 으로 저장되어 있어 값은
그대로 남아 있다. 남은 값은 나중에 다시 새어 나오므로 여기서 실제로 지운다.

운영 데이터베이스에 직접 접속하지 않고 지우려는 것이 이 마이그레이션의 목적이다.
서버가 뜰 때 한 번 돌고 끝난다.
"""

import json

import sqlalchemy as sa

from alembic import op

revision = "20260824_drop_team"
down_revision = "20260824_notif_url"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """부원 페이지의 카드마다 'team' 키를 뺀다."""
    bind = op.get_bind()
    row = bind.execute(sa.text("SELECT content_json FROM content_pages WHERE slug = 'members'")).fetchone()
    if not row or row[0] is None:
        return
    # SQLite 는 문자열로, PostgreSQL 은 이미 풀린 값으로 돌려준다.
    content = json.loads(row[0]) if isinstance(row[0], str) else row[0]
    cards = content.get("members") or []
    if not any("team" in card for card in cards):
        return
    content = {**content, "members": [{k: v for k, v in card.items() if k != "team"} for card in cards]}
    # PostgreSQL 의 json 칸에는 문자열을 그대로 넣을 수 없다. 명시적으로 형을
    # 밝혀 줘야 한다(42804: column is of type json but expression is of type text).
    # SQLite 에는 json 형이 없으므로 문자열 그대로 넣는다.
    statement = (
        "UPDATE content_pages SET content_json = CAST(:value AS JSON) WHERE slug = 'members'"
        if bind.dialect.name == "postgresql"
        else "UPDATE content_pages SET content_json = :value WHERE slug = 'members'"
    )
    bind.execute(sa.text(statement), {"value": json.dumps(content, ensure_ascii=False)})


def downgrade() -> None:
    """되돌리지 않는다.

    지운 값은 어느 부원이 어느 팀이었는지인데, 그 구분 자체를 쓰지 않기로 했다.
    되살릴 원본이 없으므로 아무 일도 하지 않는다.
    """
