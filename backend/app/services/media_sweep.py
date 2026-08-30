"""아무도 가리키지 않는 Cloudinary 파일을 찾아 지웁니다.

## 왜 필요한가

사진은 **저장 버튼과 무관하게** 올라갑니다. 편집기에서 파일을 고르는 순간
브라우저가 Cloudinary 로 바로 보내고, 주소만 서식에 담깁니다. 그래서 글을 쓰다
말고 나가거나, 올린 사진을 X 로 빼거나, 다른 사진으로 바꾸면 먼저 올린 파일은
이미 올라가 있고 아무도 가리키지 않습니다.

배포 첫날에 재어 보니 `shape/` 자산 35개 중 **21개(60%)가 이런 고아**였습니다.
장비 사진을 몇 번 갈아 끼운 것만으로 18개가 남았습니다.

지우는 창구마다 파일을 함께 지우도록 고쳤지만, 그것만으로는 두 가지가 남습니다.

- **저장하지 않고 떠난 업로드.** 어떤 행에도 붙은 적이 없으니 지울 실마리가 없습니다.
- **본문에 박힌 사진.** 같은 사진이 다른 글에도 붙어 있을 수 있어서, 글 하나를
  지울 때 곧바로 지우면 남의 글이 깨집니다. 모든 글을 훑어 본 뒤에야 판단할 수
  있고, 그 일이 여기입니다.

## 무엇을 지키는가

- **예약 사진(`shape/reservation/`)은 건드리지 않습니다.** 장비를 누가 어떤
  상태로 쓰고 돌려놓았는지는 활동 기록이라, 예약이 지워져도 남깁니다.
- **올라온 지 얼마 안 된 파일도 건드리지 않습니다**(`GRACE_HOURS`). 방금 올렸지만
  아직 저장을 누르지 않은 파일은 고아와 구별할 수 없습니다. 하루를 두면 그 사이에
  저장될 것은 다 저장됩니다.
- **`shape/` 로 시작하는 것만 봅니다.** 계정에 남아 있는 다른 것은 대상이 아닙니다.
"""

import asyncio
import logging
import re
import time
from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import ContentPage, Equipment, NewsPost, Notice, Reservation, Resource, ShapeUpPost, User
from app.services.cloudinary import destroy_id, public_id_of

logger = logging.getLogger(__name__)
TIMEOUT = 20.0
PREFIX = "shape/"
# 활동 기록이라 예약이 지워져도 남깁니다.
KEEP_PREFIXES = ("shape/reservation/",)
KINDS = ("image", "video", "raw")
# 본문에서 사진 주소를 알아보는 규칙. **파이썬과 Postgres 가 같은 것을 씁니다.**
# 두 벌로 두었다가 한쪽만 고치면, 쓰이고 있는 사진이 고아로 판정되어 지워집니다.
# 이 문법은 양쪽에서 같은 뜻입니다(문자 집합 안의 `\s`, `\"`, `\\` 모두).
URL_PATTERN = r"https://res\.cloudinary\.com/[^\s\"'<>)\\]+"
MARKER = "res.cloudinary.com"


def _urls(*values: object) -> set[str]:
    """글 한 편에 들어 있는 Cloudinary 주소 전부. 본문에 박힌 것까지 봅니다."""
    found: set[str] = set()
    for value in values:
        if value:
            found.update(re.findall(URL_PATTERN, str(value)))
    return found


# 사진 주소가 들어 있을 수 있는 칸. 칸을 콕 집어 읽습니다. 표에 새 칸이 생겨도
# 이 조회는 그대로 돌아야 하기 때문입니다(배포 직후처럼 코드와 표가 잠깐 어긋나는
# 순간이 있습니다).
COLUMNS = [
    (User.image_url,),
    (Equipment.image_url,),
    (NewsPost.cover_image, NewsPost.content_html),
    (Notice.content_html,),
    # SHAPE-UP 은 본문이 자유 편집기가 아니라 **방법·결과 덩이 배열**입니다.
    # 그림 주소가 그 JSON 안에 들어 있으므로 반드시 여기서 함께 읽어야 합니다.
    # 빠뜨리면 **쓰이고 있는 그림이 전부 고아로 판정되어 지워집니다.**
    # `_source_sql` 이 text 로 눕히므로 JSON 이어도 같은 규칙으로 훑힙니다.
    (ShapeUpPost.cover_image, ShapeUpPost.method_blocks, ShapeUpPost.result_blocks),
    (ContentPage.content_html, ContentPage.content_json),
    (Reservation.before_photo_url, Reservation.after_photo_url),
    (Resource.file_url,),
]
def _source_sql(column) -> str:
    """이 칸을 '값 한 줄씩' 으로 펴는 SQL 한 도막.

    표와 칸 이름은 모델에서 꺼냅니다. 이름을 바꾸면 여기도 따라옵니다.
    `content_json` 은 JSONB 라 text 로 맞춰야 나머지와 union 이 됩니다.
    """
    found = column.property.columns[0]
    return (
        f'select cast("{found.name}" as text) as value '
        f'from "{found.table.name}" where "{found.name}" is not null'
    )


