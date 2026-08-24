import asyncio
from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest

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
    assert card == {"title": "SHAPE, 휴머노이드 데모 공개", "description": "서울대 학생들이 만든 로봇", "image": "https://cdn.example.com/a.jpg", "siteName": "예시신문"}
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
        "이미지": '<img src="https://res.cloudinary.com/x/a.jpg" alt="">',
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
