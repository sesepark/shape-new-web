"""무료 티어를 얼마나 썼는지 모아서 관리자 '서버' 탭에 보여 줍니다.

## 왜 이 화면이 필요한가

무료 티어에서 한도를 넘기면 요금이 붙는 것이 아니라 **정지**합니다. Neon 은
compute 한도를 넘기면 다음 달까지 데이터베이스가 멈추고, 그러면 사이트 전체가
멈춥니다. 그런데 지금은 한도에 **닿아야** 알게 됩니다. 달 중간에 "이 속도면
언제 소진되는지" 를 볼 수 있으면 그 전에 손을 쓸 수 있습니다.

가장 먼저 차는 것은 Neon compute 입니다. 질의 횟수가 아니라 **깨어 있는 시간**
으로 세고, 우리 compute 는 0.25 CU 로 고정해 두었으므로 한 달 100 CU-시간은
곧 400시간, 하루 13.3시간입니다.

## 서비스마다 '한 달' 이 다릅니다

이 화면에서 가장 헷갈리기 쉬운 부분입니다. 같은 '월 한도' 라도 세는 방법이
다릅니다. 하나로 뭉뚱그리면 남은 여유를 잘못 읽게 되므로 서비스마다 나눠
보여 줍니다.

- **Neon — 달력 월.** 매월 1일 00:00 UTC 에 0 으로 돌아갑니다. 소비 기간의
  시작·끝을 API 가 직접 알려 주므로 추측하지 않습니다. 다만 **첫 기간은
  짧습니다** — 프로젝트를 만든 날부터 그 달 1일까지라, 8/23 에 만들었으면
  8/23~9/1 의 8.6일이 한 기간입니다. 그 기간만 보면 "한참 남았다" 로 읽히지만
  같은 속도로 30일을 채우면 전혀 다른 숫자가 되므로, 둘 다 냅니다.
- **Render — 달력 월.** 무료 인스턴스 시간 750과 대역폭이 매월 1일 초기화됩니다.
- **Cloudinary — 최근 30일 이동창.** 초기화되는 날이 아예 없습니다. 지금 값이
  곧 '지난 30일 합계' 이고, 하루가 지나면 가장 오래된 하루가 빠집니다. 그래서
  '기간 말 예상' 이라는 개념이 없습니다 — 지금 값이 이미 한 달치입니다.
  (저장 용량만은 이동창이 아니라 지금 이 순간의 총량입니다.)
- **Vercel — 최근 30일.** Hobby 는 청구 주기 자체가 없고, 한도를 넘기면 30일이
  지나야 풀립니다. 게다가 사용량 API 가 Hobby 에 열려 있지 않아 숫자를 못
  가져옵니다. 화면에는 한도와 주기만 밝혀 둡니다.

## 이 수집이 사용량을 늘리지 않게 하는 방법

사용량을 보는 일이 사용량을 늘리면 안 됩니다. 세 가지로 지킵니다.

- **데이터베이스를 건드리지 않습니다.** 여기서 부르는 곳은 전부 각 서비스의
  관리용 API(Neon 콘솔 API, Cloudinary Admin API)이고, Neon 콘솔 API 는
  **데이터베이스가 아니라 그 앞의 제어면**입니다. 잠들어 있는 compute 를 깨우지
  않습니다. 이 창구가 데이터베이스를 여는 것은 '누가 부르는지' 확인하는 로그인
  검사뿐인데, 그건 운영진이 관리자 화면을 여는 순간 어차피 일어나는 일입니다.
- **시계를 두지 않습니다.** 크론이나 주기적 수집이 있으면 아무도 안 볼 때도
  서버가 깨어 있어야 합니다. 운영진이 '서버' 탭을 열 때만 모읍니다.
- **여섯 시간 동안 들고 있습니다.** 한 달 단위로 관리하는 숫자라 실시간일 이유가
  없습니다. 탭을 여러 번 열어도 바깥으로 나가는 요청은 여섯 시간에 한 번입니다.
  지금 값이 꼭 필요하면 화면의 '다시 모으기' 로 그 한 번을 당길 수 있습니다.
"""

import asyncio
import logging
from datetime import UTC, datetime, timedelta

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)
TIMEOUT = 8.0

GB = 1024 ** 3
NEON_API = "https://console.neon.tech/api/v2"
RENDER_API = "https://api.render.com/v1"

