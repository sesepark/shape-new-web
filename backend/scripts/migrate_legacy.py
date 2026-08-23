"""레거시 사이트(Supabase)의 콘텐츠를 새 데이터베이스로 옮긴다.

옛 사이트에는 연혁 5건과 갤러리 2건이 남아 있었고, 새 시스템에는 그 둘에
해당하는 테이블이 없다. 두 종류 모두 "그때 무슨 일이 있었나"를 적은 활동
기록이므로 소식 › SHAPE 뉴스(``news_posts``, category ``활동``)로 합친다.

부원은 옮기지 않는다. ``dev_content.MEMBERS`` 가 레거시 34명을 모두 담은
채 현 집행부 직책까지 반영하고 있어, 레거시 쪽 값으로 덮으면 구 집행부로
되돌아간다.

갤러리 사진과 영상은 Supabase Storage에 있다. 레거시 프로젝트가 사라지면
같이 사라지고, 프런트엔드의 ``next.config.ts`` 도 ``res.cloudinary.com`` 만
허용하므로 먼저 Cloudinary로 올려야 한다.

    # 1) 미디어를 Cloudinary로 올리고 주소 대응표를 만든다
    CLOUDINARY_CLOUD_NAME=... CLOUDINARY_API_KEY=... CLOUDINARY_API_SECRET=... \
        python scripts/migrate_legacy.py --upload

    # 2) 뉴스 글로 넣는다
    DATABASE_URL=... SESSION_SECRET=... python scripts/migrate_legacy.py

같은 제목의 글이 이미 있으면 건너뛰므로 두 번 실행해도 중복되지 않는다.
"""

import argparse
import asyncio
import hashlib
import json
import mimetypes
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

import httpx
from sqlalchemy import select

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import SessionLocal, engine  # noqa: E402
from app.models import NewsPost  # noqa: E402

DEFAULT_DATA = Path(__file__).resolve().parents[3] / "legacy-data"
CATEGORY = "활동"
CLOUDINARY_FOLDER = "shape/legacy"

# 본문 HTML은 관리자 편집기와 같은 허용 태그만 써야 한다. <video> 는 허용
# 목록에 없어서, 나중에 누가 이 글을 편집기로 한 번 열어 저장하면 조용히
# 사라진다. 그래서 영상은 링크로 남긴다.
VIDEO_LINK = '<p><a href="{url}" target="_blank" rel="noreferrer">영상 보기</a></p>'


def storage_name(url: str) -> str:
    """Supabase 공개 URL을 legacy-data/storage 안의 파일 이름으로 바꾼다."""
    return url.split("/public/media/")[-1].replace("/", "__")


# ---------------------------------------------------------------- Cloudinary


def sign(params: dict[str, str], secret: str) -> str:
    body = "&".join(f"{key}={params[key]}" for key in sorted(params))
    return hashlib.sha1(f"{body}{secret}".encode()).hexdigest()


def upload(client: httpx.Client, cloud: str, key: str, secret: str, path: Path) -> str:
    kind = "video" if path.suffix.lower() in {".mp4", ".mov", ".webm"} else "image"
    params = {"folder": CLOUDINARY_FOLDER, "timestamp": str(int(time.time()))}
    data = {**params, "api_key": key, "signature": sign(params, secret)}
    mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    with path.open("rb") as handle:
        response = client.post(
            f"https://api.cloudinary.com/v1_1/{cloud}/{kind}/upload",
            data=data,
            files={"file": (path.name, handle, mime)},
            timeout=120.0,
        )
    response.raise_for_status()
    return response.json()["secure_url"]


def upload_all(data_dir: Path, cloud: str, key: str, secret: str) -> dict[str, str]:
    """갤러리가 참조하는 파일만 올린다. 부원 사진은 /figs 로 이미 살아 있다."""
    gallery = json.loads((data_dir / "tables" / "gallery.json").read_text())
    urls = [item["url"] for row in gallery for item in (row.get("media") or [])]
    mapping_path = data_dir / "cloudinary-map.json"
    mapping: dict[str, str] = json.loads(mapping_path.read_text()) if mapping_path.exists() else {}
    with httpx.Client() as client:
        for url in urls:
            if url in mapping:
                print(f"  이미 올림 {storage_name(url)}")
                continue
            path = data_dir / "storage" / storage_name(url)
            if not path.exists():
                raise SystemExit(f"원본 파일이 없습니다: {path}")
            mapping[url] = upload(client, cloud, key, secret, path)
            print(f"  올림 {path.name} → {mapping[url]}")
    mapping_path.write_text(json.dumps(mapping, ensure_ascii=False, indent=2))
    print(f"주소 대응표: {mapping_path}")
    return mapping


