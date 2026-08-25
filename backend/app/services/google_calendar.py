"""승인된 AI Worker 예약을 동아리 공유 구글 캘린더에 올립니다.

'휴머노이드 운용' 캘린더는 SHAPE 만 쓰는 것이 아닙니다. 장비를 함께 쓰는 다른
분들이 그 캘린더 하나로 방과 장비의 사정을 봅니다. 그래서 예약이 확정되면 그
자리에 바로 보여야 하는데, 지금까지는 예약한 사람이 사이트에서 신청하고 캘린더에
같은 일정을 한 번 더 손으로 적었습니다. 두 번 적으니 빠뜨리거나 서로 어긋납니다.

**어떻게 쓰는가.** 구글 서비스 계정(`shape-calendar@…iam.gserviceaccount.com`)을
그 캘린더에 '변경' 권한으로 초대해 두었습니다. 사람 계정을 흉내 내는 것이 아니라
서비스 계정 자신의 자격으로 씁니다. 그래서 구글 로그인 동의도, 앱 심사도, 만료되는
갱신 토큰도 없습니다. 열쇠(JSON)는 저장소에 두지 않고 환경 변수로만 옵니다.

**일정 번호를 따로 저장하지 않습니다.** 예약 id 에서 일정 id 를 계산해 냅니다
(`shape` + UUID 의 16진수). 새 컬럼이 필요 없고, 무엇보다 '캘린더에는 만들었는데
번호를 저장하기 전에 죽는' 어중간한 상태가 생기지 않습니다. 취소할 때도 같은
계산으로 지울 것을 찾습니다.

**실패해도 예약은 성공입니다.** 구글이 느리거나 막혀도 승인 자체가 막히면 안
됩니다. 요청과 따로 떼어 보내고, 실패하면 기록만 남깁니다.
"""

import asyncio
import json
import logging
import time
import urllib.parse
from datetime import datetime
from zoneinfo import ZoneInfo

import httpx
import jwt

from app.config import get_settings

logger = logging.getLogger(__name__)

SEOUL = ZoneInfo("Asia/Seoul")
TIMEOUT = 8.0
API = "https://www.googleapis.com/calendar/v3/calendars"
# 일정을 만들고 지우는 것만 합니다. 캘린더 자체의 설정은 읽지도 쓰지도 않습니다.
SCOPE = "https://www.googleapis.com/auth/calendar.events"
# 이 장비의 예약만 캘린더로 보냅니다. '휴머노이드 운용' 캘린더는 그 이름대로
# 휴머노이드 장비의 일정을 보는 곳이라, 다른 장비까지 올리면 남의 달력을 채웁니다.
EQUIPMENT = "AI Worker"

# revalidate 와 같은 이유로 붙들어 둡니다. asyncio 는 태스크를 약한 참조로만
# 들고 있어서, 여기서 잡지 않으면 보내는 도중에 회수될 수 있습니다.
_running: set[asyncio.Task] = set()
# 접근 토큰은 한 시간짜리입니다. 매번 새로 받으면 승인할 때마다 구글에 요청이
# 한 번 더 갑니다. 만료 1분 전까지 그대로 씁니다.
_token: tuple[str, float] | None = None


def configured() -> bool:
    settings = get_settings()
    return bool(settings.google_calendar_id and settings.google_service_account_json)


def _key() -> dict:
    return json.loads(get_settings().google_service_account_json)


def _hhmm(moment: datetime, meridiem: bool = True) -> str:
    """'오후 2:30' · '8시'. 정각이면 분을 적지 않습니다."""
    head = "오전" if moment.hour < 12 else "오후"
    twelve = moment.hour % 12 or 12
    core = f"{twelve}시" if moment.minute == 0 else f"{twelve}:{moment.minute:02d}"
    return f"{head} {core}" if meridiem else core


def span(starts_at: datetime, ends_at: datetime) -> str:
    """'오후 2:30~8시'. 오전·오후가 같고 날짜도 같으면 뒤쪽은 되풀이하지 않습니다."""
    start, end = starts_at.astimezone(SEOUL), ends_at.astimezone(SEOUL)
    same = start.date() == end.date() and (start.hour < 12) == (end.hour < 12)
    return f"{_hhmm(start)}~{_hhmm(end, meridiem=not same)}"


def title(user_name: str, equipment_name: str, starts_at: datetime, ends_at: datetime) -> str:
    """'SHAPE: 장하람 AI WORKER 오후 2:30~8시'.

    이 캘린더에 이미 쌓여 있는 일정들이 손으로 적은 같은 모양이라, 새로 올라가는
    일정만 다르게 생기면 한 달력 안에서 두 가지 형식이 섞입니다.
    """
    return f"SHAPE: {user_name} {equipment_name.upper()} {span(starts_at, ends_at)}"


