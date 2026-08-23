"""Fill a local database with realistic content for clicking through the site.

Development helper only. Run it against a throwaway database:

    DATABASE_URL="sqlite+aiosqlite:///$(pwd)/dev.sqlite3" \
    SESSION_SECRET="local-development-secret-value" \
    python scripts/dev_seed.py

It prints a session token for the seeded owner so the admin console can be
opened without configuring Google OAuth. The long-form copy lives in
`dev_content.py` and follows the club's own planning documents.
"""

import asyncio
import sys
from datetime import UTC, datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).parent))

import dev_content as content  # noqa: E402

from app.database import SessionLocal, engine  # noqa: E402
from app.models import (  # noqa: E402
    Base,
    Comment,
    ContentPage,
    Equipment,
    EquipmentLicenseRequirement,
    EquipmentStatus,
    EquipmentUnit,
    License,
    NewsPost,
    Notice,
    Notification,
    PermissionGrant,
    RelatedLink,
    Reservation,
    ReservationSlot,
    ReservationStatus,
    Resource,
    RoadmapItem,
    RoadmapMember,
    ShapeUpPost,
    User,
    UserLicense,
    UserStatus,
)
from app.security import create_session_token  # noqa: E402
from app.services.link_preview import build as build_preview  # noqa: E402

NOW = datetime.now(UTC)
SEOUL = ZoneInfo("Asia/Seoul")
# 예약 시각은 화면에 서울 시각으로 표시되므로, 데모 데이터도 서울 기준 낮 시간에
# 놓아야 자연스럽게 읽힌다. 시드를 돌린 시각의 UTC 시(hour)를 그대로 쓰면
# 저녁 7시 같은 엉뚱한 시간표가 만들어진다.
def seoul_at(days: int, hour: int) -> datetime:
    day = (NOW.astimezone(SEOUL) + timedelta(days=days)).date()
    return datetime.combine(day, time(hour), tzinfo=SEOUL).astimezone(UTC)


def next_half_hour(offset_minutes: int = 0) -> datetime:
    """지금 이후 가장 가까운 30분 경계. 사용 시작 화면을 바로 눌러 볼 수 있게 한다."""
    now = (NOW + timedelta(minutes=offset_minutes)).replace(second=0, microsecond=0)
    return now + timedelta(minutes=(30 - now.minute % 30) % 30)
PHOTO = "https://res.cloudinary.com/demo/image/upload/sample.jpg"

# 계정을 가진 부원만 로그인 사용자로 만든다. 이름 → (이메일, owner, 권한)
ACCOUNTS = {
    "강채아": ("chaea", True, []),
    "전라온": ("raon", False, ["content:manage", "news:manage", "notices:manage", "equipment:manage", "reservations:manage", "roadmap:manage", "links:manage"]),
    "장하람": ("haram", False, ["roadmap:manage", "links:manage"]),
    "최은서": ("eunseo", False, ["content:manage", "news:manage"]),
    "오보람": ("boram", False, ["reservations:manage"]),
    "황새봄": ("saebom", False, ["equipment:manage", "notices:manage"]),
    "조나윤": ("nayun", False, []),
    "오유하": ("yuha", False, []),
    "류이든": ("ideun", False, []),
    "전한별": ("hanbyeol", False, []),
    "이도현": ("dohyun", False, []),
    "이예솔": ("yesol", False, []),
}
# 가입 승인을 기다리는 신청자 두 명. 관리자 승인 흐름 확인용.
APPLICANTS = [("조초아", "choa"), ("최시온", "sion")]

TABLES = (
    Comment,
    ShapeUpPost,
    Resource,
    Notification, ReservationSlot, Reservation, RoadmapMember, EquipmentLicenseRequirement,
    UserLicense, PermissionGrant, EquipmentUnit, Equipment, License, RoadmapItem,
    RelatedLink, Notice, NewsPost, ContentPage, User,
)


def half_hours(starts_at: datetime, ends_at: datetime):
    current = starts_at
    while current < ends_at:
        yield current
        current += timedelta(minutes=30)