# -------------------------------------------------------------------- 뉴스 글


# 갤러리 2건은 둘 다 연혁에 같은 사건이 이미 적혀 있다. 휴머노이드 챌린지는
# 설명 문장까지 글자 그대로 같다. 따로 넣으면 소식 목록에 같은 글이 두 번
# 뜨므로, 갤러리는 사진과 정확한 날짜만 연혁 글에 얹는다. 제목이 비슷하다고
# 자동으로 묶으면 나중에 엉뚱한 글이 합쳐지므로 짝은 여기에 적어 둔다.
GALLERY_MERGES = {
    "르로봇 프로젝트": "르로봇 교육 프로젝트",
    "2026 휴머노이드 챌린지 참가": "2026 휴머노이드 챌린지 참가",
}


def build_posts(data_dir: Path, mapping: dict[str, str]) -> list[dict]:
    history = json.loads((data_dir / "tables" / "history.json").read_text())
    gallery = json.loads((data_dir / "tables" / "gallery.json").read_text())

    posts: dict[str, dict] = {}
    for row in sorted(history, key=lambda item: (item["year"], item["month"] or 1)):
        text = row["description_ko"].strip()
        title = row["title_ko"].strip()
        posts[title] = {
            "title": title,
            "summary": text,
            "content_html": f"<p>{text}</p>",
            "cover_image": None,
            "published_at": datetime(row["year"], row["month"] or 1, 1, tzinfo=UTC),
        }

    for row in sorted(gallery, key=lambda item: item["date"]):
        title = row["title_ko"].strip()
        target = GALLERY_MERGES.get(title, title)
        text = row["description_ko"].strip()
        post = posts.get(target) or {
            "title": title, "summary": text, "content_html": f"<p>{text}</p>",
            "cover_image": None, "published_at": None,
        }
        body = [post["content_html"]]
        for item in row.get("media") or []:
            url = mapping[item["url"]]
            if item["type"] == "video":
                body.append(VIDEO_LINK.format(url=url))
            else:
                post["cover_image"] = post["cover_image"] or url
                body.append(f'<img src="{url}" alt="{target}">')
        post["content_html"] = "".join(body)
        # 갤러리는 연혁과 달리 일 단위 날짜를 갖고 있어 그쪽이 더 정확하다.
        post["published_at"] = datetime.fromisoformat(row["date"]).replace(tzinfo=UTC)
        posts[target] = post

    return sorted(posts.values(), key=lambda post: post["published_at"])


async def insert(posts: list[dict]) -> None:
    async with SessionLocal() as db:
        existing = set((await db.scalars(select(NewsPost.title))).all())
        added = 0
        for post in posts:
            if post["title"] in existing:
                print(f"  건너뜀 (이미 있음) {post['title']}")
                continue
            db.add(NewsPost(category=CATEGORY, is_published=True, **post))
            added += 1
            print(f"  추가 {post['published_at'].date()} {post['title']}")
        await db.commit()
    await engine.dispose()
    print(f"뉴스 {added}건을 추가했습니다.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA, help="레거시 덤프 폴더")
    parser.add_argument("--upload", action="store_true", help="Cloudinary 업로드만 수행")
    args = parser.parse_args()

    if args.upload:
        import os

        cloud, key, secret = (
            os.environ.get("CLOUDINARY_CLOUD_NAME"),
            os.environ.get("CLOUDINARY_API_KEY"),
            os.environ.get("CLOUDINARY_API_SECRET"),
        )
        if not all([cloud, key, secret]):
            raise SystemExit("CLOUDINARY_CLOUD_NAME / API_KEY / API_SECRET 를 설정하세요.")
        upload_all(args.data, cloud, key, secret)
        return

    mapping_path = args.data / "cloudinary-map.json"
    if not mapping_path.exists():
        raise SystemExit(
            "갤러리 사진 주소 대응표가 없습니다. 먼저 --upload 로 Cloudinary에 올리세요.\n"
            "(Supabase 주소를 그대로 쓰면 레거시 프로젝트를 지우는 순간 사진이 사라지고, "
            "next.config.ts 의 이미지 허용 목록에도 없습니다.)"
        )
    mapping = json.loads(mapping_path.read_text())
    asyncio.run(insert(build_posts(args.data, mapping)))


if __name__ == "__main__":
    main()
