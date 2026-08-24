"""공개 읽기 응답을 잠시 들고 있는 인메모리 캐시.

Neon 무료 티어는 질의 **횟수**가 아니라 **깨어 있는 시간**으로 계산합니다.
한 달치가 100 CU-시간인데 우리 compute 는 최소 0.25 CU 라, 환산하면 약
400시간(하루 13.1시간)만 깨어 있을 수 있습니다. 그런데 Neon 은 5분만 놀면
잠들고, 공개 페이지 재검증 주기도 5분이었습니다. 방문이 5분에 한 번만
이어져도 재검증이 백엔드를 부르고, 그 질의가 잠들기 직전의 타이머를 계속
되살립니다. 실제로 베타 이용자 다섯 명만으로도 compute 가 전체 시간의 33%
동안 깨어 있었고, 그대로면 한 달에 64 CU-시간을 씁니다. 한도를 넘으면 요금이
붙는 게 아니라 **다음 달까지 데이터베이스가 정지**합니다.

## 왜 그냥 TTL 이 아니라 '창'인가

여기서 중요한 것은 질의를 줄이는 것이 아니라 **질의가 일어나는 시각을 한데
모으는 것**입니다. 깨어 있는 시간이 곧 비용이므로, 한 번 깨었을 때 열 건을
처리하는 것은 한 건을 처리하는 것과 값이 같습니다. 반대로 열 건이 6분 간격으로
흩어지면 잠들 틈이 없어 값이 열 배가 됩니다.

그래서 항목마다 "저장 시각 + TTL" 로 따로 만료시키지 않고, 시계에 고정된
같은 경계에서 **다 같이** 만료시킵니다. 그러면 경계가 지난 직후 공개 창구들이
한꺼번에 데이터베이스를 한 번 깨우고, 남은 시간 내내 조용합니다.

구조는 `~/Projects/cookierunhub` 의 `backend/src/cache.py` 를 따릅니다. 다른
점은 이 창 정렬 하나이고, 그쪽은 집서버라 잠들 걱정이 없어 필요가 없었습니다.
"""

import time
from typing import Any

_store: dict[str, tuple[float, Any]] = {}
# Render 무료 인스턴스는 메모리가 넉넉하지 않습니다. 공개 창구는 열 몇 개뿐이라
# 평소에는 이 근처도 가지 않지만, 질의 문자열이 붙는 주소(`/news?category=…`)가
# 있어 상한을 둡니다.
_MAX_ENTRIES = 256


def window_end(window: int, now: float | None = None) -> float:
    """지금이 속한 창이 끝나는 시각.

    `window` 초짜리 칸을 시계에 고정해 두고 그 칸의 끝을 돌려줍니다. 언제
    저장했든 같은 칸에 들어온 항목은 같은 순간에 함께 만료됩니다.
    """
    current = time.time() if now is None else now
    return (int(current) // window + 1) * window


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
    if time.time() > expires_at:
        _store.pop(key, None)
        return None
    return value


def set(key: str, value: Any, window: int) -> None:  # noqa: A001 - cookierunhub 와 같은 이름을 씁니다
    """값을 지금 속한 창이 끝날 때까지 들고 있습니다."""
    now = time.time()
    _prune(now)
    _store[key] = (window_end(window, now), value)


def clear() -> None:
    """전부 버립니다.

    운영진이 무언가를 저장하면 호출됩니다. 어떤 창구가 영향을 받는지 일일이
    짝지어 두면 새 창구를 넣을 때마다 그 표를 같이 고쳐야 하고, 빠뜨리면
    공개 페이지가 조용히 옛 내용을 보여 줍니다. 저장은 하루에 몇 번뿐이라
    통째로 버리는 편이 안전하고 값도 쌉니다.
    """
    _store.clear()


def size() -> int:
    """지금 들고 있는 항목 수. 시험에서 씁니다."""
    return len(_store)