# 무료 한도. 바뀌면 여기만 고칩니다.
NEON_COMPUTE_LIMIT = 100.0        # CU-시간 / 달력 월
NEON_STORAGE_LIMIT = 0.5          # GB, 지금 이 순간의 총량
NEON_EGRESS_LIMIT = 5.0           # GB / 달력 월
CLOUDINARY_CREDIT_LIMIT = 25.0    # 크레딧 / 최근 30일
RENDER_BANDWIDTH_LIMIT = 100.0    # GB / 달력 월
RENDER_MEMORY_LIMIT = 512.0       # MB, 지금 이 순간
RENDER_INSTANCE_HOURS = 750.0     # 시간 / 달력 월 (API 에 없어 안내만)
# compute 를 0.25 CU 로 고정해 두었으므로, 100 CU-시간은 곧 400시간입니다.
PINNED_CU = 0.25

CALENDAR = "calendar"   # 매월 1일 초기화
ROLLING = "rolling"     # 초기화 없음, 최근 N일 이동창
POINT = "point"         # 지금 이 순간의 값 (기간 개념 없음)


def _calendar_cycle(start: datetime | None = None, end: datetime | None = None) -> dict:
    """달력 월 주기. 매월 1일 00:00 UTC 에 0 으로 돌아갑니다.

    `start`/`end` 를 주면 그대로 씁니다 — Neon 은 소비 기간을 API 가 직접
    알려 주므로 우리가 계산해 어긋나게 만들 이유가 없습니다. 주지 않으면
    이번 달 1일부터 다음 달 1일까지로 잡습니다(Render 가 그렇습니다).
    """
    now = datetime.now(UTC)
    if start is None:
        start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if end is None:
        # 다음 달 1일. 12월이면 해가 넘어갑니다.
        end = start.replace(year=start.year + (start.month == 12), month=start.month % 12 + 1, day=1)
    elapsed = max((now - start).total_seconds() / 86400, 0.0)
    total = max((end - start).total_seconds() / 86400, elapsed or 1.0)
    return {
        "kind": CALENDAR,
        "label": "달력 월",
        "resets": end.isoformat(),
        "start": start.isoformat(),
        "end": end.isoformat(),
        "daysElapsed": round(elapsed, 2),
        "daysTotal": round(total, 2),
        "daysLeft": round(max(total - elapsed, 0), 2),
        "note": "매월 1일 00:00 UTC 에 0 으로 돌아갑니다.",
    }


def _rolling_cycle(days: int = 30, note: str = "") -> dict:
    """최근 N일 이동창. 초기화되는 날이 없습니다."""
    return {
        "kind": ROLLING,
        "label": f"최근 {days}일",
        "resets": None,
        "start": None,
        "end": None,
        "daysElapsed": None,
        "daysTotal": days,
        "daysLeft": None,
        "note": note or f"초기화되는 날이 없습니다. 하루가 지나면 가장 오래된 하루가 빠지고 오늘이 더해집니다. 지금 값이 곧 최근 {days}일 합계입니다.",
    }


def _level(ratio: float | None) -> str:
    """이 값이 어느 정도로 급한지. 화면의 색에 씁니다."""
    if ratio is None:
        return "unknown"
    if ratio >= 1:
        return "over"
    if ratio >= 0.85:
        return "crit"
    if ratio >= 0.7:
        return "warn"
    return "ok"