async def _referenced_urls_in_db(db: AsyncSession) -> set[str]:
    """주소 뽑는 일을 **데이터베이스 안에서** 합니다 (Postgres 전용).

    예전에는 글 본문을 전부 백엔드로 실어 와 파이썬 정규식으로 훑었습니다. 여덟
    개 표를 조건 없이 읽는 구조라 글이 쌓이는 만큼 그대로 무거워집니다. 재어 보니
    지금은 회당 27 kB 지만, 글이 1,500편쯤 되면 회당 약 7 MB 입니다.

    스캔은 어차피 누군가 해야 하지만 **어디서 하느냐**로 값이 갈립니다. 여기서
    뽑으면 밖으로 나오는 것은 찾아낸 주소 몇십 건뿐이라 egress 가 메가바이트에서
    킬로바이트로 떨어지고, 0.1 CPU 짜리 무료 인스턴스가 전 본문을 정규식으로
    훑는 일도 사라집니다. Neon 은 질의 횟수가 아니라 깨어 있는 시간으로 값을
    매기므로, 이 스캔이 데이터베이스 쪽에서 잠깐 더 도는 것은 값이 거의 없습니다.
    """
    union = "\n  union all ".join(_source_sql(column) for group in COLUMNS for column in group)
    statement = text(
        f"select distinct m.parts[1] as url from (\n  {union}\n) s "
        "cross join lateral regexp_matches(s.value, :pattern, 'g') as m(parts)"
    ).bindparams(pattern=URL_PATTERN)
    return set((await db.execute(statement)).scalars().all())


async def _referenced_urls_in_python(db: AsyncSession) -> set[str]:
    """같은 일을 백엔드에서 합니다. SQLite(로컬 개발과 자동 시험) 용입니다."""
    urls: set[str] = set()
    for group in COLUMNS:
        for row in (await db.execute(select(*group))).all():
            urls |= _urls(*row)
    return urls


async def _anything_to_find(db: AsyncSession) -> bool:
    """사진 주소가 든 행이 하나라도 있는지. 아래 안전장치가 씁니다."""
    for group in COLUMNS:
        for column in group:
            found = column.property.columns[0]
            statement = text(
                f'select 1 from "{found.table.name}" '
                f'where cast("{found.name}" as text) like :marker limit 1'
            ).bindparams(marker=f"%{MARKER}%")
            if (await db.execute(statement)).first():
                return True
    return False


async def referenced(db: AsyncSession) -> set[str]:
    """지금 어디선가 쓰이고 있는 파일의 이름(public_id) 전부."""
    postgres = get_settings().database_url.startswith("postgres")
    urls = await (_referenced_urls_in_db(db) if postgres else _referenced_urls_in_python(db))
    if postgres and not urls and await _anything_to_find(db):
        # 주소가 분명히 있는데 하나도 못 뽑았다면 뽑는 쪽이 고장 난 것입니다.
        # 그대로 두면 **쓰이고 있는 사진이 전부 고아로 판정되어 지워집니다.**
        # 정리를 거르는 쪽이 언제나 안전합니다.
        raise RuntimeError("본문에 사진 주소가 있는데 하나도 뽑지 못했습니다. 정리를 건너뜁니다.")
    # `public_id_of` 는 (종류, 이름) 을 돌려줍니다. 여기서 필요한 것은 이름뿐이고,
    # 튜플을 그대로 담으면 아래에서 이름과 견주는 순간 **하나도 맞지 않아 쓰이는
    # 파일까지 전부 고아로 판정**됩니다.
    return {found[1] for found in (public_id_of(url) for url in urls) if found}


async def _listed(client: httpx.AsyncClient, kind: str) -> list[dict]:
    """Cloudinary 에 실제로 올라와 있는 `shape/` 자산 전부.

    이름 앞머리로 거르려면 전달 방식(`upload`)까지 주소에 넣어야 합니다. 빼면
    "Missing required parameter - type" 으로 거절합니다.
    """
    assets: list[dict] = []
    cursor: str | None = None
    while True:
        params = {"prefix": PREFIX, "max_results": 500}
        if cursor:
            params["next_cursor"] = cursor
        response = await client.get(f"/resources/{kind}/upload", params=params)
        if response.status_code == 404:  # 그 종류가 하나도 없으면
            return assets
        response.raise_for_status()
        body = response.json()
        assets.extend(body.get("resources", []))
        cursor = body.get("next_cursor")
        if not cursor:
            return assets


def _too_new(created_at: str, grace_hours: int) -> bool:
    """아직 저장을 누르지 않았을 수도 있는 파일인지."""
    try:
        when = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return True  # 언제 올라왔는지 모르면 건드리지 않는다
    return when > datetime.now(UTC) - timedelta(hours=grace_hours)


