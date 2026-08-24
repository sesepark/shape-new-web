"""장비 사진 주소에 판 번호를 붙인다

Revision ID: 20260824_equip_v2
Revises: 20260824_drop_team
Create Date: 2026-08-24

`public/equipment` 의 장비 사진을 1200×1200 으로 다시 뽑았는데 화면에는 옛 사진이
계속 나왔다. 이미지 최적화 결과를 1년 동안 들고 있도록 해 두었기 때문이다
(next.config.ts 의 minimumCacheTTL). 캐시의 열쇠는 주소라서, 파일 내용만 바꾸고
주소를 그대로 두면 바뀐 것을 알 길이 없다.

주소 뒤에 판 번호를 붙여 새 열쇠로 만든다. 앞으로도 public 안의 사진을 바꿀
때는 주소를 함께 바꿔야 한다.
"""

import sqlalchemy as sa

from alembic import op

revision = "20260824_equip_v2"
down_revision = "20260824_drop_team"
branch_labels = None
depends_on = None

VERSION = "?v=2"


def upgrade() -> None:
    bind = op.get_bind()
    rows = bind.execute(sa.text(
        "SELECT id, image_url FROM equipment WHERE image_url LIKE '/equipment/%' AND image_url NOT LIKE '%?v=%'"
    )).fetchall()
    for row in rows:
        bind.execute(
            sa.text("UPDATE equipment SET image_url = :url WHERE id = :id"),
            {"url": f"{row[1]}{VERSION}", "id": row[0]},
        )


def downgrade() -> None:
    bind = op.get_bind()
    rows = bind.execute(sa.text("SELECT id, image_url FROM equipment WHERE image_url LIKE '/equipment/%?v=2'")).fetchall()
    for row in rows:
        bind.execute(
            sa.text("UPDATE equipment SET image_url = :url WHERE id = :id"),
            {"url": row[1].split("?")[0], "id": row[0]},
        )
