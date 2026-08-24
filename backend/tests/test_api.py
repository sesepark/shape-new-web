import asyncio
from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest
from sqlalchemy import select

from app.middleware import CostGuardMiddleware, public_read
from app.models import (
    Equipment,
    EquipmentLicenseRequirement,
    EquipmentStatus,
    EquipmentUnit,
    License,
    Notice,
    Reservation,
    ReservationStatus,
    UserLicense,
    UserStatus,
)
from tests.conftest import login, logout, make_user


@pytest.mark.parametrize(
    "path,expected",
    [
        ("/api/v1/equipment", True),
        ("/api/v1/equipment/1/availability", True),
        ("/api/v1/equipment-permissions", False),
        ("/api/v1/notifications", False),
        ("/api/v1/notices", False),
        ("/api/v1/auth/me", False),
        ("/api/v1/admin/users", False),
    ],
)
def test_only_public_reads_are_shared_cacheable(path, expected):
    assert public_read(path) is expected


async def test_content_page_round_trip(client, session):
    editor = await make_user(session, "editor@example.com", permissions=["content:manage"])
    http = login(client, editor)
    saved = await http.put("/api/v1/admin/pages/greeting", json={"title": "인사말", "contentHtml": "<p>안녕하세요</p>", "contentJson": {}, "isPublished": True})
    assert saved.status_code == 200
    page = await http.get("/api/v1/pages/greeting")
    assert page.json()["contentHtml"] == "<p>안녕하세요</p>"
    rejected = await http.put("/api/v1/admin/pages/unknown", json={"title": "x", "contentHtml": "", "contentJson": {}, "isPublished": True})
    assert rejected.status_code == 404


async def test_content_page_strips_scripts(client, session):
    editor = await make_user(session, "editor@example.com", permissions=["content:manage"])
    http = login(client, editor)
    await http.put("/api/v1/admin/pages/club-introduction", json={"title": "자료", "contentHtml": "<p>ok</p><script>alert(1)</script>", "contentJson": {}, "isPublished": True})
    page = await http.get("/api/v1/pages/club-introduction")
    assert "script" not in page.json()["contentHtml"]


async def test_related_link_can_be_created_and_published(client, session):
    editor = await make_user(session, "links@example.com", permissions=["links:manage"])
    http = login(client, editor)
    created = await http.post("/api/v1/admin/links", json={"title": "SHAPE Drive", "url": "https://drive.google.com/shape", "description": "자료 보관", "isPublished": True})
    assert created.status_code == 201, created.text
    links = await http.get("/api/v1/links")
    assert [item["title"] for item in links.json()] == ["SHAPE Drive"]


async def test_news_keeps_its_external_url(client, session):
    editor = await make_user(session, "news@example.com", permissions=["news:manage"])
    http = login(client, editor)
    created = await http.post("/api/v1/admin/news", json={"title": "언론보도", "summary": "요약", "category": "언론보도", "contentHtml": "<p>기사</p>", "contentJson": {}, "externalUrl": "https://news.example.com/article", "isPublished": True})
    assert created.status_code == 201, created.text
    listed = await http.get("/api/v1/news?category=언론보도")
    assert listed.json()[0]["externalUrl"] == "https://news.example.com/article"
    assert (await http.get("/api/v1/news?category=활동")).json() == []


async def test_publishing_a_notice_notifies_approved_members(client, session):
    editor = await make_user(session, "notice@example.com", permissions=["notices:manage"])
    member = await make_user(session, "member@example.com")
    await make_user(session, "waiting@example.com", status=UserStatus.PENDING)
    http = login(client, editor)
    assert (await http.post("/api/v1/admin/notices", json={"title": "정기 모임", "category": "공지", "contentHtml": "<p>내용</p>", "contentJson": {}, "isPinned": False, "isPublished": True})).status_code == 201
    http = login(client, member)
    alerts = (await http.get("/api/v1/notifications")).json()
    assert [item["title"] for item in alerts] == ["정기 모임"]
    assert (await http.post("/api/v1/notifications/read")).status_code == 204
    assert (await http.get("/api/v1/notifications")).json()[0]["isRead"] is True


async def test_draft_notice_notifies_once_when_published(client, session):
    editor = await make_user(session, "notice@example.com", permissions=["notices:manage"])
    member = await make_user(session, "member@example.com")
    body = {"title": "초안", "category": "일반", "contentHtml": "<p>초안</p>", "contentJson": {}, "isPinned": False, "isPublished": False}
    http = login(client, editor)
    notice_id = (await http.post("/api/v1/admin/notices", json=body)).json()["id"]
    await http.patch(f"/api/v1/admin/notices/{notice_id}", json={**body, "isPublished": True})
    await http.patch(f"/api/v1/admin/notices/{notice_id}", json={**body, "title": "초안 수정", "isPublished": True})
    http = login(client, member)
    assert len((await http.get("/api/v1/notifications")).json()) == 1


async def test_member_without_licence_cannot_reserve(client, session):
    manager = await make_user(session, "gear@example.com", permissions=["equipment:manage"])
    member = await make_user(session, "member@example.com")
    licence = License(name="로봇 안전 교육")
    session.add(licence)
    equipment = Equipment(name="OMY", category="로봇 팔", reservation_unit_minutes=30)
    session.add(equipment)
    await session.flush()
    unit = EquipmentUnit(equipment_id=equipment.id, label="OMY 1호기")
    session.add(unit)
    await session.commit()
    http = login(client, manager)
    assert (await http.put(f"/api/v1/admin/equipment/{equipment.id}/licenses", json={"licenseIds": [str(licence.id)]})).status_code == 200
    starts = (datetime.now(UTC) + timedelta(days=1)).replace(minute=0, second=0, microsecond=0)
    payload = {"equipmentUnitId": str(unit.id), "startsAt": starts.isoformat(), "endsAt": (starts + timedelta(hours=1)).isoformat(), "purpose": "출력 테스트"}
    http = login(client, member)
    assert (await http.post("/api/v1/reservations", json=payload)).status_code == 403
    http = login(client, manager)
    assert (await http.post(f"/api/v1/admin/users/{member.id}/licenses", json={"licenseId": str(licence.id)})).status_code == 201
    http = login(client, member)
    created = await http.post("/api/v1/reservations", json=payload)
    assert created.status_code == 201, created.text
    assert created.json()["equipmentName"] == "OMY"
    assert created.json()["unitLabel"] == "OMY 1호기"


def next_half_hour() -> datetime:
    """지금 이후 가장 가까운 정각 또는 30분. 예약 시작 시각의 제약을 모두 만족한다."""
    now = datetime.now(UTC).replace(second=0, microsecond=0)
    return (now + timedelta(minutes=30 - now.minute % 30))


async def test_reservation_lifecycle(client, session):
    officer = await make_user(session, "officer@example.com", permissions=["reservations:manage"])
    member = await make_user(session, "member@example.com")
    equipment = Equipment(name="3D 프린터", category="제작", reservation_unit_minutes=30)
    session.add(equipment)
    await session.flush()
    unit = EquipmentUnit(equipment_id=equipment.id, label="1호기")
    session.add(unit)
    await session.commit()
    # 사용 시작은 예약 시각 직전부터만 가능하므로, 다음 30분 경계로 잡는다.
    starts = next_half_hour()
    payload = {"equipmentUnitId": str(unit.id), "startsAt": starts.isoformat(), "endsAt": (starts + timedelta(hours=1)).isoformat(), "purpose": "부품 출력"}
    http = login(client, member)
    reservation = (await http.post("/api/v1/reservations", json=payload)).json()
    assert reservation["status"] == "PENDING"
    http = login(client, officer)
    listed = (await http.get("/api/v1/admin/reservations?status=PENDING")).json()
    assert listed[0]["userEmail"] == "member@example.com"
    assert (await http.post(f"/api/v1/admin/reservations/{reservation['id']}/decision", json={"approve": True})).status_code == 200
    # 사용 시작은 예약 시각 10분 전부터만 되므로, 승인된 예약을 지금으로 당긴다.
    row = await session.get(Reservation, UUID(reservation["id"]))
    row.starts_at = datetime.now(UTC)
    await session.commit()
    http = login(client, member)
    started = await http.post(f"/api/v1/reservations/{reservation['id']}/before", json={"photoUrl": "https://res.cloudinary.com/demo/before.jpg"})
    assert started.status_code == 200, started.text
    assert started.json()["status"] == "IN_USE"
    done = await http.post(f"/api/v1/reservations/{reservation['id']}/after", json={"photoUrl": "https://res.cloudinary.com/demo/after.jpg"})
    assert done.json()["status"] == ReservationStatus.COMPLETED.value
    mine = (await http.get("/api/v1/reservations/me")).json()
    assert mine[0]["beforePhotoUrl"].endswith("before.jpg")


async def test_cancelling_a_reservation_frees_the_slot(client, session):
    officer = await make_user(session, "officer@example.com", permissions=["reservations:manage"])
    member = await make_user(session, "member@example.com")
    other = await make_user(session, "other@example.com")
    equipment = Equipment(name="GPU", category="컴퓨팅", reservation_unit_minutes=30)
    session.add(equipment)
    await session.flush()
    unit = EquipmentUnit(equipment_id=equipment.id, label="1호기")
    session.add(unit)
    await session.commit()
    starts = (datetime.now(UTC) + timedelta(days=2)).replace(minute=0, second=0, microsecond=0)
    payload = {"equipmentUnitId": str(unit.id), "startsAt": starts.isoformat(), "endsAt": (starts + timedelta(minutes=30)).isoformat(), "purpose": "학습 실험"}
    http = login(client, member)
    reservation = (await http.post("/api/v1/reservations", json=payload)).json()
    http = login(client, officer)
    await http.post(f"/api/v1/admin/reservations/{reservation['id']}/decision", json={"approve": True})
    http = login(client, other)
    assert (await http.post("/api/v1/reservations", json=payload)).status_code == 409
    http = login(client, member)
    assert (await http.post(f"/api/v1/reservations/{reservation['id']}/cancel")).json()["status"] == "CANCELLED"
    http = login(client, other)
    assert (await http.post("/api/v1/reservations", json=payload)).status_code == 201


async def test_permissions_are_owner_only_and_revocable(client, session):
    owner = await make_user(session, "owner@example.com", owner=True)
    member = await make_user(session, "member@example.com")
    http = login(client, member)
    assert (await http.get("/api/v1/admin/users")).status_code == 403
    assert (await http.get("/api/v1/admin/news")).status_code == 403
    http = login(client, owner)
    assert (await http.post(f"/api/v1/admin/users/{member.id}/permissions", json={"permission": "news:manage"})).status_code == 201
    assert (await http.post(f"/api/v1/admin/users/{member.id}/permissions", json={"permission": "everything:manage"})).status_code == 422
    listed = (await http.get("/api/v1/admin/users")).json()
    assert next(row["permissions"] for row in listed if row["email"] == "member@example.com") == ["news:manage"]
    http = login(client, member)
    assert (await http.get("/api/v1/admin/news")).status_code == 200
    http = login(client, owner)
    assert (await http.delete(f"/api/v1/admin/users/{member.id}/permissions/news:manage")).status_code == 204
    http = login(client, member)
    assert (await http.get("/api/v1/admin/news")).status_code == 403


async def test_pending_member_cannot_read_member_content(client, session):
    waiting = await make_user(session, "waiting@example.com", status=UserStatus.PENDING)
    session.add(Notice(title="공지", content_html="<p>x</p>", is_published=True, published_at=datetime.now(UTC)))
    await session.commit()
    http = login(client, waiting)
    assert (await http.get("/api/v1/notices")).status_code == 403
    assert (await http.get("/api/v1/auth/me")).json()["status"] == "PENDING"


async def test_profile_update_and_session_shape(client, session):
    member = await make_user(session, "member@example.com")
    http = login(client, member)
    updated = await http.patch("/api/v1/auth/me", json={"name": "김샤프", "imageUrl": "https://res.cloudinary.com/demo/me.jpg"})
    assert updated.status_code == 200, updated.text
    assert updated.json()["name"] == "김샤프"
    assert (await http.get("/api/v1/auth/me")).json()["imageUrl"].endswith("me.jpg")