async def find(db: AsyncSession, grace_hours: int | None = None) -> list[dict]:
    """지워도 되는 파일 목록. 지우지는 않습니다."""
    settings = get_settings()
    if not all([settings.cloudinary_cloud_name, settings.cloudinary_api_key, settings.cloudinary_api_secret]):
        return []
    grace = settings.media_orphan_grace_hours if grace_hours is None else grace_hours
    used = await referenced(db)
    orphans: list[dict] = []
    async with httpx.AsyncClient(
        base_url=f"https://api.cloudinary.com/v1_1/{settings.cloudinary_cloud_name}",
        auth=(settings.cloudinary_api_key, settings.cloudinary_api_secret),
        timeout=TIMEOUT,
    ) as client:
        for kind in KINDS:
            for asset in await _listed(client, kind):
                name = asset.get("public_id", "")
                if name in used or name.startswith(KEEP_PREFIXES):
                    continue
                if _too_new(asset.get("created_at", ""), grace):
                    continue
                orphans.append({"public_id": name, "kind": kind, "bytes": asset.get("bytes", 0), "created_at": asset.get("created_at", "")})
    return orphans


async def sweep(db: AsyncSession, apply: bool = False, grace_hours: int | None = None) -> tuple[list[dict], int]:
    """고아를 찾고, `apply` 면 지웁니다. (찾은 것, 지운 수) 를 돌려줍니다."""
    orphans = await find(db, grace_hours)
    if not apply or not orphans:
        return orphans, 0
    removed = 0
    for item in orphans:
        if await destroy_id(item["public_id"], item["kind"]):
            removed += 1
    return orphans, removed


# ------------------------------------------------------------ 주기적으로 돌기

# 0 으로 두면 서버가 뜬 뒤 **첫 요청**에서 곧바로 한 번 돕니다. 무료 인스턴스는
# 15분만 놀아도 잠들었다 깨므로 그 첫 요청이 하루에도 여러 번 오고, 하필 가장
# 느린 순간(찬 시작)에 정리까지 얹히게 됩니다. 뜬 시각을 시작점으로 잡아 한
# 주기가 지난 뒤부터 봅니다.
_last_run = time.monotonic()
_running: set[asyncio.Task] = set()


async def _run() -> None:
    from app.database import SessionLocal

    try:
        async with SessionLocal() as db:
            orphans, removed = await sweep(db, apply=True)
        if orphans:
            size = sum(item["bytes"] for item in orphans) / 1024
            logger.info("고아 파일 %d개(%.0fKB) 중 %d개를 지웠습니다.", len(orphans), size, removed)
    except Exception as error:  # noqa: BLE001 - 정리 때문에 사이트가 흔들리면 안 된다
        logger.warning("고아 파일 정리 실패: %s", error)


def maybe_sweep() -> None:
    """때가 됐으면 뒤에서 정리를 돌립니다. 요청은 기다리지 않습니다.

    따로 도는 시계(크론)를 두지 않습니다. Render 무료 요금제에는 크론이 없고,
    주기적으로 서버를 깨우면 그만큼 Neon 이 깨어 있어야 해서 한 달 한도에서
    가장 먼저 닳는 것을 씁니다. 사람이 사이트를 쓰는 동안에만 확인합니다.

    **주기는 `media_sweep_seconds`(기본 여섯 시간)입니다.** 한 시간이었는데
    늘렸습니다. 한 번 도는 값이 싸지 않기 때문입니다 — `referenced` 가 여덟 개
    표를 조건 없이 훑고, 거기에는 모든 글의 본문이 들어 있습니다. 주소를 뽑는
    일은 데이터베이스 안에서 하도록 옮겨 두어 오가는 양은 작지만, 훑는 일 자체는
    글이 쌓이는 만큼 무거워집니다.

    **이 시계는 프로세스 안에 있습니다.** 무료 인스턴스는 15분만 놀아도 잠들고,
    깨어나면 여기 `_last_run` 이 0 부터 다시 갑니다. 그래서 주기를 늘릴수록
    자동 정리가 도는 횟수는 주기에 비례해 줄어드는 것이 아니라 **그보다 더**
    줄어듭니다. 하루로 두면 사실상 한 번도 돌지 않습니다. 확실하게 돌려야 할
    때는 `scripts/sweep_orphan_media.py` 를 직접 돌립니다.

    조용한 새벽에는 서버가 잠들어 있어 아예 돌지 않습니다. 고아 파일은 급한
    일이 아니므로 그것으로 충분합니다.
    """
    global _last_run
    settings = get_settings()
    if not settings.media_sweep_seconds:
        return
    now = time.monotonic()
    if now - _last_run < settings.media_sweep_seconds:
        return
    _last_run = now
    task = asyncio.create_task(_run())
    _running.add(task)
    task.add_done_callback(_running.discard)
