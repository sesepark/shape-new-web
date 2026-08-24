"""공개 읽기 응답을 잠시 들고 있는 인메모리 TTL 캐시.

Neon 무료 티어는 질의 **횟수**가 아니라 **깨어 있는 시간**으로 계산합니다.
100 CU-시간이 한 달치인데, 0.25 CU 로 환산하면 약 400시간(하루 13.3시간)입니다.
그런데 Neon 은 5분만 놀면 잠들고, 공개 페이지 재검증 주기도 5분이었습니다.
방문이 5분에 한 번만 이어져도 재검증이 백엔드를 부르고, 그 질의가 잠들기
직전의 타이머를 계속 되살려서, 트래픽이 있는 시간 내내 compute 가 깨어 있게
됩니다. 하루 16시간이면 월 480시간 = 120 CU-시간으로 한도를 넘습니다.
넘으면 요금이 붙는 게 아니라 **다음 달까지 데이터베이스가 정지**합니다.

그래서 재검증이 와도 Neon 까지 내려가지 않도록 여기서 한 번 막습니다.
`docs/free-tier-deployment.md` 는 원래 이 장치를 "스무 명 규모엔 과하다"며
일부러 빼 두었는데, 이백 명 기준에서는 판단이 뒤집힙니다.

구조는 `~/Projects/cookierunhub` 의 `backend/src/cache.py` 를 따릅니다.
"""

import time
from typing import Any

_store: dict[str, tuple[float, Any]] = {}
# Render 무료 인스턴스는 메모리가 넉넉하지 않습니다. 공개 창구는 열 몇 개뿐이라
# 평소에는 이 근처도 가지 않지만, 질의 문자열이 붙는 주소(`/news?category=…`)가
# 있어 상한을 둡니다.
_MAX_ENTRIES = 256


def _prune(now: float) -> None:
    """만료된 항목을 지우고, 그래도 넘치면 만료가 가까운 것부터 버립니다."""
    for key in [key for key, (expires_at, _) in _store.items() if now > expires_at]:
        _store.pop(key, None)
    overflow = len(_store) - _MAX_ENTRIES
    if overflow > 0:
        for key in sorted(_store, key=lambda key: _store[key][0])[:overflow]:
            _store.pop(key, None)


def get(key: str) -> Any | None:
    """캐시에 든 값. 없거나 만료됐으면 None."""
    entry = _store.get(key)
    if entry is None:
        return None
    expires_at, value = entry
    if time.monotonic() > expires_at:
        _store.pop(key, None)
        return None
    return value


def set(key: str, value: Any, ttl: int) -> None:  # noqa: A001 - cookierunhub 와 같은 이름을 씁니다
    """값을 ttl 초 동안 들고 있습니다."""
    now = time.monotonic()
    _prune(now)
    _store[key] = (now + ttl, value)


def clear() -> None:
    """전부 버립니다.

    운영진이 무언가를 저장하면 호출됩니다. 어떤 창구가 영향을 받는지 일일이
    짝지어 두면 새 창구를 넣을 때마다 그 표를 같이 고쳐야 하고, 빠뜨리면
    공개 페이지가 조용히 옛 내용을 보여 줍니다. 저장은 하루에 몇 번뿐이라
    통째로 버리는 편이 안전하고 값도 싸다.
    """
    _store.clear()


def size() -> int:
    """지금 들고 있는 항목 수. 시험에서 씁니다."""
    return len(_store)