async def test_equipment_units_and_availability(client, session):
    manager = await make_user(session, "gear@example.com", permissions=["equipment:manage"])
    http = login(client, manager)
    equipment_id = (await http.post("/api/v1/admin/equipment", json={"name": "OMY", "category": "로봇 팔", "description": "", "status": "ACTIVE", "reservationUnitMinutes": 60, "sortOrder": 1})).json()["id"]
    unit = await http.post(f"/api/v1/admin/equipment/{equipment_id}/units", json={"label": "OMY 1호기", "status": "ACTIVE"})
    assert unit.status_code == 201, unit.text
    second = (await http.post(f"/api/v1/admin/equipment/{equipment_id}/units", json={"label": "OMY 2호기", "status": "ACTIVE"})).json()
    listed = (await http.get("/api/v1/admin/equipment")).json()
    assert len(listed[0]["units"]) == 2
    await http.patch(f"/api/v1/admin/equipment/units/{second['id']}", json={"label": "OMY 2호기", "status": "MAINTENANCE"})
    catalogue = (await client.get("/api/v1/equipment")).json()
    assert catalogue[0]["availableUnits"] == 1
    assert catalogue[0]["openHour"] == 0 and catalogue[0]["closeHour"] == 24


async def test_upload_signature_matches_cloudinary_rules(client, session):
    import hashlib

    member = await make_user(session, "member@example.com")
    http = login(client, member)
    response = await http.post("/api/v1/media/signature?purpose=profile")
    assert response.status_code == 200, response.text
    data = response.json()
    params = f"allowed_formats=jpg,jpeg,png,webp&folder={data['folder']}&timestamp={data['timestamp']}"
    assert data["signature"] == hashlib.sha1(f"{params}secret".encode()).hexdigest()
    assert (await http.post("/api/v1/media/signature?purpose=news")).status_code == 403


async def test_equipment_status_blocks_reservation(client, session):
    manager = await make_user(session, "gear@example.com", permissions=["equipment:manage"])
    member = await make_user(session, "member@example.com")
    equipment = Equipment(name="휴머노이드", category="플랫폼", status=EquipmentStatus.MAINTENANCE)
    session.add(equipment)
    await session.flush()
    unit = EquipmentUnit(equipment_id=equipment.id, label="1호기")
    session.add(unit)
    await session.commit()
    starts = (datetime.now(UTC) + timedelta(days=1)).replace(minute=0, second=0, microsecond=0)
    http = login(client, member)
    blocked = await http.post("/api/v1/reservations", json={"equipmentUnitId": str(unit.id), "startsAt": starts.isoformat(), "endsAt": (starts + timedelta(minutes=30)).isoformat(), "purpose": "보행 실험"})
    assert blocked.status_code == 409
    assert manager is not None


async def test_flood_guard_rejects_bursts(client, session):
    member = await make_user(session, "member@example.com")
    http = login(client, member)
    for guard in CostGuardMiddleware.instances:
        guard.buckets.clear()
        guard.settings.rate_limit_read_per_minute = 3
    try:
        codes = [(await http.get("/api/v1/auth/me")).status_code for _ in range(5)]
    finally:
        for guard in CostGuardMiddleware.instances:
            guard.settings.rate_limit_read_per_minute = 5000
            guard.buckets.clear()
    assert codes[:3] == [200, 200, 200]
    assert codes[3:] == [429, 429]


async def test_oversized_body_is_rejected(client, session):
    editor = await make_user(session, "editor@example.com", permissions=["content:manage"])
    http = login(client, editor)
    huge = {"title": "큰 문서", "contentHtml": "<p>" + "가" * 3_000_000 + "</p>", "contentJson": {}, "isPublished": True}
    assert (await http.put("/api/v1/admin/pages/club-introduction", json=huge)).status_code == 413


async def test_roadmap_project_members(client, session):
    planner = await make_user(session, "plan@example.com", permissions=["roadmap:manage"])
    member = await make_user(session, "member@example.com")
    waiting = await make_user(session, "waiting@example.com", status=UserStatus.PENDING)
    starts = (datetime.now(UTC) + timedelta(days=7)).isoformat()
    body = {"title": "SHAPE-UP 1기", "category": "SHAPE-UP", "description": "휴머노이드 보행", "startsAt": starts, "endsAt": None, "isPublished": True}
    http = login(client, planner)
    directory = await http.get("/api/v1/admin/directory")
    assert directory.status_code == 200
    assert sorted(row["email"] for row in directory.json()) == ["member@example.com", "plan@example.com"]
    rejected = await http.post("/api/v1/admin/roadmap", json={**body, "memberIds": [str(waiting.id)]})
    assert rejected.status_code == 422
    created = await http.post("/api/v1/admin/roadmap", json={**body, "memberIds": [str(member.id)]})
    assert created.status_code == 201, created.text
    item_id = created.json()["id"]
    assert (await http.get("/api/v1/admin/roadmap")).json()[0]["memberIds"] == [str(member.id)]

    http = login(client, member)
    assert [row["title"] for row in (await http.get("/api/v1/roadmap/me")).json()] == ["SHAPE-UP 1기"]

    http = login(client, planner)
    await http.patch(f"/api/v1/admin/roadmap/{item_id}", json={**body, "memberIds": []})
    http = login(client, member)
    assert (await http.get("/api/v1/roadmap/me")).json() == []
    assert (await http.get("/api/v1/admin/directory")).status_code == 403


async def test_deleting_a_project_releases_its_members(client, session):
    planner = await make_user(session, "plan@example.com", permissions=["roadmap:manage"])
    member = await make_user(session, "member@example.com")
    starts = (datetime.now(UTC) + timedelta(days=3)).isoformat()
    http = login(client, planner)
    item_id = (await http.post("/api/v1/admin/roadmap", json={"title": "대회 준비", "category": "대회", "description": "", "startsAt": starts, "endsAt": None, "isPublished": True, "memberIds": [str(member.id)]})).json()["id"]
    assert (await http.delete(f"/api/v1/admin/roadmap/{item_id}")).status_code == 204
    http = login(client, member)
    assert (await http.get("/api/v1/roadmap/me")).json() == []


def test_platform_links_become_embeds():
    from app.services.link_preview import embed_for

    assert embed_for("https://www.youtube.com/watch?v=dQw4w9WgXcQ")["src"] == "https://www.youtube.com/embed/dQw4w9WgXcQ"
    assert embed_for("https://youtu.be/dQw4w9WgXcQ")["provider"] == "youtube"
    assert embed_for("https://www.youtube.com/shorts/dQw4w9WgXcQ")["provider"] == "youtube"
    assert embed_for("https://www.instagram.com/reel/Cx1y2z3AbC/")["src"] == "https://www.instagram.com/reel/Cx1y2z3AbC/embed"
    assert embed_for("https://vimeo.com/76979871")["src"] == "https://player.vimeo.com/video/76979871"
    assert embed_for("https://news.example.com/article/1") is None
    assert embed_for("https://www.youtube.com/watch?v=short") is None


def test_open_graph_tags_become_a_preview_card():
    from app.services.link_preview import read_metadata

    html = """<html><head><title>fallback</title>
      <meta property="og:title" content="SHAPE, 휴머노이드 데모 공개"/>
      <meta property="og:description" content="서울대 학생들이 만든 로봇"/>
      <meta property="og:image" content="https://cdn.example.com/a.jpg"/>
      <meta property="og:site_name" content="예시신문"/>
    </head><body>본문</body></html>"""
    card = read_metadata(html, "https://news.example.com/a")
    assert card == {"title": "SHAPE, 휴머노이드 데모 공개", "description": "서울대 학생들이 만든 로봇", "image": "https://cdn.example.com/a.jpg", "siteName": "예시신문", "publishedAt": ""}
    bare = read_metadata("<html><head><title>제목만</title></head></html>", "https://news.example.com/a")
    assert bare["title"] == "제목만" and bare["siteName"] == "news.example.com"


async def test_private_addresses_are_refused():
    from app.services.link_preview import build

    assert (await build("http://127.0.0.1:8000/health"))["status"] == "unreachable"
    assert (await build("http://localhost/admin"))["status"] == "unreachable"
    assert (await build("ftp://example.com/file"))["status"] == "invalid"
    assert await build(None) == {}


async def test_saving_a_video_link_stores_its_embed(client, session):
    editor = await make_user(session, "news@example.com", permissions=["news:manage"])
    http = login(client, editor)
    created = await http.post("/api/v1/admin/news", json={
        "title": "데모 영상", "summary": "요약", "category": "언론보도",
        "contentHtml": "<p>영상</p>", "contentJson": {"linkPreview": True},
        "externalUrl": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "isPublished": True,
    })
    assert created.status_code == 201, created.text
    detail = (await http.get(f"/api/v1/news/{created.json()['id']}")).json()
    assert detail["contentJson"]["preview"]["status"] == "embed"
    assert detail["contentJson"]["preview"]["embed"]["src"].endswith("dQw4w9WgXcQ")
    assert detail["contentJson"]["linkPreview"] is True


async def test_saving_content_asks_the_site_to_refresh(client, session, monkeypatch):
    """A save must trigger a page refresh without ever failing on its own."""
    from app.services import revalidate

    asked: list[list[str]] = []

    async def record(paths):
        asked.append(paths)

    monkeypatch.setattr(revalidate, "_post", record)
    editor = await make_user(session, "links@example.com", permissions=["links:manage"])
    http = login(client, editor)
    created = await http.post("/api/v1/admin/links", json={"title": "SHAPE Drive", "url": "https://drive.example.com", "isPublished": True})
    assert created.status_code == 201
    await asyncio.sleep(0)
    assert asked and "/links" in asked[0]


def test_refresh_is_silent_without_a_configured_secret():
    from app.services.revalidate import PATHS, refresh

    assert set(PATHS) == {"news", "notices", "equipment", "roadmap", "links", "pages", "shape-up"}
    # No running loop and no secret must not raise; the save has already happened.
    try:
        refresh("news")
    except RuntimeError:
        pass


async def test_member_card_shows_only_linked_public_profiles(client, session):
    editor = await make_user(session, "editor@example.com", permissions=["content:manage"])
    planner = await make_user(session, "plan@example.com", permissions=["roadmap:manage"])
    shown = await make_user(session, "shown@example.com")
    hidden = await make_user(session, "hidden@example.com")

    http = login(client, shown)
    assert (await http.patch("/api/v1/auth/me", json={"name": "김부원", "introduction": "보행 제어를 공부하고 있습니다."})).status_code == 200

    starts = (datetime.now(UTC) + timedelta(days=5)).isoformat()
    http = login(client, planner)
    await http.post("/api/v1/admin/roadmap", json={"title": "SHAPE-UP 1기", "category": "SHAPE-UP", "description": "", "startsAt": starts, "endsAt": None, "isPublished": True, "memberIds": [str(shown.id)]})
    await http.post("/api/v1/admin/roadmap", json={"title": "비공개 준비", "category": "대회", "description": "", "startsAt": starts, "endsAt": None, "isPublished": False, "memberIds": [str(shown.id)]})

    # 아직 부원 페이지가 없으므로 공개 프로필도 없다.
    assert (await client.get("/api/v1/member-profiles")).json() == []

    http = login(client, editor)
    cards = [{"id": "card-1", "name": "김부원", "team": "Manipulation", "role": "연구원", "affiliation": "기계공학부", "userId": str(shown.id)},
             {"id": "card-2", "name": "이름만", "team": "Reasoning", "role": "준회원", "affiliation": "기계공학부"}]
    assert (await http.put("/api/v1/admin/pages/members", json={"title": "부원", "contentHtml": "", "contentJson": {"members": cards}, "isPublished": True})).status_code == 200

    profiles = (await client.get("/api/v1/member-profiles")).json()
    assert [row["id"] for row in profiles] == [str(shown.id)]
    assert profiles[0]["introduction"] == "보행 제어를 공부하고 있습니다."
    # 공개된 일정만 노출되고, 연결되지 않은 계정은 아예 나오지 않는다.
    assert [project["title"] for project in profiles[0]["projects"]] == ["SHAPE-UP 1기"]
    assert str(hidden.id) not in (await client.get("/api/v1/member-profiles")).text
    assert "email" not in profiles[0]


