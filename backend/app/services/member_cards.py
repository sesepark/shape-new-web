"""부원 카드를 만들고 잇는 일을 한곳에 모읍니다.

부원 페이지의 카드는 `content_pages/members` 의 `content_json.members[]` 입니다.
카드는 두 갈래로 생깁니다.

1. 운영진이 명단을 보고 미리 만들어 둔 카드(1기·2기 명단이 이렇게 들어왔습니다).
   그 카드는 주인이 로그인한 뒤 **본인이** 마이페이지에서 집습니다.
2. 새로 가입해 승인된 부원의 카드. 미리 만들어 둔 것이 없으므로, 승인되는 순간
   그 사람의 계정으로 카드를 하나 만듭니다.

두 번째 갈래가 없으면 새 부원은 부원 페이지에 아예 나오지 않습니다. 명단에
이름이 없다는 이유로 새로 들어온 사람이 보이지 않는 것은 이상한 일입니다.

카드에 적히는 이름·사진·소개말은 **계정에서 가져옵니다.** 사진과 소개말은 그
뒤로도 계속 계정 쪽을 따르므로(부원 페이지가 연결된 계정을 먼저 봅니다),
마이페이지에서 사진을 바꾸면 부원 페이지도 함께 바뀝니다. 팀·역할처럼 본인이
정할 수 없는 값만 운영진이 나중에 채웁니다.
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ContentPage, User

# 새로 만드는 카드의 회원 구분. 준회원으로 시작해 교육 트랙을 이수하면 정회원이
# 되는 것이 이 동아리의 순서입니다. 다르면 운영진이 부원 탭에서 고칩니다.
DEFAULT_MEMBERSHIP = "준회원"


async def members_page(db: AsyncSession) -> ContentPage:
    """부원 페이지. 아직 없으면 빈 페이지를 만들어 돌려줍니다."""
    page = await db.scalar(select(ContentPage).where(ContentPage.slug == "members"))
    if page is None:
        page = ContentPage(slug="members", title="부원", content_json={"members": []}, content_html="", is_published=True)
        db.add(page)
        await db.flush()
    return page


def card_of(page: ContentPage, user_id) -> dict | None:
    """이 계정에 연결된 카드."""
    for card in (page.content_json or {}).get("members", []):
        if str(card.get("userId") or "") == str(user_id):
            return card
    return None


async def ensure_card(db: AsyncSession, user: User) -> dict:
    """이 부원의 카드를 보장합니다. 없으면 계정 정보로 하나 만듭니다.

    커밋은 부르는 쪽에서 합니다. 승인 처리 같은 다른 변경과 한 묶음으로 저장되어야
    "승인은 됐는데 카드는 없는" 어중간한 상태가 남지 않습니다.
    """
    page = await members_page(db)
    existing = card_of(page, user.id)
    if existing:
        return existing

    cards = list((page.content_json or {}).get("members", []))
    card = {
        # 계정에서 나온 카드임이 id 에 드러나게 둡니다. 명단에서 온 카드는
        # member-04-이름 처럼 붙어 있어 눈으로도 갈립니다.
        "id": f"account-{user.id}",
        "name": user.name,
        "role": "",
        "affiliation": "",
        "membership": DEFAULT_MEMBERSHIP,
        "userId": str(user.id),
    }
    # JSON 칸은 제자리에서 고치면 저장되지 않습니다. 새 목록으로 갈아 끼웁니다.
    page.content_json = {**(page.content_json or {}), "members": [*cards, card]}
    return card