async def main() -> None:
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async with SessionLocal() as db:
        for table in TABLES:
            await db.execute(table.__table__.delete())
        await db.commit()

        # ------------------------------------------------------------ 회원
        cards = {card["name"]: card for card in content.MEMBERS}
        people: dict[str, User] = {}
        for name, (handle, owner, permissions) in ACCOUNTS.items():
            email = f"{handle}@snu-shape.com"
            user = User(
                google_sub=email, email=email, name=name, is_owner=owner, status=UserStatus.APPROVED,
                # 사진과 소개말은 본인이 마이페이지에서 설정한 값이다.
                image_url=cards.get(name, {}).get("imageUrl"),
                introduction=content.INTRODUCTIONS.get(name),
            )
            db.add(user)
            await db.flush()
            db.add_all([PermissionGrant(user_id=user.id, permission=permission) for permission in permissions])
            people[name] = user
        for name, handle in APPLICANTS:
            email = f"{handle}@snu-shape.com"
            applicant = User(google_sub=email, email=email, name=name, status=UserStatus.PENDING)
            db.add(applicant)
            await db.flush()
            people[name] = applicant

        # ---------------------------------------------------------- 라이선스
        licenses = {}
        for name, description in content.LICENSES:
            licenses[name] = License(name=name, description=description)
            db.add(licenses[name])
        await db.flush()

        holders = ["강채아", "전라온", "장하람", "최은서", "오보람", "황새봄", "조나윤", "오유하", "류이든", "이도현"]
        for name in holders:
            db.add(UserLicense(user_id=people[name].id, license_id=licenses["로봇 안전 교육"].id))
        for name in ["강채아", "조나윤", "오유하", "최은서", "전한별"]:
            db.add(UserLicense(user_id=people[name].id, license_id=licenses["로봇 팔 기초 교육"].id))
        for name in ["강채아", "류이든", "최은서"]:
            db.add(UserLicense(user_id=people[name].id, license_id=licenses["GPU 워크스테이션 이용 안내"].id))
        db.add(UserLicense(user_id=people["강채아"].id, license_id=licenses["휴머노이드 운용 교육"].id))

        # -------------------------------------------------------------- 장비
        units: dict[str, EquipmentUnit] = {}
        for spec in content.EQUIPMENT:
            item = Equipment(
                name=spec["name"], category=spec["category"], description=spec["description"],
                status=EquipmentStatus[spec.get("status", "ACTIVE")],
                reservation_unit_minutes=spec["unit_minutes"], sort_order=spec["sort"],
            )
            db.add(item)
            await db.flush()
            for label in spec["units"]:
                unit = EquipmentUnit(equipment_id=item.id, label=label)
                db.add(unit)
                units[label] = unit
            for licence in spec["licenses"]:
                db.add(EquipmentLicenseRequirement(equipment_id=item.id, license_id=licenses[licence].id))
        # 한 대는 점검 중으로 두어 상태 표시를 확인할 수 있게 한다.
        units["GPU 워크스테이션 3호기"].status = EquipmentStatus.MAINTENANCE
        await db.flush()

        # -------------------------------------------------------------- 뉴스
        for post in content.NEWS:
            db.add(NewsPost(
                title=post["title"], summary=post["summary"], category=post["category"],
                content_html=post["html"], is_published=True,
                published_at=NOW - timedelta(days=post["days_ago"]),
            ))
        for post in content.PRESS:
            db.add(NewsPost(
                title=post["title"], summary=post["summary"], category="언론보도",
                content_html=post["html"], external_url=post["url"],
                content_json={"linkPreview": True, "preview": await build_preview(post["url"])},
                is_published=True, published_at=NOW - timedelta(days=post["days_ago"]),
            ))

        # ------------------------------------------------------------ 게시판
        approved = [user for user in people.values() if user.status == UserStatus.APPROVED]
        for index, post in enumerate(content.NOTICES):
            notice = Notice(
                author_id=people["황새봄"].id, title=post["title"], category=post["category"],
                content_html=post["html"], is_pinned=post["pinned"], is_published=True,
                published_at=NOW - timedelta(days=post["days_ago"]),
            )
            db.add(notice)
            await db.flush()
            # 최근 두 건만 읽지 않은 알림으로 남긴다.
            for user in approved:
                db.add(Notification(user_id=user.id, notice_id=notice.id, title=notice.title, is_read=index >= 2))

        # 회원이 직접 쓴 글과 댓글·대댓글
        for post in content.MEMBER_POSTS:
            written = Notice(
                author_id=people[post["author"]].id, title=post["title"], category=post["category"],
                content_html=post["html"], is_pinned=False, is_published=True,
                published_at=NOW - timedelta(days=post["days_ago"]),
            )
            db.add(written)
            await db.flush()
            for order, (author, body, replies) in enumerate(post["comments"]):
                parent = Comment(
                    notice_id=written.id, user_id=people[author].id, body=body,
                    created_at=NOW - timedelta(days=post["days_ago"], hours=-order - 1),
                )
                db.add(parent)
                await db.flush()
                for reply_order, (reply_author, reply_body) in enumerate(replies):
                    db.add(Comment(
                        notice_id=written.id, parent_id=parent.id, user_id=people[reply_author].id,
                        body=reply_body,
                        created_at=NOW - timedelta(days=post["days_ago"], hours=-order - reply_order - 2),
                    ))

        # -------------------------------------------------------------- 링크
        for title, url, description, order in content.LINKS:
            db.add(RelatedLink(title=title, url=url, description=description, sort_order=order))

        # ---------------------------------------------------------- SHAPE-UP
        for post in content.SHAPE_UP_POSTS:
            db.add(ShapeUpPost(
                author_id=people[post["author"]].id, title=post["title"], summary=post["summary"],
                cohort=post["cohort"], team_name=post["team"], team_members=post["members"],
                content_html=post["html"], github_url=post["github"], video_url=post["video"],
                is_published=True, created_at=NOW - timedelta(days=post["days_ago"]),
            ))

        # ------------------------------------------------------------ 자료실
        for order, (title, category, description, file_name, size, public, author) in enumerate(content.RESOURCES):
            db.add(Resource(
                author_id=people[author].id, title=title, category=category, description=description,
                file_url=f"https://res.cloudinary.com/demo/raw/upload/v1/shape/resources/{file_name}",
                file_name=file_name, file_size=size, is_public=public,
                created_at=NOW - timedelta(days=order * 3 + 1),
            ))
        for order, (title, category, description, url, public, author) in enumerate(content.RESOURCE_LINKS):
            db.add(Resource(
                author_id=people[author].id, title=title, category=category, description=description,
                link_url=url, is_public=public, created_at=NOW - timedelta(days=order * 5 + 2),
            ))

        # ------------------------------------------------------------ 로드맵
        projects: dict[str, RoadmapItem] = {}
        for title, category, starts_at, ends_at, description in content.ROADMAP:
            item = RoadmapItem(
                title=title, category=category, description=description,
                starts_at=starts_at, ends_at=ends_at, is_published=True,
            )
            db.add(item)
            projects[title] = item
        await db.flush()
        assignments = {
            "SHAPE-UP 2026-2 팀 프로젝트": ["조나윤", "오유하", "류이든", "전한별", "강채아", "전라온"],
            "교육 트랙 2026-2 (총 10회)": ["최은서", "이도현", "이예솔"],
            "마트 챌린지 본선 (대구 EXCO)": ["오보람", "류이든", "오유하"],
            "RoboCup@Home 1차 지원 제출": ["오보람", "류이든"],
        }
        for title, names in assignments.items():
            for name in names:
                if name in people:
                    db.add(RoadmapMember(roadmap_item_id=projects[title].id, user_id=people[name].id))

        # ---------------------------------------------------------- 콘텐츠 페이지
        db.add_all([
            ContentPage(slug="greeting", title="인사말", content_html=content.GREETING_HTML, is_published=True),
            ContentPage(slug="club-introduction", title="동아리 소개", content_html=content.CLUB_HTML,
                        content_json={"facts": content.CLUB_FACTS}, is_published=True),
            ContentPage(slug="members", title="부원", content_html="",
                        content_json={"members": [
                            {**card, "userId": str(people[card["name"]].id)} if card["name"] in ACCOUNTS else card
                            for card in content.MEMBERS
                        ]}, is_published=True),
            ContentPage(slug="organization", title="조직도", content_html="", content_json=content.ORGANIZATION, is_published=True),
        ])

        # -------------------------------------------------------------- 예약
        def book(unit_label: str, who: str, days: int, hours: int, purpose: str, status: ReservationStatus, hour: int = 10, starts: datetime | None = None, **extra):
            starts = starts or seoul_at(days, hour)
            ends = starts + timedelta(hours=hours)
            reservation = Reservation(
                equipment_unit_id=units[unit_label].id, user_id=people[who].id,
                starts_at=starts, ends_at=ends, purpose=purpose, status=status, **extra,
            )
            db.add(reservation)
            return reservation, starts, ends

        pending, _, _ = book("OMY 1호기", "오유하", 2, 2,
                             "그리퍼 파지 정책 데이터 수집. 물체 12종을 각 20회씩 반복 수집할 예정입니다.",
                             ReservationStatus.PENDING)
        # 오유하 계정으로 사용 전/후 사진 등록 화면을 바로 볼 수 있게 둔다.
        ready, ready_start, ready_end = book("OMY 2호기", "오유하", 0, 2,
                                             "파지 실패 감지 실험. 손목 각도를 바꿔 가며 재현 데이터를 모읍니다.",
                                             ReservationStatus.APPROVED, starts=next_half_hour())
        running, running_start, running_end = book("Tesollo Hand", "오유하", 0, 3,
                                                   "다관절 손 파지 실험. 사용 전 사진을 올려 시작한 상태입니다.",
                                                   ReservationStatus.IN_USE, starts=next_half_hour(-90), before_photo_url=PHOTO)
        book("GPU 워크스테이션 1호기", "류이든", 3, 4,
             "Isaac Lab에서 보행 정책 학습. 야간까지 이어질 수 있어 넉넉히 잡았습니다.",
             ReservationStatus.PENDING, hour=13)
        approved_one, starts, ends = book("AI Worker 1호기", "조나윤", 1, 3,
                                          "양팔 teleoperation 데이터 수집 세션. 안전 담당 1명 동행합니다.",
                                          ReservationStatus.APPROVED, hour=14)
        in_use, _, _ = book("SO-ARM 1호기", "전한별", 0, 2,
                            "모방학습 실습 준비. 조별 실습 전 동작 확인용입니다.",
                            ReservationStatus.IN_USE, starts=next_half_hour(-60), before_photo_url=PHOTO)
        book("OMY 2호기", "강채아", -4, 2,
             "리더-팔로워 연동 테스트. 두 대를 동시에 사용했습니다.",
             ReservationStatus.COMPLETED, hour=15, before_photo_url=PHOTO, after_photo_url=PHOTO)
        book("GPU 워크스테이션 2호기", "전한별", -2, 3,
             "비전 모델 파인튜닝.", ReservationStatus.REJECTED, hour=11,
             rejection_reason="같은 시간에 교육 트랙 실습이 예정되어 있어 다른 시간대로 부탁드립니다.")
        await db.flush()
        for reservation, first, last in (
            (approved_one, starts, ends),
            (in_use, in_use.starts_at, in_use.ends_at),
            (ready, ready_start, ready_end),
            (running, running_start, running_end),
        ):
            for slot in half_hours(first, last):
                db.add(ReservationSlot(equipment_unit_id=reservation.equipment_unit_id, reservation_id=reservation.id, slot_start=slot))
        assert pending is not None

        await db.commit()

        print("seeded")
        print(f"  부원 카드 {len(content.MEMBERS)}장(계정 연결 {len(ACCOUNTS)}명) · 장비 {len(content.EQUIPMENT)}종 · 로드맵 {len(content.ROADMAP)}건")
        print(f"  뉴스 {len(content.NEWS)}건 · 언론보도 {len(content.PRESS)}건 · 예약 8건")
        print(f"  게시판 {len(content.NOTICES) + len(content.MEMBER_POSTS)}건(회원 작성 {len(content.MEMBER_POSTS)}건, 댓글 포함)")
        print(f"  자료실 {len(content.RESOURCES) + len(content.RESOURCE_LINKS)}건(공개 {sum(1 for r in content.RESOURCES if r[5]) + sum(1 for r in content.RESOURCE_LINKS if r[4])}건)")
        print(f"  SHAPE-UP 결과물 {len(content.SHAPE_UP_POSTS)}건")
        print()
        print("  owner   chaea@snu-shape.com  강채아 (모든 권한)")
        print("  manager saebom@snu-shape.com   황새봄 (장비·게시판 권한만)")
        print("  member  yuha@snu-shape.com  오유하 (일반 회원, 예약 대기 보유)")
        print("  대기자  choa@snu-shape.com   조초아 (가입 승인 대기)")
        print()
        print("브라우저 개발자도구 > Application > Cookies > http://localhost:3000 에")
        print("이름 shape_session 으로 아래 값을 넣으면 회장 계정으로 로그인됩니다.")
        print()
        print(create_session_token(people["강채아"].id))

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