async def test_members_can_post_and_comment_on_the_board(client, session):
    manager = await make_user(session, "board@example.com", permissions=["notices:manage"])
    member = await make_user(session, "member@example.com")
    other = await make_user(session, "other@example.com")

    http = login(client, member)
    blocked = await http.post("/api/v1/notices", json={"title": "가짜 공지", "category": "공지", "contentHtml": "<p>x</p>", "contentJson": {}, "isPinned": False})
    assert blocked.status_code == 403
    written = await http.post("/api/v1/notices", json={"title": "Isaac Sim 설치가 안 됩니다", "category": "질문", "contentHtml": "<p>도와주세요</p><script>alert(1)</script>", "contentJson": {}, "isPinned": False})
    assert written.status_code == 201, written.text
    post = written.json()
    assert post["authorName"] == "member" and post["canEdit"] is True
    assert "script" not in post["contentHtml"]

    # 자유 글은 전체 알림을 보내지 않는다.
    assert (await login(client, other).get("/api/v1/notifications")).json() == []

    http = login(client, other)
    comment = await http.post(f"/api/v1/notices/{post['id']}/comments", json={"body": "드라이버 버전부터 확인해 보세요."})
    assert comment.status_code == 201
    reply = await http.post(f"/api/v1/notices/{post['id']}/comments", json={"body": "감사합니다", "parentId": comment.json()["id"]})
    assert reply.json()["parentId"] == comment.json()["id"]
    # 답글의 답글도 한 단계로 눌러 붙인다.
    nested = await http.post(f"/api/v1/notices/{post['id']}/comments", json={"body": "저도요", "parentId": reply.json()["id"]})
    assert nested.json()["parentId"] == comment.json()["id"]

    http = login(client, member)
    listed = (await http.get(f"/api/v1/notices/{post['id']}/comments")).json()
    assert len(listed) == 3
    assert all(row["canDelete"] is False for row in listed)
    assert (await http.get(f"/api/v1/notices/{post['id']}")).json()["commentCount"] == 3

    http = login(client, other)
    assert (await http.delete(f"/api/v1/comments/{comment.json()['id']}")).status_code == 204
    listed = (await http.get(f"/api/v1/notices/{post['id']}/comments")).json()
    removed = next(row for row in listed if row["id"] == comment.json()["id"])
    assert removed["isDeleted"] is True and removed["body"] == "삭제된 댓글입니다."
    assert len(listed) == 3  # 대댓글 맥락이 남는다

    # 남의 글은 못 고치고, 관리자는 고칠 수 있다.
    edit = {"title": "제목 바꾸기", "category": "질문", "contentHtml": "<p>수정</p>", "contentJson": {}, "isPinned": False}
    assert (await login(client, other).patch(f"/api/v1/notices/{post['id']}", json=edit)).status_code == 403
    assert (await login(client, manager).patch(f"/api/v1/notices/{post['id']}", json=edit)).status_code == 200


async def test_reservation_calendar_lists_a_whole_month(client, session):
    officer = await make_user(session, "officer@example.com", permissions=["reservations:manage"])
    member = await make_user(session, "member@example.com")
    equipment = Equipment(name="OMY", category="로봇 팔", reservation_unit_minutes=30)
    session.add(equipment)
    await session.flush()
    unit = EquipmentUnit(equipment_id=equipment.id, label="OMY 1호기")
    session.add(unit)
    await session.commit()
    starts = (datetime.now(UTC) + timedelta(days=1)).replace(minute=0, second=0, microsecond=0)
    payload = {"equipmentUnitId": str(unit.id), "startsAt": starts.isoformat(), "endsAt": (starts + timedelta(hours=1)).isoformat(), "purpose": "데이터 수집"}
    http = login(client, member)
    reservation = (await http.post("/api/v1/reservations", json=payload)).json()

    month = starts.strftime("%Y-%m")
    rows = (await http.get(f"/api/v1/reservations/calendar?month={month}")).json()
    assert [row["status"] for row in rows] == ["PENDING"]
    assert rows[0]["equipmentName"] == "OMY" and rows[0]["userName"] == "member"
    assert rows[0]["purpose"] == "데이터 수집"
    assert rows[0]["beforePhotoUrl"] is None

    await login(client, officer).post(f"/api/v1/admin/reservations/{reservation['id']}/decision", json={"approve": True})
    rows = (await login(client, member).get(f"/api/v1/reservations/calendar?month={month}")).json()
    assert rows[0]["status"] == "APPROVED"
    assert (await http.get("/api/v1/reservations/calendar?month=2026-13")).status_code == 422
    # 다른 달에는 나오지 않는다.
    assert (await http.get("/api/v1/reservations/calendar?month=2030-01")).json() == []


async def test_resource_library_visibility_and_ownership(client, session):
    editor = await make_user(session, "editor@example.com", permissions=["content:manage"])
    member = await make_user(session, "member@example.com")
    other = await make_user(session, "other@example.com")

    http = login(client, member)
    public = await http.post("/api/v1/resources", json={"title": "SHAPE-UP 제안서 양식", "description": "한 학기 스코프를 맞추는 데 쓰는 양식입니다.", "category": "양식", "fileUrl": "https://res.cloudinary.com/demo/raw/upload/v1/shape/resources/form.docx", "fileName": "제안서양식.docx", "fileSize": 24000, "isPublic": True})
    assert public.status_code == 201, public.text
    assert public.json()["authorName"] == "member" and public.json()["canEdit"] is True
    internal = await http.post("/api/v1/resources", json={"title": "장비 비밀번호 안내", "category": "기타", "linkUrl": "https://drive.google.com/internal", "isPublic": False})
    assert internal.status_code == 201

    # 파일도 링크도 없으면 거절한다.
    assert (await http.post("/api/v1/resources", json={"title": "빈 자료", "category": "기타"})).status_code == 422

    # 비회원에게는 공개 자료만 보인다.
    anonymous = (await logout(client).get("/api/v1/resources")).json()
    assert [row["title"] for row in anonymous] == ["SHAPE-UP 제안서 양식"]
    assert anonymous[0]["canEdit"] is False

    # 로그인한 회원에게는 전부 보인다.
    signed_in = (await login(client, other).get("/api/v1/resources")).json()
    assert len(signed_in) == 2
    assert all(row["canEdit"] is False for row in signed_in)

    # 남의 자료는 못 지우고, 콘텐츠 관리자는 지울 수 있다.
    resource_id = public.json()["id"]
    assert (await login(client, other).delete(f"/api/v1/resources/{resource_id}")).status_code == 403
    assert (await login(client, editor).delete(f"/api/v1/resources/{resource_id}")).status_code == 204
    assert len((await login(client, member).get("/api/v1/resources")).json()) == 1


async def test_document_upload_signature(client, session):
    import hashlib

    member = await make_user(session, "member@example.com")
    http = login(client, member)
    response = await http.post("/api/v1/media/file-signature")
    assert response.status_code == 200, response.text
    data = response.json()
    params = f"folder={data['folder']}&timestamp={data['timestamp']}"
    assert data["signature"] == hashlib.sha1(f"{params}secret".encode()).hexdigest()
    assert "pdf" in data["allowedExtensions"] and data["maxFileSize"] == 10 * 1024 * 1024


async def test_equipment_permissions_separate_training_from_status(client, session):
    manager = await make_user(session, "gear@example.com", permissions=["equipment:manage"])
    member = await make_user(session, "member@example.com")
    safety = License(name="로봇 안전 교육")
    arm = License(name="로봇 팔 기초 교육")
    session.add_all([safety, arm])
    ready = Equipment(name="OMY", category="로봇 팔")
    broken = Equipment(name="AI Worker", category="양팔", status=EquipmentStatus.MAINTENANCE)
    session.add_all([ready, broken])
    await session.flush()
    session.add_all([
        EquipmentLicenseRequirement(equipment_id=ready.id, license_id=safety.id),
        EquipmentLicenseRequirement(equipment_id=ready.id, license_id=arm.id),
        EquipmentLicenseRequirement(equipment_id=broken.id, license_id=safety.id),
        UserLicense(user_id=member.id, license_id=safety.id),
    ])
    await session.commit()

    rows = {row["name"]: row for row in (await login(client, member).get("/api/v1/equipment-permissions")).json()}
    # 하나만 이수했으므로 남은 교육이 정확히 나와야 한다.
    assert rows["OMY"]["missingLicenses"] == ["로봇 팔 기초 교육"]
    assert rows["OMY"]["licensed"] is False and rows["OMY"]["eligible"] is False
    # 교육은 다 마쳤지만 장비가 점검 중인 경우는 구분된다.
    assert rows["AI Worker"]["missingLicenses"] == []
    assert rows["AI Worker"]["licensed"] is True and rows["AI Worker"]["eligible"] is False
    assert rows["AI Worker"]["status"] == "MAINTENANCE"
    # 세션에는 본인이 실제로 가진 라이선스만 담긴다.
    assert (await login(client, member).get("/api/v1/auth/me")).json()["licenses"] == ["로봇 안전 교육"]
    assert manager is not None


def test_editor_output_survives_sanitising():
    """Everything the toolbar can produce must still be there after saving."""
    from app.services.content import sanitize_html

    kept = {
        "굵게": "<p><strong>굵게</strong></p>",
        "기울임": "<p><em>기울임</em></p>",
        "밑줄": "<p><u>밑줄</u></p>",
        "취소선": "<p><s>취소</s></p>",
        "줄바꿈": "<p>첫 줄<br>둘째 줄</p>",
        "목록": "<ul><li><p>항목</p></li></ul>",
        "번호목록": "<ol><li><p>하나</p></li></ol>",
        "인용": "<blockquote><p>인용문</p></blockquote>",
        "제목": "<h2>중간 제목</h2>",
        "수평선": "<hr>",
        "코드블록": "<pre><code>print(1)</code></pre>",
        # 사진은 그대로 살아남되 주소가 변환본으로 바뀌고 늦게 받도록 표시된다.
        # 그 부분은 test_body_images_are_delivered_smaller 에서 따로 본다.
        "이미지": '<img loading="lazy" decoding="async" src="/figs/a.jpeg" alt="">',
    }
    for label, html in kept.items():
        assert sanitize_html(html) == html, label

    # 형광펜과 글자 색·크기는 style 속성이 정규화되므로 내용만 확인한다.
    highlighted = sanitize_html('<p><mark data-color="#fff1a8" style="background-color: #fff1a8">형광</mark></p>')
    assert "<mark" in highlighted and "background-color" in highlighted
    sized = sanitize_html('<p><span style="font-size: 24px">큰 글씨</span></p>')
    assert "font-size" in sized and "24px" in sized
    coloured = sanitize_html('<p><span style="color: rgb(40, 85, 243)">파랑</span></p>')
    assert "color" in coloured

    # 문단을 사이에 끼워 번호 목록을 이어 쓰면 편집기가 시작 번호를 함께 내보낸다.
    # 이 값을 지우면 저장하는 순간 번호가 1 부터 다시 시작한다.
    resumed = sanitize_html('<ol start="4"><li><p>넷째</p></li></ol>')
    assert 'start="4"' in resumed

    # 위험한 것은 그대로 막혀 있어야 한다.
    assert "<script" not in sanitize_html("<p>ok</p><script>alert(1)</script>")
    assert "onclick" not in sanitize_html('<p onclick="steal()">ok</p>')
    assert "javascript:" not in sanitize_html('<a href="javascript:alert(1)">x</a>')
    assert "<iframe" not in sanitize_html('<iframe src="https://evil.example"></iframe>')


