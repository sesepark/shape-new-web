"""운영 데이터베이스에 공개 페이지의 첫 내용을 넣는다.

``dev_seed.py`` 는 테이블을 통째로 비우고 가짜 회원과 예약까지 만들기 때문에
운영에서는 절대 돌릴 수 없다. 이 스크립트는 인사말·동아리 소개·부원·조직도
네 페이지만 넣는다. 넷 다 편집자가 손으로 옮겨 적기에는 양이 많고, 이미
``dev_content.py`` 안에 동아리 계획 문서를 따라 정리되어 있다.

장비·라이선스·관련 링크·로드맵은 넣지 않는다. 실제 값이 아직 정해지지
않았거나(관련 링크의 주소) 호기 단위 등록이 필요해서(장비), 관리자 페이지에서
직접 등록하는 편이 맞다. 배포 후 순서는 ``docs/setup.md`` 6절에 있다.

    DATABASE_URL=... SESSION_SECRET=... python scripts/seed_content.py

이미 있는 slug 는 건너뛰므로 두 번 돌려도 편집한 내용을 덮어쓰지 않는다.
"""

import asyncio
import sys
from pathlib import Path

from sqlalchemy import select

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import dev_content as content  # noqa: E402

from app.database import SessionLocal, engine  # noqa: E402
from app.models import ContentPage  # noqa: E402

# 부원 카드의 userId 는 비워 둔다. 각 부원이 구글 로그인으로 가입한 뒤
# 관리자가 카드에 계정을 연결하면, 사진과 소개말은 본인이 관리하게 된다.
PAGES = [
    {"slug": "greeting", "title": "인사말", "content_html": content.GREETING_HTML, "content_json": {}},
    {"slug": "club-introduction", "title": "동아리 소개", "content_html": content.CLUB_HTML,
     "content_json": {"facts": content.CLUB_FACTS}},
    {"slug": "members", "title": "부원", "content_html": "",
     "content_json": {"members": content.MEMBERS}},
    {"slug": "organization", "title": "조직도", "content_html": "", "content_json": content.ORGANIZATION},
]


async def main() -> None:
    async with SessionLocal() as db:
        existing = set((await db.scalars(select(ContentPage.slug))).all())
        added = 0
        for page in PAGES:
            if page["slug"] in existing:
                print(f"  건너뜀 (이미 있음) {page['slug']} — 편집한 내용을 덮지 않습니다.")
                continue
            db.add(ContentPage(is_published=True, **page))
            added += 1
            print(f"  추가 {page['slug']} · {page['title']}")
        await db.commit()
    await engine.dispose()
    print(f"페이지 {added}개를 넣었습니다. 이어서 관리자 페이지에서 라이선스와 장비를 등록하세요.")


if __name__ == "__main__":
    asyncio.run(main())
