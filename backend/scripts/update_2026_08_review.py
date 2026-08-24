"""동아리 소개 · 조직도 · 보유 장비 · 로드맵을 운영진 검토 의견대로 고친다.

운영 DB 의 내용은 이미 관리자 페이지에서 여러 번 손질되어 ``dev_content.py`` 의
값과 다르다. 그래서 시드를 다시 돌리지 않고, **지금 DB 에 있는 문장을 찾아서 그
자리만 바꾸는** 방식으로 고친다. 찾는 문장이 없으면 그 항목은 건너뛰고 알린다.
두 번 돌려도 이미 바뀐 자리는 다시 바뀌지 않는다.

고치는 것

1. 동아리 소개 — 트랙을 화·수·목 순서로 재배치, 인원수(준회원 40명) 삭제,
   대회 트랙에서 특정 대회명 삭제, 장비 문단을 실제 보유 목록에 맞춤,
   "전공은 묻지 않습니다" → "전공은 중요하지 않습니다 · 12개 학과".
2. 조직도 — 총무를 부원 페이지와 같은 순서(회장·부회장 다음)로 올린다.
3. 보유 장비 — MANUS 데이터 글러브와 그 운용 교육을 추가한다.
4. 로드맵 — 2기 면접을 9월 12일까지로 늘리고, 합격자 발표를 9월 13일로 미룬다.
5. 동아리 소개 숫자 띠 — 학기마다 달라지는 '2기 부원 70+' 를 뺀다. 남는 셋이
   마침 칸 수(3열)와 맞아 줄이 접히지도 않는다.

    cd backend
    DATABASE_URL="<Neon pooled URL>" SESSION_SECRET="<아무 값>" \
        .venv/bin/python scripts/update_2026_08_review.py --dry-run
"""

import asyncio
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from sqlalchemy import select

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import SessionLocal, engine  # noqa: E402
from app.models import (  # noqa: E402
    ContentPage,
    Equipment,
    EquipmentLicenseRequirement,
    EquipmentStatus,
    EquipmentUnit,
    License,
    RoadmapItem,
)

SEOUL = ZoneInfo("Asia/Seoul")


def at(year: int, month: int, day: int, hour: int = 0, minute: int = 0) -> datetime:
    return datetime(year, month, day, hour, minute, tzinfo=SEOUL)


# ------------------------------------------------------------------ 4. 로드맵
#
# 면접 기간을 하루 늘리고 발표를 그만큼 미룬다. 제목으로 찾고, 이미 그 날짜면
# 건너뛴다. (제목, 시작, 끝) — 끝이 None 이면 끝 시각이 없는 일정이다.
ROADMAP_FIXES = [
    ("2기 면접", at(2026, 9, 10, 9), at(2026, 9, 12, 23)),
    ("2기 합격자 발표", at(2026, 9, 13, 9), None),
]

# --------------------------------------------------------- 1. 동아리 소개 문장
#
# (설명, 찾을 문장, 바꿀 문장). 찾을 문장은 지금 DB 에 들어 있는 값 그대로다.

EDU_OLD = (
    "<p><strong>교육 트랙(목요일)</strong> — 준회원 40명을 대상으로 한 학기 10회 "
    "과정입니다."
)
EDU_NEW = (
    "<p><strong>교육 트랙(목요일)</strong> — 준회원을 대상으로 하는 한 학기 10회 "
    "과정입니다."
)

CONTEST_OLD = (
    "<p><strong>대회 트랙(수요일)</strong> — 마트 환경 기반 휴머노이드 로봇 챌린지와 "
    "RoboCup@Home을 하나의 서비스 로봇 프로젝트로 통합해 운영합니다. Bringup, "
    "Localization과 Navigation, 사람·물체 인식, Manipulation, Task Planning처럼 두 "
    "대회가 공유하는 기술을 먼저 하나의 기반 시스템으로 만들고, 대회별 요구사항을 그 "
    "위에 얹습니다.</p>"
)
CONTEST_NEW = (
    "<p><strong>대회 트랙(수요일)</strong> — 국내외 로봇 대회 출전을 준비하는 "
    "트랙입니다. 나가는 대회는 학기마다 달라지지만 준비에 필요한 기술은 크게 "
    "겹칩니다. Bringup, Localization과 Navigation, 사람·물체 인식, Manipulation, "
    "Task Planning처럼 여러 대회가 공유하는 기술을 하나의 휴머노이드 서비스 로봇 "
    "기반 시스템으로 먼저 만들고, 대회별 요구사항을 그 위에 얹습니다. 이번 학기에 "
    "준비하는 대회는 로드맵과 소식에서 확인할 수 있습니다.</p>"
)