async def test_shape_up_results_are_public_but_member_written(client, session):
    editor = await make_user(session, "editor@example.com", permissions=["content:manage"])
    member = await make_user(session, "member@example.com")
    other = await make_user(session, "other@example.com")

    body = {
        "title": "보행 정책 sim-to-real 이전",
        "summary": "시뮬레이터에서 학습한 보행 정책을 실물로 옮기며 겪은 문제와 해결 과정을 정리했습니다.",
        "cohort": "2026-2",
        "teamName": "워크온",
        "teamMembers": ["오유하", "류이든", " ", "전한별"],
        "contentHtml": "<p>결과</p><script>alert(1)</script>",
        "contentJson": {},
        "githubUrl": "https://github.com/snu-shape/walk-on",
        "videoUrl": "https://youtu.be/dQw4w9WgXcQ",
    }
    assert (await logout(client).post("/api/v1/shape-up", json=body)).status_code == 401

    http = login(client, member)
    created = await http.post("/api/v1/shape-up", json=body)
    assert created.status_code == 201, created.text
    post = created.json()
    assert post["teamMembers"] == ["오유하", "류이든", "전한별"]  # 빈 이름은 걸러진다
    assert "script" not in post["contentHtml"]
    assert post["authorName"] == "member" and post["canEdit"] is True

    # 로그인하지 않아도 목록과 상세를 볼 수 있다.
    listed = (await logout(client).get("/api/v1/shape-up")).json()
    assert [row["title"] for row in listed] == ["보행 정책 sim-to-real 이전"]
    assert listed[0]["canEdit"] is False
    detail = (await client.get(f"/api/v1/shape-up/{post['id']}")).json()
    assert detail["cohort"] == "2026-2" and detail["teamName"] == "워크온"

    # 남의 글은 못 고치고, 콘텐츠 관리자는 고칠 수 있다.
    assert (await login(client, other).patch(f"/api/v1/shape-up/{post['id']}", json=body)).status_code == 403
    assert (await login(client, editor).patch(f"/api/v1/shape-up/{post['id']}", json={**body, "title": "제목 수정"})).status_code == 200
    assert (await login(client, other).delete(f"/api/v1/shape-up/{post['id']}")).status_code == 403
    assert (await login(client, member).delete(f"/api/v1/shape-up/{post['id']}")).status_code == 204
    assert (await logout(client).get("/api/v1/shape-up")).json() == []


async def test_a_future_reservation_cannot_be_started_early(client, session):
    """내일 예약을 오늘 "사용 중"으로 바꿔 예약 현황을 어지럽히지 못하게 한다."""
    officer = await make_user(session, "officer@example.com", permissions=["reservations:manage"])
    member = await make_user(session, "member@example.com")
    equipment = Equipment(name="레이저 커터", category="제작", reservation_unit_minutes=30)
    session.add(equipment)
    await session.flush()
    unit = EquipmentUnit(equipment_id=equipment.id, label="1호기")
    session.add(unit)
    await session.commit()
    starts = (datetime.now(UTC) + timedelta(days=3)).replace(minute=0, second=0, microsecond=0)
    payload = {"equipmentUnitId": str(unit.id), "startsAt": starts.isoformat(), "endsAt": (starts + timedelta(hours=1)).isoformat(), "purpose": "아크릴 절단"}
    http = login(client, member)
    reservation = (await http.post("/api/v1/reservations", json=payload)).json()
    http = login(client, officer)
    assert (await http.post(f"/api/v1/admin/reservations/{reservation['id']}/decision", json={"approve": True})).status_code == 200
    http = login(client, member)
    early = await http.post(f"/api/v1/reservations/{reservation['id']}/before", json={"photoUrl": "https://res.cloudinary.com/demo/before.jpg"})
    assert early.status_code == 409
    assert (await http.get("/api/v1/reservations/me")).json()[0]["status"] == "APPROVED"


async def test_reservation_times_carry_a_timezone(client, session):
    """시간대가 빠진 값이 나가면 브라우저가 9시간 이른 시각으로 읽는다."""
    member = await make_user(session, "member@example.com")
    equipment = Equipment(name="밴드쏘", category="제작", reservation_unit_minutes=30)
    session.add(equipment)
    await session.flush()
    unit = EquipmentUnit(equipment_id=equipment.id, label="1호기")
    session.add(unit)
    await session.commit()
    starts = (datetime.now(UTC) + timedelta(days=2)).replace(minute=0, second=0, microsecond=0)
    payload = {"equipmentUnitId": str(unit.id), "startsAt": starts.isoformat(), "endsAt": (starts + timedelta(hours=1)).isoformat(), "purpose": "목재 절단"}
    http = login(client, member)
    created = (await http.post("/api/v1/reservations", json=payload)).json()
    assert datetime.fromisoformat(created["startsAt"]).tzinfo is not None
    assert datetime.fromisoformat(created["startsAt"]) == starts


async def test_a_visitor_gets_an_empty_session_rather_than_an_error(client, session):
    """공개 페이지마다 401 이 찍히면 콘솔이 지저분해지고 읽기 한도만 축냅니다."""
    response = await logout(client).get("/api/v1/auth/me")
    assert response.status_code == 200
    assert response.json() is None
    member = await make_user(session, "member@example.com")
    signed_in = await login(client, member).get("/api/v1/auth/me")
    assert signed_in.json()["email"] == "member@example.com"


async def test_members_get_their_own_flood_budget(client, session):
    """학교 Wi-Fi 처럼 한 IP 를 나눠 쓰는 곳에서 서로의 한도를 깎지 않아야 한다."""
    first = await make_user(session, "one@example.com")
    second = await make_user(session, "two@example.com")
    for guard in CostGuardMiddleware.instances:
        guard.settings.rate_limit_read_per_minute = 3
        guard.buckets.clear()
    try:
        http = login(client, first)
        codes = [(await http.get("/api/v1/auth/me")).status_code for _ in range(4)]
        assert codes == [200, 200, 200, 429]
        # 같은 주소에서 접속한 다른 회원은 자기 몫을 그대로 쓴다.
        assert (await login(client, second).get("/api/v1/auth/me")).status_code == 200
        # 서명이 맞지 않는 쿠키로는 새 몫을 만들 수 없다. 주소 기준으로 센다.
        logout(client)
        client.cookies.set("shape_session", "not-a-real-token")
        visitor = [(await client.get("/api/v1/auth/me")).status_code for _ in range(4)]
        assert visitor[-1] == 429
    finally:
        for guard in CostGuardMiddleware.instances:
            guard.settings.rate_limit_read_per_minute = 5000
            guard.buckets.clear()


async def test_a_signed_in_read_never_goes_into_a_shared_cache(client, session):
    """같은 주소인데 보는 사람에 따라 달라지는 응답이 있어서 공유 캐시를 막는다."""
    logout(client)
    visitor = await client.get("/api/v1/shape-up")
    assert visitor.headers["cache-control"].startswith("public")
    member = await make_user(session, "member@example.com")
    signed_in = await login(client, member).get("/api/v1/shape-up")
    assert signed_in.headers["cache-control"] == "private, no-store"


async def test_responses_are_compressed(client, session):
    editor = await make_user(session, "editor@example.com", permissions=["news:manage"])
    http = login(client, editor)
    for index in range(6):
        body = {"title": f"소식 {index}", "summary": "가" * 200, "contentHtml": "<p>" + "나" * 400 + "</p>",
                "contentJson": {}, "category": "활동", "coverImage": None, "externalUrl": None, "isPublished": True}
        assert (await http.post("/api/v1/admin/news", json=body)).status_code == 201
    logout(client)
    plain = await client.get("/api/v1/news?limit=50", headers={"accept-encoding": "identity"})
    packed = await client.get("/api/v1/news?limit=50", headers={"accept-encoding": "gzip"})
    assert packed.headers.get("content-encoding") == "gzip"
    assert int(packed.headers["content-length"]) < len(plain.content) / 2


async def test_one_member_can_hold_two_machines_at_the_same_time(client, session):
    """한 사람이 서로 다른 장비를 같은 시간대에 예약할 수 있어야 한다.

    실험 하나에 로봇 팔과 GPU 워크스테이션을 함께 쓰는 일이 흔하다. 겹침을 막는
    기준은 사람이 아니라 호기이므로, 같은 호기만 아니면 시간이 겹쳐도 승인까지
    이어져야 한다.
    """
    officer = await make_user(session, "officer@example.com", permissions=["reservations:manage"])
    member = await make_user(session, "member@example.com")
    arm = Equipment(name="OMY", category="로봇 팔", reservation_unit_minutes=30)
    gpu = Equipment(name="GPU 워크스테이션", category="GPU", reservation_unit_minutes=30)
    session.add_all([arm, gpu])
    await session.flush()
    arm_unit = EquipmentUnit(equipment_id=arm.id, label="OMY 1호기")
    gpu_unit = EquipmentUnit(equipment_id=gpu.id, label="GPU 1호기")
    session.add_all([arm_unit, gpu_unit])
    await session.commit()

    starts = next_half_hour()
    window = {"startsAt": starts.isoformat(), "endsAt": (starts + timedelta(hours=2)).isoformat()}
    http = login(client, member)
    first = await http.post("/api/v1/reservations", json={"equipmentUnitId": str(arm_unit.id), "purpose": "데이터 수집", **window})
    second = await http.post("/api/v1/reservations", json={"equipmentUnitId": str(gpu_unit.id), "purpose": "정책 학습", **window})
    assert first.status_code == 201, first.text
    assert second.status_code == 201, second.text

    # 승인도 둘 다 되어야 한다. 확정 슬롯은 호기별로만 잠긴다.
    http = login(client, officer)
    for reservation in (first, second):
        decided = await http.post(f"/api/v1/admin/reservations/{reservation.json()['id']}/decision", json={"approve": True})
        assert decided.status_code == 200, decided.text

    http = login(client, member)
    mine = (await http.get("/api/v1/reservations/me")).json()
    assert {row["equipmentName"] for row in mine} == {"OMY", "GPU 워크스테이션"}
    assert all(row["status"] == "APPROVED" for row in mine)

    # 반대로 같은 호기의 같은 시간은 여전히 막혀야 한다.
    clash = await http.post("/api/v1/reservations", json={"equipmentUnitId": str(arm_unit.id), "purpose": "겹치는 신청", **window})
    assert clash.status_code == 409


async def test_news_list_can_leave_out_a_category(client, session):
    """소식 탭은 언론보도를 빼고 부른다. 언론보도는 자기 탭이 따로 있다."""
    editor = await make_user(session, "editor@example.com", permissions=["news:manage"])
    http = login(client, editor)
    for title, category in (("동아리 활동 소식", "활동"), ("신문에 실린 기사", "언론보도")):
        created = await http.post("/api/v1/admin/news", json={
            "title": title, "summary": "요약", "category": category,
            "contentHtml": "<p>본문</p>", "contentJson": {}, "isPublished": True,
        })
        assert created.status_code == 201, created.text

    everything = (await client.get("/api/v1/news")).json()
    assert {row["title"] for row in everything} == {"동아리 활동 소식", "신문에 실린 기사"}

    소식 = (await client.get("/api/v1/news?exclude=언론보도")).json()
    assert [row["title"] for row in 소식] == ["동아리 활동 소식"]

    언론보도 = (await client.get("/api/v1/news?category=언론보도")).json()
    assert [row["title"] for row in 언론보도] == ["신문에 실린 기사"]


def test_original_publish_date_is_read_from_the_article():
    """언론보도의 발행일은 원문에서 읽는다. 손으로 옮겨 적으면 틀리기 쉽다."""
    from app.services.link_preview import read_metadata

    # meta 태그에 둔 경우
    tagged = read_metadata(
        '<html><head><meta property="article:published_time" content="2026-07-15T19:06:00+09:00"/></head></html>',
        "https://news.example.com/a",
    )
    assert tagged["publishedAt"] == "2026-07-15T19:06:00+09:00"

    # 국내 언론사 상당수가 JSON-LD 안에만 둔다.
    embedded = read_metadata(
        '<html><head><script type="application/ld+json">'
        '{"@type":"NewsArticle","datePublished":"2026-08-09T14:44:12+09:00"}'
        "</script></head></html>",
        "https://news.example.com/b",
    )
    assert embedded["publishedAt"] == "2026-08-09T14:44:12+09:00"

    # 날짜가 없으면 빈 문자열. 관리자 화면은 그때 오늘 날짜를 쓴다.
    assert read_metadata("<html><head></head></html>", "https://news.example.com/c")["publishedAt"] == ""


