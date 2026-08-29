"""관리자 화면에서 일어난 수정을 빠짐없이 남깁니다.

## 왜 창구마다 부르지 않는가

수정 내역을 남기는 흔한 방법은 저장하는 자리마다 "기록해 줘" 를 한 줄씩 넣는
것입니다. 그러면 **새 창구를 만들 때마다 빠뜨릴 수 있고, 빠뜨려도 아무 일도
일어나지 않습니다.** 조용히 기록만 안 남습니다. 나중에 "누가 이걸 지웠지" 를
물었을 때 비어 있는 것이 가장 나쁜 결과입니다.

그래서 관리자 라우터 전체에 걸어 두고 **쓰기 요청이면 무조건** 남깁니다.
`app/cache.py` 가 저장할 때 캐시를 통째로 버리는 것과 같은 판단입니다 — 빠뜨릴
수 있는 표를 손으로 관리하느니, 무딘 대신 새지 않는 쪽을 고릅니다.

## 값은 얼마나 드는가

관리자 쓰기는 하루에 몇 번뿐이고, 그 요청은 어차피 데이터베이스를 열어 저장하는
중입니다. 이미 깨어 있는 연결에 INSERT 한 줄이 붙을 뿐이라 Neon 의 '깨어 있는
시간' 에는 영향이 없습니다. 읽기 요청에는 아무것도 하지 않습니다.

## 이름은 어디서 오는가

지우기가 어렵습니다. 지우고 나면 이름을 알아낼 방법이 없어서 "무언가를 지움" 만
남습니다. 정작 나중에 찾게 되는 것이 바로 그 기록인데 말입니다.

창구마다 "지우기 전에 이름을 담아 줘" 를 넣는 방법도 있지만, 그러면 새 지우기
창구를 만들 때마다 빠뜨릴 수 있습니다. 그래서 **주소만 보고 미리 읽어 둡니다.**
주소에 든 식별자와 영역으로 어느 표의 어느 칸이 이름인지 알 수 있으므로, 창구가
일하기 **전에** 그 이름을 읽어 둡니다. 같은 세션이라 대개 창구가 곧이어 읽을 때
질의가 다시 나가지도 않습니다.

정리하면 이름은 이 순서로 정해집니다.

1. 창구가 직접 알려 준 이름(`note`). 위 방법으로도 알 수 없는 자리에만 씁니다.
2. 주소가 가리키는 행의 이름. **지우기가 여기서 살아납니다.**
3. 요청 본문의 `title`·`name` 따위. 만들기는 아직 행이 없으므로 여기서 나옵니다.
4. 다 없으면 주소의 마지막 조각. 아쉽지만 **없는 것보다 낫습니다.**
"""

import logging
from datetime import UTC, datetime
from uuid import UUID

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import (
    AuditLog,
    Equipment,
    EquipmentUnit,
    License,
    NewsPost,
    Notice,
    RelatedLink,
    Reservation,
    RoadmapItem,
    User,
)
from app.security import current_user

logger = logging.getLogger(__name__)

SAFE = {"GET", "HEAD", "OPTIONS"}
# 고치는 것이 아니라 미리 읽어 보는 창구. 남길 것이 없습니다.
PROBES = ("/link-preview", "/preview")
# 이름이 담겨 있을 만한 칸. 앞에 있는 것부터 씁니다.
NAME_KEYS = ("title", "name", "label", "slug")

# 주소의 첫 조각 → 화면에 보일 이름.
AREAS = {
    "pages": "페이지",
    "news": "소식",
    "notices": "게시판",
    "equipment": "장비",
    "licenses": "라이선스",
    "roadmap": "로드맵",
    "links": "바로가기",
    "reservations": "예약",
    "users": "회원",
    "usage": "서버",
    "audit": "수정 내역",
}

# 주소 끝에 붙는 조각이 동작을 더 정확히 말해 줍니다. 없으면 방식으로 정합니다.
BY_TAIL = {
    "order": "order",
    "decision": "decision",
    "cancel": "cancel",
    "status": "status",
    "owner": "owner",
    "permissions": "permissions",
    "licenses": "licenses",
}
BY_METHOD = {"POST": "create", "PATCH": "update", "PUT": "replace", "DELETE": "delete"}

# 주소가 가리키는 행에서 이름을 읽어 올 곳. 열쇠는 주소에서 식별자를 뺀 조각들이고,
# 값은 (표, 이름이 든 칸) 입니다. **지우기가 이 표 덕분에 이름을 남깁니다** —
# 창구가 지우기 전에 미리 읽어 두기 때문입니다.
NAMED_BY_PATH = {
    "news": (NewsPost, "title"),
    "notices": (Notice, "title"),
    "roadmap": (RoadmapItem, "title"),
    "links": (RelatedLink, "title"),
    "licenses": (License, "name"),
    "equipment": (Equipment, "name"),
    "equipment/licenses": (Equipment, "name"),
    "equipment/units": (EquipmentUnit, "label"),
    # 회원 쪽은 주소의 첫 식별자가 언제나 그 회원입니다. 권한·라이선스를 주고
    # 뺏는 기록도 "누구에게" 가 이름 자리에 와야 읽힙니다.
    "users": (User, "name"),
    "users/status": (User, "name"),
    "users/owner": (User, "name"),
    "users/permissions": (User, "name"),
    "users/licenses": (User, "name"),
    # 예약에는 제목이 없습니다. 덧붙인 말(`note`)은 선택 입력이라 비어 있을 수
    # 있으므로, 비면 아래 `_reservation_label` 이 장비와 시각으로 이름을 만듭니다.
    "reservations": (Reservation, "audit_label"),
    "reservations/decision": (Reservation, "audit_label"),
    "reservations/cancel": (Reservation, "audit_label"),
}


