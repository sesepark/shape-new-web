"""이미 올라와 있는 글의 본문 사진을 줄여서 내보내도록 고칩니다.

편집기가 업로드 직후 넣어 준 Cloudinary 주소는 원본을 그대로 가리킵니다. 글을
여는 사람마다 휴대폰 사진 원본이 통째로 나가므로, 무료 티어에서 가장 먼저 닳는
전송량을 여기서 다 씁니다. 실제로 올라와 있던 소식 5장은 원본 합계 8.5MB,
같은 사진의 변환본 합계는 0.46MB 였습니다.

앞으로 저장되는 글은 `sanitize_html` 이 알아서 고칩니다. 이 스크립트는 그 전에
저장된 글을 한 번 훑어 같은 상태로 맞춥니다. 원본은 Cloudinary 에 그대로 남고
주소만 바뀌므로 되돌릴 수 있습니다.

    python scripts/shrink_body_images.py          # 무엇이 바뀌는지만 보여 줍니다
    python scripts/shrink_body_images.py --apply  # 실제로 저장합니다
"""

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select  # noqa: E402

from app.database import SessionLocal  # noqa: E402
from app.models import ContentPage, NewsPost, Notice, ShapeUpPost  # noqa: E402
from app.services.content import deliver_smaller, lazy_images  # noqa: E402

TABLES = [(NewsPost, "소식·언론보도"), (Notice, "게시판"), (ShapeUpPost, "SHAPE UP"), (ContentPage, "고정 페이지")]


async def main(apply: bool) -> None:
    changed = 0
    async with SessionLocal() as db:
        for model, label in TABLES:
            rows = (await db.scalars(select(model))).all()
            for row in rows:
                before = row.content_html or ""
                after = lazy_images(deliver_smaller(before))
                if after == before:
                    continue
                changed += 1
                title = getattr(row, "title", None) or getattr(row, "slug", "?")
                print(f"  [{label}] {title[:40]}")
                if apply:
                    row.content_html = after
        if apply and changed:
            await db.commit()
    print(f"\n{'고친' if apply else '고칠'} 글 {changed}건" + ("" if apply else " · 실제로 저장하려면 --apply 를 붙이세요"))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="실제로 저장합니다")
    asyncio.run(main(parser.parse_args().apply))