async def test_news_keeps_the_publish_date_the_editor_chose(client, session):
    """발행일은 관리자가 고른 날짜를 그대로 쓰고, 나중에 고칠 수도 있다."""
    editor = await make_user(session, "editor@example.com", permissions=["news:manage"])
    http = login(client, editor)
    body = {
        "title": "예전 소식", "summary": "요약", "category": "활동",
        "contentHtml": "<p>본문</p>", "contentJson": {}, "isPublished": True,
        "publishedAt": "2026-04-01T09:00:00+09:00",
    }
    created = await http.post("/api/v1/admin/news", json=body)
    assert created.status_code == 201, created.text
    item_id = created.json()["id"]

    listed = (await client.get("/api/v1/news")).json()
    assert listed[0]["publishedAt"].startswith("2026-04-01")

    # 날짜를 고치면 그대로 따라간다. 예전에는 한 번 정해지면 바꿀 수 없었다.
    edited = await http.patch(f"/api/v1/admin/news/{item_id}", json={**body, "publishedAt": "2026-05-20T09:00:00+09:00"})
    assert edited.status_code == 200, edited.text
    assert (await client.get("/api/v1/news")).json()[0]["publishedAt"].startswith("2026-05-20")

    # 날짜를 비우고 공개하면 저장하는 날로 잡는다.
    blank = await http.post("/api/v1/admin/news", json={**body, "title": "오늘 소식", "publishedAt": None})
    assert blank.status_code == 201, blank.text

    # 초안은 발행일이 없어 공개 목록에 나오지 않는다.
    draft = await http.post("/api/v1/admin/news", json={**body, "title": "초안", "isPublished": False})
    assert draft.status_code == 201
    assert "초안" not in {row["title"] for row in (await client.get("/api/v1/news")).json()}


async def test_permissions_and_licences_can_be_set_all_at_once(client, session):
    """'전체 부여' 는 한 번의 요청으로 처리한다.

    한 칸씩 보내면 권한 일곱 개에 요청이 일곱 번 나간다. 분당 쓰기가 20회라
    두 사람만 연달아 처리해도 한도에 걸린다.
    """
    owner = await make_user(session, "owner@example.com", owner=True)
    member = await make_user(session, "member@example.com")
    first, second = License(name="교육 하나"), License(name="교육 둘")
    session.add_all([first, second])
    await session.commit()

    http = login(client, owner)
    everything = ["content:manage", "news:manage", "notices:manage", "equipment:manage",
                  "reservations:manage", "roadmap:manage", "links:manage"]
    granted = await http.put(f"/api/v1/admin/users/{member.id}/permissions", json={"permissions": everything})
    assert granted.status_code == 200, granted.text
    assert granted.json()["permissions"] == sorted(everything)

    licences = await http.put(f"/api/v1/admin/users/{member.id}/licenses",
                              json={"licenseIds": [str(first.id), str(second.id)]})
    assert licences.status_code == 200, licences.text
    assert len(licences.json()["licenseIds"]) == 2

    listed = next(row for row in (await http.get("/api/v1/admin/users")).json() if row["email"] == "member@example.com")
    assert sorted(listed["permissions"]) == sorted(everything)
    assert len(listed["licenseIds"]) == 2

    # 빈 목록은 전체 해제다.
    assert (await http.put(f"/api/v1/admin/users/{member.id}/permissions", json={"permissions": []})).status_code == 200
    assert (await http.put(f"/api/v1/admin/users/{member.id}/licenses", json={"licenseIds": []})).status_code == 200
    listed = next(row for row in (await http.get("/api/v1/admin/users")).json() if row["email"] == "member@example.com")
    assert listed["permissions"] == [] and listed["licenseIds"] == []

    # 없는 권한 이름은 받지 않는다.
    assert (await http.put(f"/api/v1/admin/users/{member.id}/permissions", json={"permissions": ["everything:manage"]})).status_code == 422


async def test_an_owner_can_appoint_another_owner(client, session):
    """owner 는 여러 명일 수 있고, 기존 owner 가 새 owner 를 지명한다."""
    first = await make_user(session, "first@example.com", owner=True)
    successor = await make_user(session, "successor@example.com", status=UserStatus.PENDING)

    http = login(client, first)
    promoted = await http.patch(f"/api/v1/admin/users/{successor.id}/owner", json={"isOwner": True})
    assert promoted.status_code == 200, promoted.text
    # 지명하면 기능 권한도 함께 채우고, 승인 상태로 올린다.
    assert len(promoted.json()["permissions"]) == 7
    row = next(r for r in (await http.get("/api/v1/admin/users")).json() if r["email"] == "successor@example.com")
    assert row["isOwner"] and row["status"] == "APPROVED" and len(row["permissions"]) == 7

    # 새 owner 도 owner 전용 창구를 쓸 수 있다.
    theirs = login(client, successor)
    assert (await theirs.get("/api/v1/admin/users")).status_code == 200

    # 자기 자신은 내릴 수 없다. 실수로 아무도 못 들어가는 상태가 되면 곤란하다.
    assert (await theirs.patch(f"/api/v1/admin/users/{successor.id}/owner", json={"isOwner": False})).status_code == 409

    # 다른 owner 는 내릴 수 있다.
    assert (await theirs.patch(f"/api/v1/admin/users/{first.id}/owner", json={"isOwner": False})).status_code == 200
    # 그러면 남은 owner 는 한 명이고, 그 한 명은 내릴 수 없다.
    assert (await theirs.patch(f"/api/v1/admin/users/{successor.id}/owner", json={"isOwner": False})).status_code == 409

    # owner 가 아닌 사람은 지명할 수 없다.
    plain = await make_user(session, "plain@example.com")
    assert (await login(client, plain).patch(f"/api/v1/admin/users/{first.id}/owner", json={"isOwner": True})).status_code == 403


async def test_a_viewer_can_read_but_not_write(client, session):
    """보기 전용 회원은 회원 화면을 읽기만 한다.

    멤버(직전 학기에는 활동했지만 이번 학기에는 활동하지 않는 인원)에게 줄
    등급이다. 로그인해서 공지·자료실·예약 현황을 보되 흔적은 남기지 않는다.
    """
    manager = await make_user(session, "manager@example.com", permissions=["notices:manage", "content:manage"])
    watcher = await make_user(session, "watcher@example.com", status=UserStatus.VIEWER)

    staff = login(client, manager)
    posted = await staff.post("/api/v1/notices", json={
        "title": "공지 하나", "category": "공지", "contentHtml": "<p>본문</p>",
        "contentJson": {}, "isPinned": False,
    })
    assert posted.status_code == 201, posted.text
    notice_id = posted.json()["id"]
    assert (await staff.post("/api/v1/resources", json={
        "title": "회원 전용 자료", "description": "", "category": "기타",
        "fileUrl": None, "fileName": None, "fileSize": 0,
        "linkUrl": "https://drive.google.com/shape", "isPublic": False,
    })).status_code == 201

    eyes = login(client, watcher)
    # 읽는 것은 된다.
    assert (await eyes.get("/api/v1/notices")).status_code == 200
    assert (await eyes.get(f"/api/v1/notices/{notice_id}")).status_code == 200
    assert (await eyes.get(f"/api/v1/notices/{notice_id}/comments")).status_code == 200
    assert (await eyes.get("/api/v1/reservations/calendar?month=2026-09")).status_code == 200
    assert (await eyes.get("/api/v1/reservations/me")).status_code == 200
    assert (await eyes.get("/api/v1/equipment-permissions")).status_code == 200
    assert (await eyes.get("/api/v1/notifications")).status_code == 200

    # 회원 전용 자료도 보이지만 고칠 수는 없다.
    listed = (await eyes.get("/api/v1/resources")).json()
    assert "회원 전용 자료" in {row["title"] for row in listed}
    assert all(row["canEdit"] is False for row in listed)

    # 남기는 일은 모두 막힌다.
    blocked = {
        "글쓰기": await eyes.post("/api/v1/notices", json={"title": "쓰기", "category": "일반", "contentHtml": "<p>a</p>", "contentJson": {}, "isPinned": False}),
        "댓글": await eyes.post(f"/api/v1/notices/{notice_id}/comments", json={"body": "댓글"}),
        "예약": await eyes.post("/api/v1/reservations", json={"equipmentUnitId": str(watcher.id), "startsAt": "2026-12-01T10:00:00+09:00", "endsAt": "2026-12-01T11:00:00+09:00", "purpose": "시도"}),
        "자료 올리기": await eyes.post("/api/v1/resources", json={"title": "x", "description": "", "category": "기타", "fileUrl": None, "fileName": None, "fileSize": 0, "linkUrl": "https://example.com/a", "isPublic": True}),
        "SHAPE-UP": await eyes.post("/api/v1/shape-up", json={"title": "x", "summary": "", "cohort": "", "teamName": "", "teamMembers": [], "coverImage": None, "contentHtml": "", "contentJson": {}, "githubUrl": None, "videoUrl": None}),
    }
    assert {name: row.status_code for name, row in blocked.items()} == dict.fromkeys(blocked, 403)
    assert "보기 전용" in blocked["글쓰기"].json()["detail"]

    # 관리자 화면은 근처도 못 간다.
    assert (await eyes.get("/api/v1/admin/users")).status_code == 403


async def test_an_owner_can_set_a_member_to_viewer(client, session):
    """운영진이 회원을 보기 전용으로 내리고 되돌릴 수 있다."""
    owner = await make_user(session, "owner@example.com", owner=True)
    member = await make_user(session, "member@example.com")
    http = login(client, owner)

    assert (await http.patch(f"/api/v1/admin/users/{member.id}/status", json={"status": "VIEWER"})).status_code == 200
    row = next(r for r in (await http.get("/api/v1/admin/users")).json() if r["email"] == "member@example.com")
    assert row["status"] == "VIEWER"
    assert (await login(client, member).post("/api/v1/notices", json={"title": "x", "category": "일반", "contentHtml": "<p>a</p>", "contentJson": {}, "isPinned": False})).status_code == 403

    # login 은 같은 client 의 쿠키를 바꿔 끼우므로 다시 owner 로 돌아온다.
    http = login(client, owner)
    assert (await http.patch(f"/api/v1/admin/users/{member.id}/status", json={"status": "APPROVED"})).status_code == 200
    assert (await login(client, member).get("/api/v1/notices")).status_code == 200


async def member_page_with(session, cards):
    from app.models import ContentPage

    session.add(ContentPage(slug="members", title="부원", content_json={"members": cards}, content_html="", is_published=True))
    await session.commit()


