"""외부 링크가 걸린 소식의 미리보기 카드를 만들어 넣는다.

관리자 페이지에서 저장한 글은 저장하는 순간 원문을 한 번 읽어 미리보기를
`content_json.preview` 에 담는다. 하지만 시드 스크립트로 곧바로 데이터베이스에
넣은 글이나, 이 기능이 생기기 전에 쓴 글에는 그 값이 없어서 상세 페이지에
주소만 덩그러니 나온다. 이 스크립트가 그 빈자리를 채운다.

미리보기 그림이 있고 아직 대표 이미지가 없는 글에는 그 그림을 대표 이미지로도
넣는다. 언론보도 목록과 뉴스 목록이 제목만 늘어놓지 않게 하기 위해서다.

    cd backend
    DATABASE_URL="<Neon pooled URL>" SESSION_SECRET="<Render 와 같은 값>" \
        .venv/bin/python scripts/refresh_link_previews.py [--force]

이미 미리보기가 있는 글은 건너뛴다. 원문이 바뀌어 다시 읽어야 할 때만
``--force`` 를 붙인다. 원문을 읽지 못하면 그 글만 건너뛰고 나머지를 이어 간다.
"""

import asyncio
import sys
from pathlib import Path

from sqlalchemy import select

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import SessionLocal, engine  # noqa: E402
from app.models import NewsPost  # noqa: E402
from app.services.link_preview import build  # noqa: E402


async def main(force: bool) -> None:
    async with SessionLocal() as db:
        posts = (await db.scalars(
            select(NewsPost).where(NewsPost.external_url.is_not(None)).order_by(NewsPost.published_at.desc())
        )).all()
        for post in posts:
            content = dict(post.content_json or {})
            if content.get("preview") and not force:
                print(f"  건너뜀 (이미 있음) {post.title[:34]}")
                continue
            preview = await build(post.external_url)
            status = preview.get("status")
            if status not in {"card", "embed"}:
                print(f"  실패 ({status}) {post.title[:34]}")
                continue
            content["preview"] = preview
            post.content_json = content
            note = ""
            if preview.get("image") and not post.cover_image:
                post.cover_image = preview["image"]
                note = " · 대표 이미지도 함께 넣음"
            print(f"  완료 ({status}) {post.title[:34]}{note}")
        await db.commit()
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main("--force" in sys.argv))
