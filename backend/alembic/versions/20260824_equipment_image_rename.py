"""장비 사진 주소를 새 파일 이름으로 바꾼다

Revision ID: 20260824_equip_name
Revises: 20260824_equip_v2
Create Date: 2026-08-24

앞선 마이그레이션에서 주소 뒤에 ?v=2 를 붙였는데, Next.js 이미지 최적화가
**로컬 주소에 붙은 물음표를 받지 않는다**(실측: 400). 캐시를 새 열쇠로 만들려면
파일 이름 자체를 바꿔야 한다.

  /equipment/omy.png?v=2  →  /equipment/omy-2.png

파일은 public/equipment 에서 함께 이름을 바꿨다. 앞으로 사진을 다시 뽑을 때도
번호를 올린 새 이름으로 넣는다.
"""

import sqlalchemy as sa

from alembic import op

revision = "20260824_equip_name"
down_revision = "20260824_equip_v2"
branch_labels = None
depends_on = None

RENAMED = {
    "ai-worker": "ai-worker-2",
    "ai-sapiens": "ai-sapiens-2",
    "omy": "omy-2",
    "so-arm101": "so-arm101-2",
}


def upgrade() -> None:
    bind = op.get_bind()
    for old, new in RENAMED.items():
        for suffix in ("?v=2", ""):
            bind.execute(
                sa.text("UPDATE equipment SET image_url = :new WHERE image_url = :old"),
                {"new": f"/equipment/{new}.png", "old": f"/equipment/{old}.png{suffix}"},
            )


def downgrade() -> None:
    bind = op.get_bind()
    for old, new in RENAMED.items():
        bind.execute(
            sa.text("UPDATE equipment SET image_url = :old WHERE image_url = :new"),
            {"old": f"/equipment/{old}.png", "new": f"/equipment/{new}.png"},
        )