async def test_a_member_claims_their_own_card(client, session):
    """부원 카드와 구글 계정을 잇는 일은 본인이 한다.

    운영진이 마흔 명을 하나씩 맞춰 주는 것보다 각자 로그인해서 자기 카드를
    집는 편이 정확하다.
    """
    mine = await make_user(session, "yuha@example.com")
    mine.name = "오유하"
    other = await make_user(session, "other@example.com")
    other.name = "류이든"
    await session.commit()
    await member_page_with(session, [
        {"id": "card-1", "name": "오유하", "team": "Management", "role": "팀원", "membership": "정회원",
         "imageUrl": "/figs/오유하.jpeg"},
        {"id": "card-2", "name": "류이든", "team": "Manipulation", "role": "팀원", "membership": "멤버"},
    ])

    http = login(client, mine)
    # 이름이 같은 카드가 후보로 나온다.
    found = (await http.get("/api/v1/auth/me/member-card")).json()
    assert found["card"] is None
    assert [row["id"] for row in found["candidates"]] == ["card-1"]

    # 비어 있는 카드는 이름이 달라도 고를 수 있다. 구글 계정 이름이 영문이라
    # 후보가 하나도 안 뜨는 경우가 흔해서, 본인이 직접 고르는 길을 열어 두었다.
    assert [row["id"] for row in found["available"]] == ["card-1", "card-2"]
    assert found["myName"] == "오유하"
    assert (await http.post("/api/v1/auth/me/member-card", json={"cardId": "없는카드"})).status_code == 404

    claimed = await http.post("/api/v1/auth/me/member-card", json={"cardId": "card-1"})
    assert claimed.status_code == 200, claimed.text
    assert claimed.json()["card"]["id"] == "card-1"

    # 카드 사진이 내 계정 사진이 된다. 두 프로필이 갈리지 않게 하는 자리다.
    assert (await http.get("/api/v1/auth/me")).json()["imageUrl"] == "/figs/오유하.jpeg"

    # 공개 부원 카드에도 연결이 남는다.
    page = (await client.get("/api/v1/pages/members")).json()
    assert page["contentJson"]["members"][0]["userId"] == str(mine.id)

    # 이미 집힌 카드는 남이 집을 수 없다. 비어 있는 카드 목록에서도 빠진다.
    thief = await make_user(session, "thief@example.com")
    thief.name = "오유하"
    await session.commit()
    thief_http = login(client, thief)
    assert (await thief_http.post("/api/v1/auth/me/member-card", json={"cardId": "card-1"})).status_code == 409
    assert [row["id"] for row in (await thief_http.get("/api/v1/auth/me/member-card")).json()["available"]] == ["card-2"]

    # 놓으면 카드는 남고 연결만 사라진다.
    http = login(client, mine)
    released = await http.delete("/api/v1/auth/me/member-card")
    assert released.status_code == 200
    # 놓자마자 다시 후보로 올라와, 잘못 집었을 때 곧바로 되돌릴 수 있다.
    assert [row["id"] for row in released.json()["candidates"]] == ["card-1"]
    page = (await client.get("/api/v1/pages/members")).json()
    assert "userId" not in page["contentJson"]["members"][0]
    assert page["contentJson"]["members"][0]["name"] == "오유하"


async def test_claiming_moves_the_link_from_an_older_card(client, session):
    """한 계정은 카드 하나만 갖는다. 다른 카드를 집으면 앞의 것은 놓인다."""
    user = await make_user(session, "one@example.com")
    user.name = "강채아"
    await session.commit()
    await member_page_with(session, [
        {"id": "old", "name": "강채아"},
        {"id": "new", "name": "강채아"},
    ])
    http = login(client, user)
    assert (await http.post("/api/v1/auth/me/member-card", json={"cardId": "old"})).status_code == 200
    assert (await http.post("/api/v1/auth/me/member-card", json={"cardId": "new"})).status_code == 200
    cards = (await client.get("/api/v1/pages/members")).json()["contentJson"]["members"]
    assert "userId" not in cards[0]
    assert cards[1]["userId"] == str(user.id)


async def test_a_name_written_with_split_jamo_still_matches(client, session):
    """자모가 풀려 저장된 이름(NFD)도 같은 이름으로 본다.

    맥에서 만든 자료가 자모가 풀린 채로 들어온 적이 있어, 눈으로는 같은 '장하람'
    인데 후보가 뜨지 않았다. 띄어쓰기 차이도 같이 흡수한다.
    """
    import unicodedata

    user = await make_user(session, "haram@example.com")
    user.name = "장 하람"
    await session.commit()
    await member_page_with(session, [{"id": "card-1", "name": unicodedata.normalize("NFD", "장하람")}])
    found = (await login(client, user).get("/api/v1/auth/me/member-card")).json()
    assert [row["id"] for row in found["candidates"]] == ["card-1"]


def test_body_images_are_delivered_smaller():
    """본문에 박힌 원본 사진 주소를 변환본 주소로 고친다.

    편집기는 업로드가 끝나면 받은 주소를 그대로 넣는다. 그 주소는 원본이라
    휴대폰 사진 3MB 가 글을 여는 사람마다 통째로 나간다. 실제 소식 5장 기준
    원본 8.5MB, 변환본 0.46MB 였다.
    """
    from app.services.content import sanitize_html

    raw = '<img src="https://res.cloudinary.com/demo/image/upload/v1787/shape/news/a.jpg" alt="">'
    out = sanitize_html(raw)
    assert "/image/upload/f_auto,q_auto,c_limit,w_1400/v1787/shape/news/a.jpg" in out
    # 화면에 들어올 때 받도록 표시한다.
    assert 'loading="lazy"' in out and 'decoding="async"' in out

    # 이미 지시가 붙은 주소는 두 번 붙이지 않는다.
    once = sanitize_html(out)
    assert once.count("f_auto") == 1
    assert once.count('loading="lazy"') == 1

    # 우리 폴더에 있는 사진과 남의 사이트 사진은 건드리지 않는다.
    kept = sanitize_html('<img src="/figs/a.jpeg" alt=""><img src="https://example.com/b.jpg" alt="">')
    assert "/figs/a.jpeg" in kept and "https://example.com/b.jpg" in kept
    assert "f_auto" not in kept


async def test_old_posts_are_delivered_smaller_too(client, session):
    """규칙이 생기기 전에 저장된 글도 내보낼 때 줄여서 나간다.

    운영 DB 를 직접 고치지 않아도 되도록, 저장할 때뿐 아니라 읽을 때도 주소를
    고친다. 예전 글이 원본 3MB 사진을 그대로 물고 있는 것이 지금 무료 티어에서
    가장 큰 지출이다.
    """
    from app.models import NewsPost

    raw = '<img src="https://res.cloudinary.com/demo/image/upload/v1/old.jpg" alt="">'
    session.add(NewsPost(title="옛 글", summary="", category="소식", content_html=raw,
                         cover_image=None, external_url=None,
                         published_at=datetime(2026, 8, 1, tzinfo=UTC), is_published=True))
    await session.commit()

    listed = (await client.get("/api/v1/news?limit=5")).json()
    detail = (await client.get(f"/api/v1/news/{listed[0]['id']}")).json()
    assert "f_auto,q_auto,c_limit,w_1400/v1/old.jpg" in detail["contentHtml"]


async def test_the_board_list_stays_light(client, session):
    """게시판 목록은 본문을 싣지 않고, 한 번에 30개까지만 보낸다.

    예전에는 게시된 글을 전부, 본문까지 담아 보냈다. 회원 전용이라 공유 캐시도
    못 태우므로 글이 쌓일수록 목록을 여는 사람마다 무거운 응답이 나갔다.
    """
    from app.models import Notice

    user = await make_user(session)
    for index in range(33):
        session.add(Notice(
            title=f"글 {index:02d}", category="일반", content_html="<p>본문</p>",
            author_id=user.id, is_published=True, is_pinned=False,
            published_at=datetime(2026, 8, 1, tzinfo=UTC) + timedelta(minutes=index),
        ))
    await session.commit()

    http = login(client, user)
    first = (await http.get("/api/v1/notices")).json()
    assert len(first) == 30
    assert "contentHtml" not in first[0]

    # 나머지는 마지막 글보다 앞선 것부터 이어 받는다.
    older = (await http.get(f"/api/v1/notices?before={first[-1]['publishedAt']}")).json()
    assert [row["title"] for row in older] == ["글 02", "글 01", "글 00"]

    # 본문은 글을 눌렀을 때 온다.
    detail = (await http.get(f"/api/v1/notices/{first[0]['id']}")).json()
    assert detail["contentHtml"] == "<p>본문</p>"


async def test_the_home_page_is_editable(client, session):
    """홈 화면 글귀도 관리자 화면에서 고칠 수 있다.

    예전에는 page.tsx 안에 상수로 박혀 있어 문구 한 줄에도 배포가 필요했다.
    이제 고정 페이지 `home` 의 content_json 에 담고, 저장하면 공개 홈이 다시
    그려진다(revalidate 대상에 "/" 를 넣어 두었다).
    """
    owner = await make_user(session, "homeowner@example.com", owner=True)
    http = login(client, owner)

    body = {"title": "홈", "contentHtml": "", "isPublished": True,
            "contentJson": {"hero": {"titleTop": "SHAPE", "titleAccent": "the real world."}}}
    saved = await http.put("/api/v1/admin/pages/home", json=body)
    assert saved.status_code == 200, saved.text

    page = (await client.get("/api/v1/pages/home")).json()
    assert page["contentJson"]["hero"]["titleAccent"] == "the real world."

    # 목록에 없는 slug 는 여전히 받지 않는다.
    assert (await http.put("/api/v1/admin/pages/hacked", json=body)).status_code == 404


async def test_owners_are_told_about_a_new_reservation_request(client, session):
    """예약 신청이 들어오면 운영진(owner)에게 알림이 남는다.

    신청은 운영진이 승인해야 진행되는데, 예전에는 아무 표시가 없어 관리자 화면을
    직접 열어 보기 전에는 기다리는 신청이 있는지 알 수 없었다.
    """
    owner = await make_user(session, "owner-alert@example.com", owner=True)
    other = await make_user(session, "plain@example.com")
    # 라이선스를 걸지 않은 장비는 누구나 예약할 수 있다.
    equipment = Equipment(name="라이선스 없는 장비", category="공용")
    session.add(equipment)
    await session.flush()
    unit = EquipmentUnit(equipment_id=equipment.id, label="1호기")
    session.add(unit)
    await session.commit()
    starts = (datetime.now(UTC) + timedelta(days=1)).replace(minute=0, second=0, microsecond=0)

    http = login(client, other)
    made = await http.post("/api/v1/reservations", json={
        "equipmentUnitId": str(unit.id),
        "startsAt": starts.isoformat(),
        "endsAt": (starts + timedelta(hours=1)).isoformat(),
        "purpose": "실험 준비",
    })
    assert made.status_code == 201, made.text

    alerts = (await login(client, owner).get("/api/v1/notifications")).json()
    assert len(alerts) == 1, alerts
    assert equipment.name in alerts[0]["title"]
    # 누르면 예약을 승인하는 화면으로 갑니다. 게시판 공지와 갈 곳이 다릅니다.
    assert alerts[0]["url"] == "/admin"

    # 신청한 본인에게는 가지 않는다.
    assert (await login(client, other).get("/api/v1/notifications")).json() == []

    # 같은 신청을 두 번 보내도 알림은 하나다.
    again = await login(client, other).post("/api/v1/reservations", json={
        "equipmentUnitId": str(unit.id),
        "startsAt": starts.isoformat(),
        "endsAt": (starts + timedelta(hours=1)).isoformat(),
        "purpose": "실험 준비",
    })
    assert again.status_code == 201
    assert len((await login(client, owner).get("/api/v1/notifications")).json()) == 1


async def test_the_resource_library_takes_many_file_kinds(client, session):
    """자료실은 문서만이 아니라 실제로 오가는 자료를 받는다.

    형식이 막혀 있으면 각자 개인 드라이브로 흩어지고, 그러면 다음 기수에 아무것도
    남지 않는다. 다만 브라우저가 바로 실행하는 형식은 받지 않는다.
    """
    user = await make_user(session)
    signed = await login(client, user).post("/api/v1/media/file-signature")
    # Cloudinary 설정이 없는 시험 환경에서는 503 이 정상이므로 목록만 본다.
    from app.routers.media import RAW_EXTENSIONS

    for wanted in ("urdf", "ipynb", "bag", "stl", "mp4", "parquet", "7z", "step"):
        assert wanted in RAW_EXTENSIONS, wanted
    for blocked in ("html", "htm", "svg", "exe", "dll", "bat"):
        assert blocked not in RAW_EXTENSIONS, blocked
    assert signed.status_code in {200, 503}


