"""겹친 신청을 골라내고 줄 세우는 일.

같은 시간에 신청이 둘 들어오면 자동 확정이 멈추고 사람이 정해야 한다
(`reservations.try_auto_approve`). 그때 운영진이 보는 화면에 필요한 두 가지를
여기서 만든다 — **무엇과 무엇이 겹쳤는지**, 그리고 **어느 쪽을 먼저 보면 되는지**.

둘 다 질의를 더 내지 않는다. 이미 읽어 온 목록 안에서 계산한다.
"""

from datetime import UTC, datetime
from uuid import UUID

from app.models import Reservation, ReservationPurpose, ReservationStatus, ReservationUrgency

URGENCY_POINTS = {
    ReservationUrgency.HIGH: 40,
    ReservationUrgency.NORMAL: 20,
    ReservationUrgency.LOW: 0,
}
PURPOSE_POINTS = {
    ReservationPurpose.CONTEST: 30,
    ReservationPurpose.SHAPE_UP: 20,
    ReservationPurpose.EDUCATION: 15,
    ReservationPurpose.OTHER: 0,
}
URGENCY_LABEL = {
    ReservationUrgency.HIGH: "매우 시급",
    ReservationUrgency.NORMAL: "보통",
    ReservationUrgency.LOW: "낮음",
}
PURPOSE_LABEL = {
    ReservationPurpose.CONTEST: "대회",
    ReservationPurpose.SHAPE_UP: "SHAPE-UP",
    ReservationPurpose.EDUCATION: "교육",
    ReservationPurpose.OTHER: "기타",
}
# 오래 기다린 신청을 조금씩 올려 준다. 상한을 두는 이유는, 기다림만으로 시급한
# 대회 신청을 밀어내면 안 되기 때문이다.
WAIT_POINTS_PER_DAY = 5
WAIT_POINTS_MAX = 20


def _utc(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def pending_conflicts(items) -> dict[UUID, list[UUID]]:
    """같은 호기에서 시간이 겹치는 **대기** 신청끼리 서로를 가리키게 한다.

    확정된 예약은 여기 오지 않는다. 그쪽 겹침은 `uq_reservation_slot` 이 이미
    막았고, 운영진이 고민해야 하는 것은 '둘 다 아직 대기인' 경우뿐이다.

    **찾는 범위는 넘겨받은 목록 안이다.** `?status=PENDING` 으로 부르면 대기 신청이
    전부 들어오므로 정확하다. 상태를 섞어 부르면서 `limit` 을 넘기면 짝이 목록
    밖에 있을 수 있으므로, 관리 화면의 겹침 보기는 반드시 대기만 불러야 한다.
    """
    by_unit: dict = {}
    for item in items:
        if item.status == ReservationStatus.PENDING:
            by_unit.setdefault(item.equipment_unit_id, []).append(item)
    out: dict[UUID, list[UUID]] = {}
    for group in by_unit.values():
        group.sort(key=lambda row: _utc(row.starts_at))
        for index, left in enumerate(group):
            for right in group[index + 1:]:
                if _utc(right.starts_at) >= _utc(left.ends_at):
                    break  # 시작순으로 정렬돼 있으므로 뒤쪽은 더 볼 것이 없다
                out.setdefault(left.id, []).append(right.id)
                out.setdefault(right.id, []).append(left.id)
    return out


def score(item: Reservation, now: datetime | None = None) -> tuple[int, list[str]]:
    """추천 점수와 그 근거.

    **추천일 뿐 결정이 아니다.** 자동 확정은 겹침이 있으면 아예 손대지 않으므로
    이 점수가 무언가를 스스로 정하는 자리는 없다. 운영진 화면에서 '이 순서로
    보시면 됩니다' 를 제안할 뿐이다.

    근거를 함께 돌려주는 것이 핵심이다. 왜 그 순서인지 못 보여 주는 점수는
    운영진이 믿을 수도, 반박할 수도 없다.

    사용 이력이나 사진 제출 여부는 넣지 않는다. 그 둘을 빼면 질의가 하나도 늘지
    않고, 사진 관련 판단은 이번에 손대지 않기로 한 영역이다.
    """
    now = now or datetime.now(UTC)
    total, reasons = 0, []

    urgency_points = URGENCY_POINTS.get(item.urgency, 0)
    if urgency_points:
        total += urgency_points
        reasons.append(f"{URGENCY_LABEL.get(item.urgency, '')} +{urgency_points}")

    purpose_points = PURPOSE_POINTS.get(item.purpose_category, 0)
    if purpose_points:
        total += purpose_points
        reasons.append(f"{PURPOSE_LABEL.get(item.purpose_category, '')} +{purpose_points}")

    if item.created_at:
        days = max(0, int((now - _utc(item.created_at)).total_seconds() // 86400))
        waited = min(days * WAIT_POINTS_PER_DAY, WAIT_POINTS_MAX)
        if waited:
            total += waited
            reasons.append(f"{days}일 기다림 +{waited}")

    return total, reasons