def _metric(key, label, used, limit, unit, *, cycle=None, hint=None, point=False):
    """한 줄짜리 계기.

    예상치를 내는 방식이 주기에 따라 다릅니다. **이 구분이 이 화면의 핵심입니다.**

    - **달력 월**이면 두 가지를 냅니다. `projected` 는 이번 기간이 끝날 때,
      `monthly` 는 30일을 꽉 채웠을 때. 한도가 실제로 걸리는 것은 앞이지만,
      계획에 쓰는 것은 뒤입니다. Neon 의 첫 기간처럼 짧은 기간에서는 두 값이
      크게 벌어집니다(실제로 22% 대 76%).
    - **이동창**이면 예상치를 내지 않습니다. 지금 값이 이미 한 달치라,
      거기에 또 배수를 곱하면 없는 사용량을 지어내는 것이 됩니다.
    - **`point`** 는 저장 용량·메모리처럼 '지금 이 순간의 총량' 입니다. 쌓이는
      값이 아니므로 역시 예상치가 없습니다.
    """
    ratio = None if not limit else used / limit
    projected = monthly = exhausts_on = None
    days_left_at_rate = None
    if not point and cycle and cycle["kind"] == CALENDAR:
        elapsed, total = cycle["daysElapsed"], cycle["daysTotal"]
        if elapsed and elapsed > 0:
            projected = used / elapsed * total
            monthly = used / elapsed * 30
            # 이 속도면 언제 바닥나는가. 남은 여유를 하루 평균 소모로 나눕니다.
            # 날짜로 적어 두면 "몇 퍼센트" 보다 훨씬 빨리 읽힙니다 — 달이 끝나기
            # 전에 손을 쓰라는 화면이므로 그 날짜가 곧 마감입니다.
            per_day = used / elapsed
            if limit and per_day > 0:
                days_left_at_rate = max((limit - used) / per_day, 0.0)
                exhausts_on = datetime.now(UTC) + timedelta(days=days_left_at_rate)
    candidates = [ratio] + [value / limit for value in (projected, monthly) if value and limit]
    worst = max([value for value in candidates if value is not None], default=None)
    return {
        "key": key,
        "label": label,
        "used": round(used, 4) if isinstance(used, (int, float)) else used,
        "limit": limit,
        "unit": unit,
        "ratio": round(ratio, 4) if ratio is not None else None,
        "projected": round(projected, 4) if projected is not None else None,
        "projectedRatio": round(projected / limit, 4) if projected and limit else None,
        "monthly": round(monthly, 4) if monthly is not None else None,
        "monthlyRatio": round(monthly / limit, 4) if monthly and limit else None,
        # 이 속도면 바닥나는 날. 이번 기간이 끝나기 전이면 화면이 날짜를 띄웁니다.
        "exhaustsOn": exhausts_on.isoformat() if exhausts_on else None,
        "exhaustsInDays": round(days_left_at_rate, 1) if days_left_at_rate is not None else None,
        "exhaustsBeforeReset": bool(
            exhausts_on and cycle and cycle.get("end") and exhausts_on.isoformat() < cycle["end"]),
        "basis": POINT if point else (cycle["kind"] if cycle else None),
        "level": _level(worst),
        "hint": hint,
    }


def _info(key, label, value, unit=None, hint=None):
    """한도가 없는 참고 값. 색을 입히지 않습니다."""
    return {"key": key, "label": label, "used": value, "limit": None, "unit": unit,
            "ratio": None, "projected": None, "projectedRatio": None,
            "monthly": None, "monthlyRatio": None, "exhaustsOn": None, "exhaustsInDays": None,
            "exhaustsBeforeReset": False, "basis": POINT, "level": "info", "hint": hint}


async def _neon(client: httpx.AsyncClient, key: str, project: str) -> dict:
    """Neon — 이 화면에서 가장 중요한 서비스입니다.

    두 곳을 봅니다. 프로젝트에서 소비량과 **소비 기간의 정확한 시작·끝**을,
    endpoint 에서 오토스케일 상한을 읽습니다. 상한은 사용량이 아니지만 **한도를
    얼마나 빨리 태울 수 있는지**를 정하므로 같이 보여 줍니다 — 0.25 로 고정해 둔
    것이 어쩌다 풀리면 같은 시간에 여덟 배까지 쓸 수 있습니다.
    """
    headers = {"Authorization": f"Bearer {key}"}
    project_response, endpoint_response = await asyncio.gather(
        client.get(f"{NEON_API}/projects/{project}", headers=headers),
        client.get(f"{NEON_API}/projects/{project}/endpoints", headers=headers),
        return_exceptions=True,
    )
    if isinstance(project_response, Exception):
        raise project_response
    project_response.raise_for_status()
    body = project_response.json()["project"]

    cycle = _calendar_cycle(
        datetime.fromisoformat(body["consumption_period_start"].replace("Z", "+00:00")),
        datetime.fromisoformat(body["consumption_period_end"].replace("Z", "+00:00")),
    )
    cycle["note"] = (
        "매월 1일 00:00 UTC 에 0 으로 돌아갑니다. 소비 기간은 Neon 이 직접 알려 준 값입니다."
        + (" 이번 기간은 프로젝트를 만든 날부터라 30일보다 짧습니다." if cycle["daysTotal"] < 29 else "")
    )

    metrics = [
        _metric("compute", "compute", body["compute_time_seconds"] / 3600, NEON_COMPUTE_LIMIT, "CU-시간",
                cycle=cycle,
                hint="넘기면 요금이 붙는 게 아니라 다음 달까지 데이터베이스가 정지합니다. 가장 먼저 차는 항목입니다."),
        _metric("awake", "깨어 있던 시간", body["active_time_seconds"] / 3600, NEON_COMPUTE_LIMIT / PINNED_CU, "시간",
                cycle=cycle,
                hint=f"compute 를 {PINNED_CU} CU 로 고정해 두어 한 달 {NEON_COMPUTE_LIMIT:.0f} CU-시간이 곧 {NEON_COMPUTE_LIMIT / PINNED_CU:.0f}시간입니다. 5분을 놀아야 잠듭니다."),
        _metric("egress", "전송량", body["data_transfer_bytes"] / GB, NEON_EGRESS_LIMIT, "GB", cycle=cycle),
        _metric("storage", "저장 용량", body["synthetic_storage_size"] / GB, NEON_STORAGE_LIMIT, "GB",
                cycle=cycle, point=True,
                hint="쌓이는 값이 아니라 지금 이 순간의 총량이라 초기화되지 않습니다. 넘기면 쓰기가 실패합니다."),
    ]

    scale = None
    if not isinstance(endpoint_response, Exception) and endpoint_response.status_code == 200:
        endpoints = endpoint_response.json().get("endpoints", [])
        if endpoints:
            spot = endpoints[0]
            low, high = spot.get("autoscaling_limit_min_cu"), spot.get("autoscaling_limit_max_cu")
            scale = {"min": low, "max": high, "state": spot.get("current_state")}
            metrics.append(_info(
                "autoscale", "오토스케일", f"{low} ~ {high} CU", None,
                "0.25 로 고정해 두었습니다. 상한이 풀리면 같은 시간에 최대 여덟 배까지 씁니다."
                if high == PINNED_CU else
                f"상한이 {high} CU 로 열려 있습니다. 0.25 로 고정하면 소진 속도가 안정됩니다.",
            ))
            metrics.append(_info(
                "state", "지금 상태",
                "깨어 있음" if spot.get("current_state") == "active" else "잠들어 있음",
                None, "잠들어 있는 동안에는 compute 를 쓰지 않습니다."))

    return {"service": "Neon", "role": "PostgreSQL 데이터베이스", "plan": body.get("owner", {}).get("subscription_type", "free"),
            "cycle": cycle, "metrics": metrics, "scale": scale}


