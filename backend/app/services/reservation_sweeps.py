"""시계가 대신 누르는 것들.

예약은 사람이 신청하고 사람이 승인한다. 그런데 승인하는 사람이 늘 화면 앞에 있는
것은 아니고, 그동안 장비는 비어 있다. 여기서는 두 가지를 시계가 대신한다.

* **자동 확정** — 시작까지 한 시간 이하로 남았고 같은 시간에 다투는 신청이 없으면
  확정한다. 규칙 자체는 `reservations.try_auto_approve` 한 곳에 있고, 여기서는
  대상을 골라 넘겨줄 뿐이다.
* **자동 만료** — 아무도 손대지 않은 채 사용 시간이 다 지나간 신청을 닫는다.
  그대로 두면 예약 현황 달력과 관리자 목록에 지난 신청이 끝없이 쌓인다.

`reservation_alerts.sweep_due` 안에 넣지 않는 이유가 셋 있다.

1. 그쪽은 **알림**만 만드는 곳이다. 여기는 상태를 바꾸고 구글 캘린더에도 쓴다.
2. `sweep_due` 는 끝에 한 번 커밋하는데 `approve`·`cancel` 은 안에서 커밋한다.
   한 함수에 섞으면 트랜잭션 경계를 따라갈 수 없다.
3. 이미 있는 시험이 `sweep_due` 가 **아무것도 결정하지 않는다**는 것에 기대고 있다.

크론은 두지 않는다. 무료 요금제에서는 주기적으로 서버를 깨우는 것 자체가 비용이라,
`middleware` 가 로그인한 사람의 요청에 얹어 부른다. 아무도 들어오지 않는 새벽에는
늦어질 수 있지만, **쓰러 오는 사람 본인의 접속이 훑기를 깨우므로** 실제로 장비 앞에
선 순간에는 거의 항상 처리되어 있다.
"""

import logging
from datetime import UTC, datetime

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Reservation, ReservationStatus
from app.services import reservation_policy
from app.services.reservation_alerts import label, tell_owner, when
from app.services.reservations import try_auto_approve

logger = logging.getLogger(__name__)

# 한 번에 처리할 최대 건수. 한 사람의 요청에 얹혀 도는 일이라 길어지면 안 된다.
BATCH = 20


async def sweep_auto_decisions(db: AsyncSession) -> list[tuple[str, str, list[dict]]]:
    """때가 된 신청을 확정하고, 지나간 신청을 만료시킨다.

    `sweep_due` 와 같은 모양 — (제목, 본문, 기기목록) 목록 — 으로 돌려주므로
    미들웨어의 푸시 전송 고리를 그대로 쓴다.
    """
    now = datetime.now(UTC)
    out: list[tuple[str, str, list[dict]]] = []
    # 자동 확정 시점은 관리자 화면에서 정합니다. 여기서 고른 대상과
    # `try_auto_approve` 의 판정이 같은 값을 봐야 하므로, 규칙이 아니라 값만
    # 읽어 씁니다.
    lead = (await reservation_policy.current(db)).auto_approve_lead

    waiting = (await db.scalars(
        select(Reservation).where(
            Reservation.status == ReservationStatus.PENDING,
            Reservation.starts_at <= now + lead,
            Reservation.ends_at > now,
        ).order_by(Reservation.created_at).limit(BATCH)
    )).all()
    for item in waiting:
        name = await label(db, item)
        try:
            confirmed = await try_auto_approve(db, item)
        except HTTPException:
            # 한 건이 안 되는 것 때문에 나머지까지 멈추면 안 된다.
            await db.rollback()
            continue
        except Exception:  # noqa: BLE001 - 훑기가 요청을 실패시키면 안 된다
            await db.rollback()
            logger.exception("자동 확정에 실패했습니다: %s", item.id)
            continue
        if confirmed:
            title = f"예약이 자동으로 확정되었습니다 · {name} · {when(item.starts_at)}"
            out.append((title, "시간이 되면 사용 전 사진을 올리고 시작해 주세요.",
                        await tell_owner(db, item, title)))

    stale = (await db.scalars(
        select(Reservation).where(
            Reservation.status == ReservationStatus.PENDING,
            Reservation.ends_at <= now,
        ).limit(BATCH)
    )).all()
    for item in stale:
        name = await label(db, item)
        item.status = ReservationStatus.EXPIRED
        item.auto_decided_at = now
        title = f"신청한 시간이 지나 자동으로 만료되었습니다 · {name} · {when(item.starts_at)}"
        out.append((title, "다시 쓰시려면 새로 신청해 주세요.", await tell_owner(db, item, title)))

    if stale:
        # 확정 쪽은 `try_auto_approve` 가 스스로 커밋한다. 만료만 여기서 닫는다.
        await db.commit()
    return out