EQUIP_OLD = (
    "<p>AI Worker 양팔 플랫폼, OMY 로봇 팔 2대, LeRobot SO-ARM 101, Tesollo·Robotis·"
    "LEAP 로봇 손, RTX PRO 6000 GPU 워크스테이션을 운영하고 있습니다."
)
EQUIP_NEW = (
    "<p>AI Worker 양팔 플랫폼, OMY 로봇 팔, LeRobot SO-ARM 101, Tesollo·ROBOTIS·"
    "LEAP 로봇 손, MANUS 데이터 글러브와 Meta Quest 3, RealSense 카메라, "
    "RTX PRO 6000 GPU 워크스테이션을 운영하고 있습니다."
)

MAJOR_OLD = (
    "<p>전공은 묻지 않습니다. 실제로 기계공학부 외에도 전기정보공학부, 컴퓨터공학부, "
    "산업공학과, 물리학과 학생들이 함께 활동하고 있습니다."
)
MAJOR_NEW = (
    "<p>전공은 중요하지 않습니다. 실제로 12개 학과 학생들이 함께 활동하고 있습니다."
)

REPLACEMENTS = [
    ("교육 트랙 인원수", EDU_OLD, EDU_NEW),
    ("대회 트랙 대회명", CONTEST_OLD, CONTEST_NEW),
    ("다루는 장비", EQUIP_OLD, EQUIP_NEW),
    ("전공 문구", MAJOR_OLD, MAJOR_NEW),
]


def reorder_tracks(html: str) -> tuple[str, str]:
    """세 트랙 문단을 화 → 수 → 목 순서로 옮긴다.

    문단 자체는 건드리지 않고 순서만 바꾼다. 셋 중 하나라도 못 찾으면 그대로 둔다.
    """
    marks = ["<p><strong>교육 트랙(목요일)</strong>",
             "<p><strong>SHAPE-UP(화요일)</strong>",
             "<p><strong>대회 트랙(수요일)</strong>"]
    starts = [html.find(m) for m in marks]
    if -1 in starts:
        return html, "건너뜀 (트랙 문단을 못 찾음)"
    ordered = sorted(zip(starts, marks))
    if [m for _, m in ordered] == [marks[1], marks[2], marks[0]]:
        return html, "건너뜀 (이미 화·수·목 순서)"
    # 세 문단이 붙어 있는 구간을 통째로 잘라 내고 원하는 순서로 다시 붙인다.
    first = ordered[0][0]
    last_start = ordered[-1][0]
    last_end = html.find("</p>", last_start) + len("</p>")
    block = html[first:last_end]
    paragraphs = {}
    positions = sorted(block.find(m) for m in marks)
    for index, begin in enumerate(positions):
        end = positions[index + 1] if index + 1 < len(positions) else len(block)
        text = block[begin:end]
        for mark in marks:
            if text.startswith(mark):
                paragraphs[mark] = text.rstrip()
    if len(paragraphs) != 3:
        return html, "건너뜀 (문단 경계를 못 찾음)"
    rebuilt = "".join(paragraphs[m] for m in (marks[1], marks[2], marks[0]))
    return html[:first] + rebuilt + html[last_end:], "화 → 수 → 목 순서로 재배치"


# ------------------------------------------------------------- 3. MANUS 글러브

MANUS = {
    "name": "MANUS 데이터 글러브",
    "category": "텔레오퍼레이션 · 데이터 수집",
    "sort": 13,
    "units": ["MANUS 글러브 1호기"],
    "license": "MANUS 글러브 운용 교육",
    "unit_minutes": 60,
    "description": (
        "손가락 관절을 추적해 사람의 손동작을 그대로 로봇 손으로 옮기는 데이터 "
        "글러브입니다. 텔레오퍼레이션과 조작 데이터 수집에 사용하며, Tesollo·ROBOTIS·"
        "LEAP 로봇 손과 짝을 지어 씁니다. 센서 보정값이 사용자마다 달라, 세션을 "
        "시작할 때 캘리브레이션을 먼저 하고 사용 후에는 충전 거치대에 올려 주세요."
    ),
}

LICENSE_NOTE = (
    "해당 장비를 예약하기 전에 이수해야 하는 운용 교육입니다. 기동 절차, 안전 수칙, "
    "사용 후 정리 기준을 다룹니다."
)