def event_id(reservation_id) -> str:
    """예약 id 에서 계산해 내는 일정 id.

    구글은 일정 id 로 base32hex(0-9, a-v)만 받습니다. UUID 의 16진수는 그 안에
    들어가므로 그대로 쓰고, 남의 일정과 섞이지 않게 앞에 표시를 붙입니다.
    """
    return f"shape{reservation_id.hex}"


async def _access_token(client: httpx.AsyncClient) -> str:
    global _token
    if _token and _token[1] > time.time():
        return _token[0]
    key = _key()
    now = int(time.time())
    assertion = jwt.encode(
        {"iss": key["client_email"], "scope": SCOPE, "aud": key["token_uri"], "iat": now, "exp": now + 3600},
        key["private_key"],
        algorithm="RS256",
    )
    response = await client.post(
        key["token_uri"],
        data={"grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion": assertion},
    )
    response.raise_for_status()
    body = response.json()
    _token = (body["access_token"], time.time() + int(body.get("expires_in", 3600)) - 60)
    return _token[0]


def _events_url() -> str:
    return f"{API}/{urllib.parse.quote(get_settings().google_calendar_id, safe='')}/events"


async def _put(body: dict) -> None:
    """일정을 올립니다. 이미 있으면 그 자리를 덮어씁니다."""
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        headers = {"Authorization": f"Bearer {await _access_token(client)}"}
        response = await client.post(_events_url(), headers=headers, json=body)
        if response.status_code == 409:
            # 같은 예약을 두 번 승인한 경우입니다(승인 → 취소 → 재승인은 없지만,
            # 단추를 두 번 누르는 일은 있습니다). 새로 만들지 않고 맞춰 둡니다.
            response = await client.put(f"{_events_url()}/{body['id']}", headers=headers, json=body)
        response.raise_for_status()


async def _delete(identifier: str) -> None:
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        headers = {"Authorization": f"Bearer {await _access_token(client)}"}
        response = await client.delete(f"{_events_url()}/{identifier}", headers=headers)
        # 404·410 은 이미 없다는 뜻입니다. 지우려던 목적은 이미 이뤄졌습니다.
        if response.status_code not in {404, 410}:
            response.raise_for_status()


def _spawn(what: str, action) -> None:
    async def guarded() -> None:
        try:
            await action()
        except Exception as error:  # noqa: BLE001 - 캘린더 때문에 예약이 막히면 안 된다
            global _token
            _token = None  # 토큰이 상한 경우일 수 있으니 다음에 새로 받는다
            logger.warning("구글 캘린더 %s 실패: %s", what, error)

    task = asyncio.create_task(guarded())
    _running.add(task)
    task.add_done_callback(_running.discard)


def publish(
    reservation_id,
    *,
    user_name: str,
    equipment_name: str,
    starts_at: datetime,
    ends_at: datetime,
    purpose: str = "",
    companions: list[str] | None = None,
) -> None:
    """확정된 예약을 캘린더에 올립니다. 기다리지 않고 보냅니다."""
    if not configured() or equipment_name != EQUIPMENT:
        return
    lines = [f"사용 목적: {purpose.strip()}"] if purpose.strip() else []
    if companions:
        lines.append(f"함께 쓰는 사람: {', '.join(companions)}")
    lines.append(f"신청: {user_name}")
    lines.append(f"{get_settings().frontend_url}/mypage 에서 확인할 수 있습니다.")
    body = {
        "id": event_id(reservation_id),
        "summary": title(user_name, equipment_name, starts_at, ends_at),
        "description": "\n".join(lines),
        # 시간대를 함께 보냅니다. 캘린더를 보는 사람이 어느 시간대에 있든 한국
        # 시각의 그 시간으로 읽히게 하기 위해서입니다.
        "start": {"dateTime": starts_at.astimezone(SEOUL).isoformat(), "timeZone": "Asia/Seoul"},
        "end": {"dateTime": ends_at.astimezone(SEOUL).isoformat(), "timeZone": "Asia/Seoul"},
        "source": {"title": "SHAPE 장비 예약", "url": f"{get_settings().frontend_url}/equipment/reserve"},
    }
    _spawn("등록", lambda: _put(body))


def withdraw(reservation_id, equipment_name: str) -> None:
    """예약이 취소되면 캘린더에서도 지웁니다."""
    if not configured() or equipment_name != EQUIPMENT:
        return
    _spawn("삭제", lambda: _delete(event_id(reservation_id)))