async def _cloudinary(client: httpx.AsyncClient, cloud: str, key: str, secret: str) -> dict:
    """Cloudinary — 초기화되는 날이 없는 **최근 30일 이동창**입니다.

    변환·전송량이 지난 30일 합계로 계산되고, 하루가 지나면 가장 오래된 하루가
    빠집니다. 그래서 '언제 초기화되나' 를 물으면 답이 없고, '기간 말 예상' 도
    없습니다 — 지금 보이는 값이 이미 한 달치입니다. 저장 용량만은 이동창이
    아니라 지금 이 순간의 총량입니다.
    """
    response = await client.get(f"https://api.cloudinary.com/v1_1/{cloud}/usage", auth=(key, secret))
    response.raise_for_status()
    body = response.json()
    credits = body.get("credits", {})
    limit = float(credits.get("limit") or CLOUDINARY_CREDIT_LIMIT)
    cycle = _rolling_cycle(30)
    return {
        "service": "Cloudinary", "role": "사진·자료 저장", "plan": body.get("plan", "Free"),
        "cycle": cycle, "scale": None,
        "metrics": [
            _metric("credits", "크레딧", float(credits.get("usage", 0)), limit, "크레딧", cycle=cycle,
                    hint="저장·변환·전송을 하나로 환산한 값입니다. 1 크레딧 = 변환 1,000회 = 저장 1GB = 전송 1GB."),
            _metric("storage", "저장 용량", body.get("storage", {}).get("usage", 0) / 1e6, None, "MB",
                    cycle=cycle, point=True, hint="지금 이 순간의 총량입니다."),
            _info("bandwidth", "전송량", round(body.get("bandwidth", {}).get("usage", 0) / 1e6, 1), "MB", "최근 30일 합계입니다."),
            _info("transformations", "변환", body.get("transformations", {}).get("usage", 0), "회", "최근 30일 합계입니다."),
            _info("resources", "올라온 파일", body.get("resources", 0), "개"),
        ],
    }