def note(request: Request, *, target: str | None = None, detail: str | None = None) -> None:
    """이 요청의 기록에 붙일 이름과 설명.

    **지우기 창구에서 특히 중요합니다.** 지우고 나면 이름을 알아낼 방법이 없어서,
    지우기 전에 여기에 담아 두어야 기록에 "'가을 워크숍' 을 지움" 으로 남습니다.
    담아 두지 않아도 기록은 남지만 이름 자리가 주소 조각으로 채워집니다.
    """
    state = getattr(request.state, "audit", None)
    if state is None:
        return
    if target is not None:
        state["target"] = target[:200]
    if detail is not None:
        state["detail"] = detail[:400]


def _looks_like_id(segment: str) -> bool:
    """주소 조각이 사람이 읽을 이름인지, 그냥 식별자인지."""
    return "-" in segment and len(segment) >= 32 or segment.isdigit()


def _shape(method: str, path: str) -> tuple[str, str, str]:
    """(동작, 영역, 주소에서 건진 이름).

    꼬리 조각은 **딸린 창구일 때만** 동작 이름으로 씁니다. `/users/{id}/licenses`
    의 `licenses` 는 "라이선스를 설정했다" 는 뜻이지만, `/licenses` 로 라이선스를
    새로 만드는 것은 그냥 '만듦' 입니다. 조각이 하나뿐이면 그 자체가 영역이므로
    동작은 방식(POST·PATCH·DELETE)에서 가져옵니다.
    """
    parts = [part for part in path.split("/") if part]
    tail = [part for part in parts if not _looks_like_id(part)]
    area = AREAS.get(tail[0], tail[0] if tail else "") if tail else ""
    fallback = BY_METHOD.get(method, method.lower())
    action = BY_TAIL.get(tail[-1], fallback) if len(tail) > 1 else fallback
    # 마지막 조각이 동작 이름이면 이름 자리로 쓰지 않습니다("삭제" 를 이름이라 할 수 없습니다).
    guess = "" if not tail or tail[-1] in BY_TAIL or len(tail) == 1 else tail[-1]
    return action, area, guess


async def _name_in(request: Request) -> tuple[str, dict]:
    """요청 본문에서 이름을 찾습니다. 본문은 뒤에서 다시 읽으므로 건드려도 됩니다.

    Starlette 은 한 번 읽은 본문을 들고 있어서, 여기서 읽어도 창구가 다시 읽을 때
    같은 값을 받습니다. 읽을 수 없는 요청(본문 없음·JSON 아님)은 그냥 넘어갑니다.
    """
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001 - 본문이 없거나 JSON 이 아니면 이름만 못 찾을 뿐이다
        return "", {}
    if not isinstance(body, dict):
        return "", {}
    for key in NAME_KEYS:
        value = body.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()[:200], body
    return "", body


async def _named_row(db: AsyncSession, tail: list[str], ids: list[str]) -> str:
    """주소가 가리키는 행의 이름. 찾을 수 없으면 빈 문자열.

    창구가 일하기 **전에** 부릅니다. 그래야 지우기에서도 이름이 남습니다.
    읽지 못해도 조용히 넘어갑니다 — 이름 한 칸 때문에 저장이 막히면 안 됩니다.
    """
    source = NAMED_BY_PATH.get("/".join(tail)) or NAMED_BY_PATH.get(tail[0] if tail else "")
    if not source or not ids:
        return ""
    model, column = source
    try:
        row = await db.get(model, UUID(ids[0]))
    except Exception:  # noqa: BLE001 - 식별자가 UUID 가 아니거나 표에 없을 뿐이다
        return ""
    return (getattr(row, column, "") or "")[:200] if row else ""


async def _save(db: AsyncSession, actor: User, state: dict) -> None:
    db.add(AuditLog(
        created_at=datetime.now(UTC),
        actor_id=actor.id,
        actor_name=actor.name or "",
        actor_email=actor.email or "",
        action=state["action"],
        area=state["area"],
        target=state["target"],
        detail=state["detail"],
        method=state["method"],
        path=state["path"],
    ))
    await db.commit()


async def audited(
    request: Request,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(current_user),
):
    """관리자 라우터 전체에 걸리는 기록 장치.

    쓰기가 **성공했을 때만** 남깁니다. 실패한 요청까지 남기면 "고쳤다" 는 기록과
    실제 상태가 어긋나고, 권한이 없어 튕긴 시도까지 수정 내역에 섞입니다.

    기록에 실패해도 요청은 성공한 채로 둡니다. 이미 저장이 끝난 뒤이므로 여기서
    오류를 내면 사용자에게는 "저장이 실패했다" 로 보이는데, 실제로는 저장돼
    있습니다. 그 어긋남이 기록 한 줄을 잃는 것보다 나쁩니다.
    """
    path = request.url.path
    if request.method in SAFE or any(path.endswith(probe) for probe in PROBES):
        yield
        return

    route = path.split("/api/v1/admin", 1)[-1]
    action, area, guess = _shape(request.method, route)
    parts = [part for part in route.split("/") if part]
    named = await _named_row(db, [part for part in parts if not _looks_like_id(part)],
                             [part for part in parts if _looks_like_id(part)])
    body_name, _ = await _name_in(request)
    request.state.audit = {
        "action": action, "area": area, "target": named or body_name or guess,
        "detail": "", "method": request.method, "path": path[:300],
    }

    yield  # 여기서 창구가 일을 합니다. 실패하면 아래로 내려오지 않습니다.

    try:
        await _save(db, actor, request.state.audit)
    except Exception as error:  # noqa: BLE001 - 기록 때문에 저장이 실패한 것처럼 보이면 안 된다
        logger.warning("수정 내역을 남기지 못했습니다 (%s %s): %s", request.method, path, error)