def test_the_editor_can_save_tables_alignment_and_math():
    """글쓰기 도구가 새로 지원하는 서식이 저장까지 살아남는다.

    표·정렬·줄 간격·취소선·수식은 저장할 때 지우개(sanitizer)를 지난다. 허용
    목록에 없으면 저장하는 순간 조용히 사라지므로, 도구를 늘릴 때는 이쪽도 함께
    늘려야 한다.
    """
    from app.services.content import sanitize_html

    saved = sanitize_html(
        '<p style="text-align: center; line-height: 1.8">가운데</p>'
        '<table><tbody><tr><th colspan="2">머리</th></tr><tr><td>가</td><td>나</td></tr></tbody></table>'
        '<div data-math="x^2" class="math-block">x^2</div>'
        '<p><s>취소선</s><sup>위</sup><sub>아래</sub></p>'
    )
    assert 'style="text-align: center; line-height: 1.8;"' in saved
    assert "<table>" in saved and 'colspan="2"' in saved
    assert 'data-math="x^2"' in saved
    assert "<s>취소선</s>" in saved

    # 위험한 것은 그대로 막는다.
    blocked = sanitize_html('<script>alert(1)</script><p style="position:fixed">x</p><iframe src="x"></iframe>')
    assert "<script" not in blocked and "<iframe" not in blocked and "position" not in blocked


async def test_a_new_member_gets_a_card_when_approved(client, session):
    """새로 가입한 부원은 승인되는 순간 부원 카드가 생긴다.

    명단에 미리 이름이 없던 사람은 고를 카드가 없어, 예전에는 부원 페이지에 아예
    나오지 않았다. 이름·사진·소개말은 계정에서 가져오고 팀·역할은 운영진이 채운다.
    """
    from app.models import UserStatus

    owner = await make_user(session, "owner-card@example.com", owner=True)
    newcomer = await make_user(session, "new@example.com")
    newcomer.name = "새로온"
    newcomer.status = UserStatus.PENDING
    newcomer.image_url = "https://res.cloudinary.com/demo/image/upload/v1/me.jpg"
    await session.commit()

    http = login(client, owner)
    assert (await http.patch(f"/api/v1/admin/users/{newcomer.id}/status", json={"status": "APPROVED"})).status_code == 200

    cards = (await client.get("/api/v1/pages/members")).json()["contentJson"]["members"]
    mine = [card for card in cards if card.get("userId") == str(newcomer.id)]
    assert len(mine) == 1, cards
    assert mine[0]["name"] == "새로온"
    assert mine[0]["membership"] == "준회원"

    # 마이페이지에서도 내 카드로 보인다.
    found = (await login(client, newcomer).get("/api/v1/auth/me/member-card")).json()
    assert found["card"]["name"] == "새로온"

    # 두 번 승인해도 카드가 겹쳐 생기지 않는다.
    http = login(client, owner)
    await http.patch(f"/api/v1/admin/users/{newcomer.id}/status", json={"status": "APPROVED"})
    cards = (await client.get("/api/v1/pages/members")).json()["contentJson"]["members"]
    assert len([card for card in cards if card.get("userId") == str(newcomer.id)]) == 1


async def test_a_member_can_make_their_own_card(client, session):
    """이 기능이 생기기 전에 승인된 부원은 마이페이지에서 직접 카드를 만든다."""
    user = await make_user(session, "already@example.com")
    user.name = "이미승인"
    await session.commit()

    http = login(client, user)
    before = (await http.get("/api/v1/auth/me/member-card")).json()
    assert before["card"] is None

    made = await http.post("/api/v1/auth/me/member-card/new")
    assert made.status_code == 200, made.text
    assert made.json()["card"]["name"] == "이미승인"

    # 다시 눌러도 카드는 하나다.
    assert (await http.post("/api/v1/auth/me/member-card/new")).json()["card"]["id"] == made.json()["card"]["id"]
    cards = (await client.get("/api/v1/pages/members")).json()["contentJson"]["members"]
    assert len([card for card in cards if card.get("userId") == str(user.id)]) == 1


async def test_releasing_an_account_card_removes_it(client, session):
    """내 계정으로 만든 카드를 놓으면 카드 자체가 사라진다.

    남겨 두면 주인 없는 카드가 부원 페이지에 그대로 남고, 이름이 같은 다른
    사람에게 후보로 뜨기까지 한다. 명단에서 온 카드는 운영진 자료라 연결만 푼다.
    """
    user = await make_user(session, "made@example.com")
    user.name = "만든이"
    await session.commit()
    http = login(client, user)

    await http.post("/api/v1/auth/me/member-card/new")
    cards = (await client.get("/api/v1/pages/members")).json()["contentJson"]["members"]
    assert any(card["name"] == "만든이" for card in cards)

    await http.delete("/api/v1/auth/me/member-card")
    cards = (await client.get("/api/v1/pages/members")).json()["contentJson"]["members"]
    assert not any(card["name"] == "만든이" for card in cards)


async def test_equipment_order_can_be_rearranged(client, session):
    """관리자 화면에서 끌어다 놓은 차례가 공개 목록에 그대로 나온다."""
    from app.models import Equipment

    manager = await make_user(session, "gearorder@example.com", permissions=["equipment:manage"])
    names = ["가 장비", "나 장비", "다 장비"]
    for index, name in enumerate(names):
        session.add(Equipment(name=name, category="시험", sort_order=index))
    await session.commit()

    listed = (await client.get("/api/v1/equipment")).json()
    assert [row["name"] for row in listed] == names

    http = login(client, manager)
    flipped = [row["id"] for row in reversed(listed)]
    assert (await http.put("/api/v1/admin/equipment/order", json={"ids": flipped})).status_code == 200

    listed = (await client.get("/api/v1/equipment")).json()
    assert [row["name"] for row in listed] == list(reversed(names))

    # 없는 장비가 섞여 오면 아무것도 바꾸지 않는다.
    import uuid

    bad = await http.put("/api/v1/admin/equipment/order", json={"ids": [*flipped, str(uuid.uuid4())]})
    assert bad.status_code == 404
    listed = (await client.get("/api/v1/equipment")).json()
    assert [row["name"] for row in listed] == list(reversed(names))


# ------------------------------------------------------- 공개 응답 캐시 (Neon)


async def test_public_read_is_served_from_the_cache_until_a_save_clears_it(client, session):
    """같은 공개 창구를 다시 불러도 데이터베이스까지 내려가지 않는다.

    Neon 무료 티어는 질의 횟수가 아니라 깨어 있는 시간으로 계산하고, 5분만 놀면
    잠든다. 재검증이 올 때마다 데이터베이스를 깨우면 잠들 틈이 없어진다.
    """
    from app import cache
    from app.models import NewsPost
    from app.services.revalidate import refresh

    cache.clear()
    logout(client)
    session.add(NewsPost(title="처음 제목", summary="요약", category="활동", is_published=True, published_at=datetime.now(UTC)))
    await session.commit()

    assert [row["title"] for row in (await client.get("/api/v1/news")).json()] == ["처음 제목"]

    # 관리자 화면을 거치지 않고 값을 바꾸면 창이 끝날 때까지 옛 값이 나온다.
    post = (await session.scalars(select(NewsPost))).one()
    post.title = "바뀐 제목"
    await session.commit()
    assert [row["title"] for row in (await client.get("/api/v1/news")).json()] == ["처음 제목"]

    # 운영진이 저장하면 그 자리에서 버린다.
    refresh("news")
    assert [row["title"] for row in (await client.get("/api/v1/news")).json()] == ["바뀐 제목"]


async def test_a_signed_in_reader_never_gets_the_shared_cache(client, session):
    """로그인한 사람의 화면에는 남의 몫으로 담아 둔 응답이 나가지 않는다."""
    from app import cache
    from app.models import ShapeUpPost

    cache.clear()
    author = await make_user(session, "shapeupcache@example.com")
    session.add(ShapeUpPost(author_id=author.id, title="결과물", summary="", cohort="1기", team_name="가팀", is_published=True))
    await session.commit()

    # 방문자 몫이 먼저 담긴다. 고칠 수 없는 상태다.
    logout(client)
    assert (await client.get("/api/v1/shape-up")).json()[0]["canEdit"] is False

    # 글쓴이가 보면 담아 둔 값이 아니라 자기 몫을 받는다.
    assert (await login(client, author).get("/api/v1/shape-up")).json()[0]["canEdit"] is True
    logout(client)


async def test_cloudinary_delivery_urls_yield_the_public_id():
    """변환과 판 번호가 낀 주소에서도 지울 이름을 뽑아낸다."""
    from app.services.cloudinary import public_id_of

    assert public_id_of("https://res.cloudinary.com/demo/image/upload/v1787/shape/news/1/a.jpg") == ("image", "shape/news/1/a")
    assert public_id_of("https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,c_limit,w_1400/v1787/shape/news/1/a.jpg") == ("image", "shape/news/1/a")
    # raw 파일은 확장자까지가 이름이다.
    assert public_id_of("https://res.cloudinary.com/demo/raw/upload/v1787/shape/resources/1/report.pdf") == ("raw", "shape/resources/1/report.pdf")
    assert public_id_of("https://example.com/not-ours.jpg") is None
    assert public_id_of(None) is None


async def test_growing_lists_are_cut_into_pages(client, session):
    """자료실과 SHAPE UP 이 쌓여도 한 번에 받는 양은 그대로다."""
    from app.models import Resource, ShapeUpPost
    from app.routers.member import RESOURCE_PAGE, SHAPE_UP_PAGE

    member = await make_user(session, "paging@example.com")
    session.add_all([
        Resource(author_id=member.id, title=f"자료 {index}", category="기타", is_public=True)
        for index in range(RESOURCE_PAGE + 5)
    ])
    session.add_all([
        ShapeUpPost(author_id=member.id, title=f"결과물 {index}", summary="", cohort="1기", team_name="가팀", is_published=True)
        for index in range(SHAPE_UP_PAGE + 5)
    ])
    await session.commit()

    http = login(client, member)
    assert len((await http.get("/api/v1/resources")).json()) == RESOURCE_PAGE
    assert len((await http.get("/api/v1/shape-up")).json()) == SHAPE_UP_PAGE
    # 상한 위로는 올려 달라고 해도 올라가지 않는다.
    assert (await http.get(f"/api/v1/resources?limit={RESOURCE_PAGE + 1}")).status_code == 422
    logout(client)


async def test_shape_up_detail_does_not_carry_the_editor_document(client, session):
    """읽는 사람에게 쓰지도 않는 본문 사본이 함께 나가지 않는다."""
    from app.models import ShapeUpPost

    author = await make_user(session, "shapeupbody@example.com")
    post = ShapeUpPost(author_id=author.id, title="결과물", summary="", cohort="1기", team_name="가팀", content_html="<p>본문</p>", is_published=True)
    session.add(post)
    await session.commit()

    logout(client)
    body = (await client.get(f"/api/v1/shape-up/{post.id}")).json()
    assert body["contentHtml"] == "<p>본문</p>"
    assert "contentJson" not in body


async def test_a_name_changed_on_shape_survives_the_next_login(client, session):
    """마이페이지에서 고친 이름이 다음 로그인에 되돌아가지 않는다.

    예전에는 로그인할 때마다 구글 이름을 덮어썼다. 구글 이름은 영문이거나 이메일
    앞부분인 경우가 많아, 이름을 한글 실명으로 고쳐 놓아도 다음 로그인에 원래대로
    돌아갔다. 부원 카드와 이어 두었다면 부원 페이지까지 함께 흐트러진다.
    """
    from app.routers.auth import adopt_google_profile

    user = await make_user(session, "rollback@example.com")
    user.name = "Sehwan Park"
    await session.commit()

    http = login(client, user)
    changed = await http.patch("/api/v1/auth/me", json={"name": "장하람", "imageUrl": "/figs/me.jpeg", "introduction": None})
    assert changed.status_code == 200 and changed.json()["name"] == "장하람"
    await session.refresh(user)

    # 구글에서 다시 로그인한 상황.
    adopt_google_profile(user, {"name": "Sehwan Park", "picture": "https://lh3.googleusercontent.com/a/x"}, owner=False)
    assert user.name == "장하람", "고친 이름이 구글 이름으로 되돌아갔다"
    assert user.image_url == "/figs/me.jpeg", "고친 사진이 구글 사진으로 되돌아갔다"

    # 아직 아무것도 채우지 않은 계정에는 구글 값을 쓴다.
    fresh = await make_user(session, "blank@example.com")
    fresh.name = ""
    fresh.image_url = None
    adopt_google_profile(fresh, {"name": "새 회원", "picture": "https://lh3.googleusercontent.com/a/y"}, owner=False)
    assert fresh.name == "새 회원"
    assert fresh.image_url == "https://lh3.googleusercontent.com/a/y"