async def _render(client: httpx.AsyncClient, key: str, service: str) -> dict:
    """Render — 달력 월 주기. 인스턴스 시간 750은 API 에 없어 안내만 합니다."""
    cycle = _calendar_cycle()
    headers = {"Authorization": f"Bearer {key}"}
    bandwidth, memory = await asyncio.gather(
        client.get(f"{RENDER_API}/metrics/bandwidth", headers=headers,
                   params={"resource": service, "startTime": cycle["start"]}),
        client.get(f"{RENDER_API}/metrics/memory", headers=headers,
                   params={"resource": service, "startTime": cycle["start"]}),
        return_exceptions=True,
    )
    metrics = []
    if not isinstance(bandwidth, Exception) and bandwidth.status_code == 200:
        total = sum(point["value"] for series in bandwidth.json() for point in series.get("values", []))
        metrics.append(_metric("bandwidth", "대역폭", total / 1024, RENDER_BANDWIDTH_LIMIT, "GB", cycle=cycle))
    if not isinstance(memory, Exception) and memory.status_code == 200:
        points = [point["value"] for series in memory.json() for point in series.get("values", [])]
        if points:
            metrics.append(_metric("memory", "메모리 최대", max(points) / 1e6, RENDER_MEMORY_LIMIT, "MB",
                                   cycle=cycle, point=True,
                                   hint="512 MB 를 넘으면 인스턴스가 재시작됩니다."))
    metrics.append(_info(
        "instance_hours", "인스턴스 시간", "API 에 없음", None,
        f"무료는 달력 월당 {RENDER_INSTANCE_HOURS:.0f}시간이고 15분 무응답이면 잠듭니다. 상시 가동되면 730시간이라 여유가 거의 없습니다."))
    return {"service": "Render", "role": "백엔드 서버", "plan": "free",
            "cycle": cycle, "metrics": metrics, "scale": None}


def _vercel_placeholder() -> dict:
    """Vercel — 숫자를 못 가져옵니다. 주기와 한도만 밝혀 둡니다.

    Hobby 는 청구 주기 자체가 없고, 한도를 넘기면 30일이 지나야 풀립니다.
    사용량 API 는 Hobby 에 열려 있지 않아(불러 보면 404/400) 대시보드에서만
    볼 수 있습니다. 화면에서 이 칸을 아예 빼면 "Vercel 은 왜 없지" 가 되므로,
    왜 없는지를 적어 둡니다.
    """
    return {
        "service": "Vercel", "role": "프런트엔드", "plan": "hobby",
        "cycle": _rolling_cycle(30, "Hobby 는 청구 주기가 없습니다. 한도를 넘기면 30일이 지나야 풀립니다."),
        "scale": None, "unavailable": "사용량 API 가 Hobby 요금제에 열려 있지 않아 숫자를 가져올 수 없습니다. Vercel 대시보드에서 확인하세요.",
        "metrics": [
            _info("active_cpu", "Active CPU", "대시보드에서 확인", None, "한도 4 CPU-시간"),
            _info("image", "이미지 변환", "대시보드에서 확인", None, "한도 5,000회. 사진이 늘면 여기가 먼저 찹니다."),
            _info("edge", "Edge 요청", "대시보드에서 확인", None, "한도 100만"),
            _info("deploys", "배포", "대시보드에서 확인", None, "한도 하루 100회. 이것만 달력 하루 기준입니다."),
        ],
    }


async def snapshot() -> dict:
    """지금 시점의 사용량. 바깥으로 나가는 요청은 여기서만 일어납니다.

    한 서비스가 실패해도 나머지는 그대로 보여 줍니다. 하나 때문에 전부 안 보이면
    정작 급한 Neon 을 못 봅니다.
    """
    settings = get_settings()
    services: list[dict] = []
    problems: dict[str, str] = {}

    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        jobs: list[tuple[str, object]] = []
        if settings.neon_api_key and settings.neon_project_id:
            jobs.append(("Neon", _neon(client, settings.neon_api_key, settings.neon_project_id)))
        else:
            problems["Neon"] = "NEON_API_KEY 와 NEON_PROJECT_ID 가 설정되지 않았습니다."
        if all([settings.cloudinary_cloud_name, settings.cloudinary_api_key, settings.cloudinary_api_secret]):
            jobs.append(("Cloudinary", _cloudinary(
                client, settings.cloudinary_cloud_name, settings.cloudinary_api_key, settings.cloudinary_api_secret)))
        else:
            problems["Cloudinary"] = "Cloudinary 설정이 없습니다."
        if settings.render_api_key and settings.render_service_id:
            jobs.append(("Render", _render(client, settings.render_api_key, settings.render_service_id)))
        else:
            problems["Render"] = "RENDER_API_KEY 를 넣지 않았습니다. 계정 전체 권한 키라 일부러 비워 두었습니다."

        done = await asyncio.gather(*(job for _, job in jobs), return_exceptions=True)

    for (name, _), result in zip(jobs, done, strict=True):
        if isinstance(result, Exception):
            logger.warning("사용량을 읽지 못했습니다 (%s): %s", name, result)
            problems[name] = "지금 읽지 못했습니다."
        else:
            services.append(result)

    services.append(_vercel_placeholder())
    return {
        "collectedAt": datetime.now(UTC).isoformat(),
        "services": services,
        "problems": problems,
    }