async def main(dry_run: bool) -> None:
    changes: list[str] = []
    async with SessionLocal() as db:
        # ---- 1. 동아리 소개 ---------------------------------------------------
        page = await db.scalar(select(ContentPage).where(ContentPage.slug == "club-introduction"))
        if page is None:
            changes.append("동아리 소개 · 페이지가 없습니다 (건너뜀)")
        else:
            html = page.content_html or ""
            for label, old, new in REPLACEMENTS:
                if old in html:
                    html = html.replace(old, new)
                    changes.append(f"동아리 소개 · {label} 수정")
                else:
                    changes.append(f"동아리 소개 · {label} 건너뜀 (찾는 문장이 없음)")
            html, note = reorder_tracks(html)
            changes.append(f"동아리 소개 · 트랙 순서 {note}")
            if html != (page.content_html or ""):
                page.content_html = html

        # ---- 2. 조직도 : 총무를 회장단 바로 다음으로 --------------------------
        org = await db.scalar(select(ContentPage).where(ContentPage.slug == "organization"))
        if org is None:
            changes.append("조직도 · 페이지가 없습니다 (건너뜀)")
        else:
            data = dict(org.content_json or {})
            teams = list(data.get("operationTeams") or [])
            index = next((i for i, t in enumerate(teams) if t.get("name") == "총무"), None)
            if index is None:
                changes.append("조직도 · 총무 항목이 없습니다 (건너뜀)")
            elif index == 0:
                changes.append("조직도 · 총무가 이미 맨 앞입니다 (건너뜀)")
            else:
                teams.insert(0, teams.pop(index))
                data["operationTeams"] = teams
                org.content_json = data
                changes.append("조직도 · 총무를 맨 앞으로 (총무 · 기획팀 · 교육팀 · 대회팀)")

        # ---- 3. MANUS 데이터 글러브 -------------------------------------------
        existing = await db.scalar(select(Equipment).where(Equipment.name == MANUS["name"]))
        if existing is not None:
            changes.append(f"보유 장비 · {MANUS['name']} 이미 있음 (건너뜀)")
        else:
            license_row = await db.scalar(select(License).where(License.name == MANUS["license"]))
            if license_row is None:
                license_row = License(name=MANUS["license"], description=LICENSE_NOTE, is_active=True)
                db.add(license_row)
                await db.flush()
                changes.append(f"필수 교육 · {MANUS['license']} 추가")
            equipment = Equipment(
                name=MANUS["name"], category=MANUS["category"], description=MANUS["description"],
                status=EquipmentStatus.ACTIVE, reservation_unit_minutes=MANUS["unit_minutes"],
                sort_order=MANUS["sort"], image_url=None,
            )
            db.add(equipment)
            await db.flush()
            for label in MANUS["units"]:
                db.add(EquipmentUnit(equipment_id=equipment.id, label=label,
                                     status=EquipmentStatus.ACTIVE))
            db.add(EquipmentLicenseRequirement(equipment_id=equipment.id, license_id=license_row.id))
            changes.append(f"보유 장비 · {MANUS['name']} 추가 (호기 {len(MANUS['units'])}대)")

        # ---- 4. 로드맵 날짜 ---------------------------------------------------
        for title, starts, ends in ROADMAP_FIXES:
            item = await db.scalar(select(RoadmapItem).where(RoadmapItem.title == title))
            if item is None:
                changes.append(f"로드맵 · {title} 항목이 없습니다 (건너뜀)")
                continue
            if item.starts_at == starts and item.ends_at == ends:
                changes.append(f"로드맵 · {title} 이미 그 날짜입니다 (건너뜀)")
                continue
            # DB 에서 온 값은 UTC 라 그대로 찍으면 아홉 시간 어긋나 보인다.
            was_from, was_to = item.starts_at.astimezone(SEOUL), item.ends_at.astimezone(SEOUL) if item.ends_at else None
            before = f"{was_from:%m/%d %H:%M} ~ " + (f"{was_to:%m/%d %H:%M}" if was_to else "—")
            item.starts_at = starts
            item.ends_at = ends
            after = f"{starts:%m/%d %H:%M} ~ " + (f"{ends:%m/%d %H:%M}" if ends else "—")
            changes.append(f"로드맵 · {title} {before} → {after}")

        # ---- 5. 소개 페이지 위쪽 숫자 띠에서 부원 수 빼기 ----------------------
        if page is not None:
            facts = list((page.content_json or {}).get("facts") or [])
            kept = [f for f in facts if f.get("label") != "2기 부원"]
            if len(kept) == len(facts):
                changes.append("동아리 소개 · 숫자 띠에 '2기 부원' 이 없습니다 (건너뜀)")
            else:
                data = dict(page.content_json or {})
                data["facts"] = kept
                page.content_json = data
                changes.append(f"동아리 소개 · 숫자 띠에서 '2기 부원' 뺌 ({len(facts)}칸 → {len(kept)}칸)")

        if dry_run:
            if page is not None:
                print("---- 바뀐 뒤의 동아리 소개 본문 ----")
                print(page.content_html)
                print("-----------------------------------")
            await db.rollback()
        else:
            await db.commit()
    await engine.dispose()

    print("\n".join(changes))
    print("\n실제로 쓰지 않았습니다 (--dry-run)." if dry_run else "\n반영을 마쳤습니다.")


if __name__ == "__main__":
    asyncio.run(main("--dry-run" in sys.argv))