async def test_the_window_is_spread_so_expiries_do_not_land_together():
    """같은 창이라도 창구마다 만료 시각이 조금씩 다르다.

    다 같이 만료시키면 그 순간에 질의가 몰린다. Neon 은 5분을 놀아야 잠들므로,
    30초 안에서 흩어 두어도 '한 번 깨어남' 은 그대로다.
    """
    from app.cache import window_end

    keys = [f"z:/api/v1/{name}?" for name in ("news", "equipment", "roadmap", "links", "shape-up")]
    spread = 30
    ends = {window_end(3600, key, spread, now=1_000_000.0) for key in keys}
    assert len(ends) > 1, "만료가 한 시각에 몰려 있습니다"
    assert max(ends) - min(ends) < spread
    # Neon 이 잠드는 데 걸리는 5분보다 훨씬 좁아야 한 번의 깨어남으로 끝난다.
    assert max(ends) - min(ends) < 300
    # 같은 열쇠는 언제 물어도 같은 자리다(서버를 다시 띄워도 마찬가지).
    assert window_end(3600, keys[0], spread, now=1_000_000.0) == window_end(3600, keys[0], spread, now=1_000_010.0)


async def test_one_request_fills_the_cache_while_the_others_wait(client, session):
    """같은 창구로 동시에 들어와도 데이터베이스로는 하나만 내려간다.

    창이 끝나는 순간 Vercel 이 여러 지역에서 같은 쪽을 동시에 재검증한다. 묶어
    두지 않으면 저마다 질의를 보내는데(재어 보니 동시 8건이 24건), 연결이 셋뿐인
    무료 인스턴스에서는 그대로 줄서기가 된다.
    """
    from sqlalchemy import event

    from app import cache
    from app.database import engine
    from app.models import Equipment

    cache.clear()
    logout(client)
    session.add(Equipment(name="측정용 장비", category="시험", sort_order=0))
    await session.commit()

    queries: list[int] = []

    def tally(*_args):
        queries.append(1)

    event.listen(engine.sync_engine, "before_cursor_execute", tally)
    try:
        responses = await asyncio.gather(*(client.get("/api/v1/equipment") for _ in range(8)))
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", tally)

    assert all(response.status_code == 200 for response in responses)
    # 여덟 건이 모두 같은 본문을 받는다. 하나가 채우고 나머지는 그것을 받는다.
    assert len({response.text for response in responses}) == 1
    # 한 번 채우는 데 드는 질의만큼만 나가야 한다. 묶기 전에는 여덟 배였다.
    assert len(queries) <= 4, f"중복 질의가 나갔습니다: {len(queries)}건"


async def test_the_board_and_admin_never_touch_the_public_cache(client, session):
    """게시판·관리자 응답은 캐시에 담기지 않는다. 저장한 것은 즉시 보여야 한다."""
    from app import cache

    cache.clear()
    manager = await make_user(session, "nocache@example.com", owner=True)
    http = login(client, manager)
    for path in ("/api/v1/notices", "/api/v1/resources", "/api/v1/admin/news", "/api/v1/pages/home"):
        response = await http.get(path)
        assert response.headers.get("Cache-Control") == "private, no-store", path
    assert cache.size() == 0, "회원 요청이 공개 캐시에 담겼습니다"
    logout(client)


async def test_the_roadmap_keeps_the_future_when_it_has_to_cut(client, session):
    """로드맵이 상한을 넘겨도 앞으로 있을 일정이 남는다.

    시작일 오름차순으로 앞에서 끊으면 잘려 나가는 쪽이 미래다. 홈의 '일정' 칸은
    아직 끝나지 않은 일정만 쓰므로 그렇게 두면 홈이 조용히 빈다.
    """
    from app.models import RoadmapItem
    from app.routers.public import ROADMAP_PAGE

    start = datetime(2020, 1, 1, tzinfo=UTC)
    session.add_all([
        RoadmapItem(title=f"일정 {index}", category="교육", description="",
                    starts_at=start + timedelta(days=index * 10), is_published=True)
        for index in range(ROADMAP_PAGE + 50)
    ])
    await session.commit()

    logout(client)
    rows = (await client.get("/api/v1/roadmap")).json()
    assert len(rows) == ROADMAP_PAGE
    titles = [row["title"] for row in rows]
    assert f"일정 {ROADMAP_PAGE + 49}" in titles, "가장 나중 일정이 잘려 나갔습니다"
    assert "일정 0" not in titles, "오래된 쪽이 아니라 최신 쪽이 잘렸습니다"
    # 돌려줄 때는 다시 오름차순이어야 한다.
    assert titles == sorted(titles, key=lambda name: int(name.split()[1]))


async def test_the_code_exchange_only_accepts_our_own_return_address(client, session):
    """코드를 남의 주소로 흘려보낼 수 없다.

    구글이 우리 화면으로 돌아오게 바꾸면서, 코드를 받아 세션으로 바꾸는 창구가
    생겼다. 돌아올 주소를 아무거나 받으면 그 자체가 구멍이 된다.
    """
    assert session is not None
    bad = await client.post("/api/v1/auth/google/exchange", json={
        "code": "x" * 10, "redirectUri": "https://evil.example.com/login/google/callback",
    })
    assert bad.status_code in {400, 503}, bad.text
    if bad.status_code == 400:
        assert "허용" in bad.json()["detail"]


async def test_the_requester_hears_about_approval_and_rejection(client, session):
    """승인·반려·취소 결과가 신청한 사람에게 간다.

    예전에는 마이페이지를 직접 열어 보기 전에는 승인이 됐는지 알 수 없었다.
    """
    from app.models import Equipment, EquipmentUnit

    manager = await make_user(session, "resmgr@example.com", permissions=["reservations:manage"])
    member = await make_user(session, "asker@example.com")
    equipment = Equipment(name="예약 알림 장비", category="공용")
    session.add(equipment)
    await session.flush()
    unit = EquipmentUnit(equipment_id=equipment.id, label="1호기")
    session.add(unit)
    await session.commit()

    starts = (datetime.now(UTC) + timedelta(days=1)).replace(minute=0, second=0, microsecond=0)
    payload = {"equipmentUnitId": str(unit.id), "startsAt": starts.isoformat(),
               "endsAt": (starts + timedelta(hours=1)).isoformat(), "purpose": "실험 준비"}
    made = await login(client, member).post("/api/v1/reservations", json=payload)
    assert made.status_code == 201
    reservation_id = made.json()["id"]

    # 승인
    http = login(client, manager)
    assert (await http.post(f"/api/v1/admin/reservations/{reservation_id}/decision", json={"approve": True})).status_code == 200
    alerts = (await login(client, member).get("/api/v1/notifications")).json()
    assert any("확정" in row["title"] and "예약 알림 장비" in row["title"] for row in alerts), alerts
    assert alerts[0]["url"] == "/mypage"

    # 취소도 알린다
    http = login(client, manager)
    assert (await http.post(f"/api/v1/admin/reservations/{reservation_id}/cancel", json={"approve": False, "reason": "점검"})).status_code == 200
    alerts = (await login(client, member).get("/api/v1/notifications")).json()
    assert any("취소" in row["title"] for row in alerts), alerts


async def test_due_reservations_ask_for_photos(client, session):
    """사용 시간이 되면 알리고, 끝났는데 사진이 없으면 한 번 더 알린다."""
    from app.models import Equipment, EquipmentUnit, Reservation, ReservationStatus
    from app.services.reservation_alerts import sweep_due

    member = await make_user(session, "due@example.com")
    equipment = Equipment(name="시간 알림 장비", category="공용")
    session.add(equipment)
    await session.flush()
    unit = EquipmentUnit(equipment_id=equipment.id, label="2호기")
    session.add(unit)
    await session.flush()

    now = datetime.now(UTC)
    running = Reservation(equipment_unit_id=unit.id, user_id=member.id, purpose="사용 중",
                          starts_at=now - timedelta(minutes=5), ends_at=now + timedelta(hours=1),
                          status=ReservationStatus.APPROVED)
    finished = Reservation(equipment_unit_id=unit.id, user_id=member.id, purpose="끝남",
                           starts_at=now - timedelta(hours=3), ends_at=now - timedelta(hours=2),
                           status=ReservationStatus.IN_USE, start_notified_at=now)
    session.add_all([running, finished])
    await session.commit()

    # 시작한 지 30분이 지났는데 사용 전 사진이 없는 예약
    stale = Reservation(equipment_unit_id=unit.id, user_id=member.id, purpose="사진 없음",
                        starts_at=now - timedelta(minutes=45), ends_at=now + timedelta(minutes=30),
                        status=ReservationStatus.APPROVED, start_notified_at=now)
    session.add(stale)
    await session.commit()

    sent = await sweep_due(session)
    titles = [title for title, _, _ in sent]
    assert any("사용 시간입니다" in t for t in titles), titles
    assert any("사용 전 사진이 아직 없습니다" in t for t in titles), titles
    assert any("사용 후 사진" in t for t in titles), titles

    # 두 번 훑어도 같은 알림이 다시 가지 않는다.
    assert await sweep_due(session) == []
    alerts = (await login(client, member).get("/api/v1/notifications")).json()
    assert len(alerts) == 3, alerts


async def test_approval_license_and_maintenance_reach_the_member(client, session):
    """가입 승인·라이선스 부여·장비 점검이 당사자에게 간다.

    셋 다 '직접 들어와 봐야 아는' 자리였다. 승인됐는지, 이제 무엇을 예약할 수
    있는지, 내가 예약한 장비가 점검에 들어갔는지.
    """
    from app.models import Equipment, EquipmentStatus, EquipmentUnit, License, UserStatus

    owner = await make_user(session, "alertowner@example.com", owner=True)
    member = await make_user(session, "alerted@example.com")
    member.status = UserStatus.PENDING
    licence = License(name="로봇 팔 기초 교육")
    equipment = Equipment(name="알림 시험 장비", category="로봇 팔")
    session.add_all([licence, equipment])
    await session.flush()
    unit = EquipmentUnit(equipment_id=equipment.id, label="1호기")
    session.add(unit)
    session.add(EquipmentLicenseRequirement(equipment_id=equipment.id, license_id=licence.id))
    await session.commit()

    http = login(client, owner)
    # 1) 가입 승인
    assert (await http.patch(f"/api/v1/admin/users/{member.id}/status", json={"status": "APPROVED"})).status_code == 200
    alerts = (await login(client, member).get("/api/v1/notifications")).json()
    assert any("가입이 승인" in row["title"] for row in alerts), alerts

    # 2) 라이선스 부여 — 무엇이 열렸는지 함께
    http = login(client, owner)
    granted = await http.post(f"/api/v1/admin/users/{member.id}/licenses", json={"licenseId": str(licence.id)})
    assert granted.status_code == 201
    alerts = (await login(client, member).get("/api/v1/notifications")).json()
    assert any("로봇 팔 기초 교육" in row["title"] for row in alerts), alerts

    # 3) 앞으로 쓸 예약이 있는 장비가 점검에 들어가면
    starts = (datetime.now(UTC) + timedelta(days=2)).replace(minute=0, second=0, microsecond=0)
    made = await login(client, member).post("/api/v1/reservations", json={
        "equipmentUnitId": str(unit.id), "startsAt": starts.isoformat(),
        "endsAt": (starts + timedelta(hours=1)).isoformat(), "purpose": "실험 준비",
    })
    assert made.status_code == 201, made.text
    http = login(client, owner)
    changed = await http.patch(f"/api/v1/admin/equipment/{equipment.id}", json={
        "name": equipment.name, "category": equipment.category, "description": "",
        "imageUrl": None, "status": EquipmentStatus.MAINTENANCE.value,
        "reservationUnitMinutes": 60, "sortOrder": 0,
    })
    assert changed.status_code == 200, changed.text
    alerts = (await login(client, member).get("/api/v1/notifications")).json()
    assert any("점검 중" in row["title"] for row in alerts), alerts
