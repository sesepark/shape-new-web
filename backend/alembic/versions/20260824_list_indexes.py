"""공개 목록과 예약 조회가 쓰는 정렬·필터 컬럼에 인덱스를 붙인다

Revision ID: 20260824_list_indexes
Revises: 20260823_shapeup
Create Date: 2026-08-24

행이 적을 때는 순차 훑기가 더 빠르므로 지금 당장 눈에 띄는 차이는 없다.
그럼에도 미리 넣는 이유는 두 가지다. 첫째, 예약과 알림은 학기가 지날수록
계속 쌓이는 유일한 테이블이라 나중에 반드시 걸린다. 둘째, Neon 무료 티어는
5분만 놀아도 잠들기 때문에 깨어난 직후의 첫 질의가 디스크에서 올라온다.
그때 훑는 페이지 수를 줄여 두는 편이 낫다.

인덱스 이름을 명시하고 ``if_not_exists`` 로 만들어, 두 번 돌려도 실패하지 않고
SQLite 로 띄운 로컬 개발 환경에서도 같은 문장이 통한다.
"""

import sqlalchemy as sa
from alembic import op

revision = "20260824_list_indexes"
down_revision = "20260823_shapeup"
branch_labels = None
depends_on = None

# (인덱스 이름, 테이블, 컬럼들) — 각각 실제로 쓰이는 질의는 아래와 같다.
INDEXES = [
    # GET /news, /news?category=… : is_published 로 거르고 published_at 역순 정렬
    ("ix_news_posts_published", "news_posts", ["is_published", "published_at"]),
    # GET /roadmap : is_published 로 거르고 starts_at 오름차순 정렬
    ("ix_roadmap_items_published", "roadmap_items", ["is_published", "starts_at"]),
    # GET /links : is_published 로 거르고 sort_order 정렬
    ("ix_related_links_published", "related_links", ["is_published", "sort_order"]),
    # GET /shape-up : is_published 로 거르고 created_at 역순 정렬
    ("ix_shape_up_posts_published", "shape_up_posts", ["is_published", "created_at"]),
    # GET /notices : is_published 로 거르고 고정글 먼저, 그다음 published_at 역순
    ("ix_notices_published", "notices", ["is_published", "published_at"]),
    # GET /equipment : sort_order, name 순
    ("ix_equipment_order", "equipment", ["sort_order", "name"]),
    # GET /reservations/calendar : 한 달치 구간 겹침 조회. 가장 빠르게 커지는 표다.
    ("ix_reservations_window", "reservations", ["starts_at", "ends_at"]),
    # GET /notifications : 본인 알림 최신 50건
    ("ix_notifications_user_recent", "notifications", ["user_id", "created_at"]),
]


def upgrade() -> None:
    tables = set(sa.inspect(op.get_bind()).get_table_names())
    for name, table, columns in INDEXES:
        if table in tables:
            op.create_index(name, table, columns, if_not_exists=True)


def downgrade() -> None:
    tables = set(sa.inspect(op.get_bind()).get_table_names())
    for name, table, _ in INDEXES:
        if table in tables:
            op.drop_index(name, table_name=table, if_exists=True)
