import asyncio
import json
from datetime import UTC, datetime, timedelta
from urllib.parse import unquote
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import func, select, update

from app import cache
from app.middleware import CostGuardMiddleware, public_read
from app.models import (
    Equipment,
    EquipmentLicenseRequirement,
    EquipmentStatus,
    EquipmentUnit,
    License,
    Notice,
    Reservation,
    ReservationPurpose,
    ReservationSlot,
    ReservationStatus,
    UserLicense,
    UserStatus,
)
from app.routers.admin import MANAGEABLE_PERMISSIONS
from app.services.reservation_alerts import STAFF_URL
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


async def test_related_link_visibility_narrows_the_public_list(client, session):
    """공개 범위 밖의 링크는 목록에 아예 들어오지 않는다."""
    editor = await make_user(session, "links@example.com", permissions=["links:manage"])
    http = login(client, editor)
    for title, scope in (("공개 링크", "PUBLIC"), ("부원 링크", "MEMBER"), ("운영진 링크", "STAFF")):
        created = await http.post("/api/v1/admin/links", json={
            "title": title, "url": f"https://example.com/{scope.lower()}", "isPublished": True, "visibility": scope,
        })
        assert created.status_code == 201, created.text

    # 링크를 관리하는 운영진은 셋 다 본다.
    assert {item["title"] for item in (await http.get("/api/v1/links")).json()} == {"공개 링크", "부원 링크", "운영진 링크"}

    # 보기 전용 회원(멤버)도 부원 전용까지는 읽는다. 운영진 전용은 아니다.
    viewer = await make_user(session, "viewer@example.com", status=UserStatus.VIEWER)
    assert {item["title"] for item in (await login(client, viewer).get("/api/v1/links")).json()} == {"공개 링크", "부원 링크"}

    # 로그인하지 않은 방문자에게는 전체 공개만 나간다.
    visitor = (await logout(client).get("/api/v1/links")).json()
    assert [item["title"] for item in visitor] == ["공개 링크"]
    assert visitor[0]["visibility"] == "PUBLIC"


async def test_related_link_defaults_to_public(client, session):
    """공개 범위를 보내지 않는 예전 화면이 저장해도 지금까지처럼 전체 공개다."""
    editor = await make_user(session, "links@example.com", permissions=["links:manage"])
    http = login(client, editor)
    await http.post("/api/v1/admin/links", json={"title": "Drive", "url": "https://drive.example.com", "isPublished": True})
    assert (await logout(client).get("/api/v1/links")).json()[0]["visibility"] == "PUBLIC"


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
    payload = {"equipmentUnitId": str(unit.id), "startsAt": starts.isoformat(), "endsAt": (starts + timedelta(hours=1)).isoformat(), "note": "출력 테스트"}
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


def awaiting_half_hour() -> datetime:
    """**사람이 승인해야 하는** 시각. 자동 확정 창(시작 1시간 전) 밖으로 잡는다.

    `next_half_hour()` 는 언제나 30분 안쪽이라, 이제 신청과 동시에 자동 확정된다.
    승인·반려처럼 사람이 누르는 길을 시험하려면 그 창 밖이어야 한다.
    """
    return next_half_hour() + timedelta(hours=3)


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
    starts = awaiting_half_hour()
    payload = {"equipmentUnitId": str(unit.id), "startsAt": starts.isoformat(), "endsAt": (starts + timedelta(hours=1)).isoformat(), "note": "부품 출력"}
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
    payload = {"equipmentUnitId": str(unit.id), "startsAt": starts.isoformat(), "endsAt": (starts + timedelta(minutes=30)).isoformat(), "note": "학습 실험"}
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
    blocked = await http.post("/api/v1/reservations", json={"equipmentUnitId": str(unit.id), "startsAt": starts.isoformat(), "endsAt": (starts + timedelta(minutes=30)).isoformat(), "note": "보행 실험"})
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


async def test_flood_guard_counts_the_address_the_proxy_vouches_for(client):
    """스스로 지어낸 `X-Forwarded-For` 로는 한도를 비켜 갈 수 없습니다.

    `X-Forwarded-For` 의 맨 앞 값은 보내는 쪽이 그냥 적어 넣을 수 있습니다. 그것만
    보고 세면, 요청마다 다른 가짜 주소를 적는 것만으로 한도가 통째로 무의미해집니다.
    앞단(Cloudflare)이 덮어써 주는 칸이 있으면 그것을 먼저 봅니다.
    """
    for guard in CostGuardMiddleware.instances:
        guard.buckets.clear()
        guard.settings.rate_limit_read_per_minute = 3
    try:
        codes = [
            (await client.get("/api/v1/equipment", headers={
                "cf-connecting-ip": "203.0.113.7",
                "x-forwarded-for": f"198.51.100.{index}",
            })).status_code
            for index in range(5)
        ]
    finally:
        for guard in CostGuardMiddleware.instances:
            guard.settings.rate_limit_read_per_minute = 5000
            guard.buckets.clear()
    assert codes[:3] == [200, 200, 200]
    assert codes[3:] == [429, 429]


async def test_a_redirect_into_the_private_network_is_refused(monkeypatch):
    """바깥 주소가 사설 주소로 돌려보내면 거기서 멈춥니다.

    첫 주소만 보고 나머지를 httpx 의 자동 따라가기에 맡기면, 상대가 302 로
    `http://127.0.0.1` 을 가리키는 것만으로 우리 서버 안쪽을 대신 열어 주게 됩니다.
    """
    import httpx as web

    from app.services import link_preview

    def resolve(host, port, *args, **kwargs):
        # 바깥 주소는 공개 IP 로, 그 밖에는 적힌 그대로 본다.
        return [(2, 1, 6, "", ("93.184.216.34" if host == "news.example.com" else host, 0))]

    def answer(request: web.Request) -> web.Response:
        if request.url.host == "news.example.com":
            return web.Response(302, headers={"location": "http://127.0.0.1:8000/secret"})
        return web.Response(200, headers={"content-type": "text/html"}, text="<html><head><title>안쪽</title></head></html>")

    real = web.AsyncClient
    monkeypatch.setattr(link_preview.socket, "getaddrinfo", resolve)
    monkeypatch.setattr(link_preview.httpx, "AsyncClient", lambda **options: real(**options, transport=web.MockTransport(answer)))
    assert (await link_preview.build("https://news.example.com/a"))["status"] == "unreachable"


async def test_profile_and_resource_urls_must_be_ordinary_links(client, session):
    """사진·파일 주소 칸에 `javascript:` 같은 것이 저장되지 않습니다.

    이 값들은 화면에서 `<img src>` 와 `<a href>` 로 그대로 나갑니다. 막아 주는 것이
    화면 라이브러리 하나뿐인 상태를 안전하다고 부를 수 없어 저장하는 자리에서
    거릅니다. 평범한 https 주소와 우리 사이트 안의 경로는 그대로 통과합니다.
    """
    member = await make_user(session, "member@example.com")
    http = login(client, member)
    for bad in ("javascript:alert(1)", "data:text/html,<script>x</script>", "//evil.example/x.png"):
        assert (await http.patch("/api/v1/auth/me", json={"name": "부원", "imageUrl": bad})).status_code == 422, bad
    fine = await http.patch("/api/v1/auth/me", json={"name": "부원", "imageUrl": "/figs/member.jpg"})
    assert fine.status_code == 200 and fine.json()["imageUrl"] == "/figs/member.jpg"
    refused = await http.post("/api/v1/resources", json={
        "title": "자료", "category": "기타", "fileUrl": "javascript:alert(1)", "isPublic": True,
    })
    assert refused.status_code == 422


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
    payload = {"equipmentUnitId": str(unit.id), "startsAt": starts.isoformat(), "endsAt": (starts + timedelta(hours=1)).isoformat(), "note": "데이터 수집"}
    http = login(client, member)
    reservation = (await http.post("/api/v1/reservations", json=payload)).json()

    month = starts.strftime("%Y-%m")
    rows = (await http.get(f"/api/v1/reservations/calendar?month={month}")).json()
    assert [row["status"] for row in rows] == ["PENDING"]
    assert rows[0]["equipmentName"] == "OMY" and rows[0]["userName"] == "member"
    assert rows[0]["purposeCategory"] == "OTHER"
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
    # 받아도 되는 형식이 **서명 안에** 들어 있어야 합니다. 서명이 폴더와 시각만
    # 담고 있으면 같은 서명으로 무엇이든 올릴 수 있어서, 화면의 확인은 개발자
    # 도구로 요청을 한 번 고치는 것으로 지나갑니다.
    params = f"allowed_formats={data['allowedFormats']}&folder={data['folder']}&timestamp={data['timestamp']}"
    assert data["signature"] == hashlib.sha1(f"{params}secret".encode()).hexdigest()
    assert "pdf" in data["allowedFormats"].split(",") and "html" not in data["allowedFormats"].split(",")
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
        "githubUrl": "https://github.com/snu-shape/walk-on",
        "videoUrl": "https://youtu.be/dQw4w9WgXcQ",
        "slidesUrl": "https://drive.google.com/file/d/abc/view",
        # 초록·문제 설정·한계는 게시판·소식과 같은 편집기로 쓰므로 HTML 이다.
        "abstract": "<p>시뮬레이터에서 학습한 <strong>정책</strong>을 옮겼습니다.</p><script>alert(1)</script>",
        "problem": "<p>sim-to-real 격차 때문에 실물에서 넘어졌습니다.</p>",
        "limitations": "<ul><li>거친 바닥은 아직 못 걷습니다.</li></ul>",
        "methodBlocks": [
            {"image": "https://res.cloudinary.com/demo/image/upload/v1/m1.webp", "caption": "  구조도  "},
            {"image": None, "video": None, "caption": "   "},
        ],
        "resultBlocks": [
            {"video": "https://youtu.be/abcdefghijk", "caption": "롤아웃"},
        ],
    }
    assert (await logout(client).post("/api/v1/shape-up", json=body)).status_code == 401

    http = login(client, member)
    created = await http.post("/api/v1/shape-up", json=body)
    assert created.status_code == 201, created.text
    post = created.json()
    assert post["teamMembers"] == ["오유하", "류이든", "전한별"]  # 빈 이름은 걸러진다
    assert post["authorName"] == "member" and post["canEdit"] is True
    # 앞뒤 공백은 떼고, 아무것도 안 채운 덩이는 버린다. 화면에서 '블록 추가' 를
    # 누르고 그냥 저장하는 일이 흔하다.
    # 편집기가 보낸 것을 그대로 믿지 않는다. 서식은 살리고 스크립트는 걷어낸다.
    assert "<strong>정책</strong>" in post["abstract"]
    assert "script" not in post["abstract"]
    assert "<li>" in post["limitations"]
    assert len(post["methodBlocks"]) == 1
    assert post["methodBlocks"][0]["caption"] == "구조도"
    assert post["resultBlocks"][0]["video"] == "https://youtu.be/abcdefghijk"

    # 로그인하지 않아도 목록과 상세를 볼 수 있다.
    listed = (await logout(client).get("/api/v1/shape-up")).json()
    assert [row["title"] for row in listed] == ["보행 정책 sim-to-real 이전"]
    assert listed[0]["canEdit"] is False
    # 목록에는 카드에 쓰이는 것만 실린다. 초록·덩이까지 실어 보내면 결과물이
    # 쌓이는 만큼 목록을 여는 값이 함께 자란다.
    assert "abstract" not in listed[0] and "methodBlocks" not in listed[0]
    detail = (await client.get(f"/api/v1/shape-up/{post['id']}")).json()
    assert detail["cohort"] == "2026-2" and detail["teamName"] == "워크온"
    assert detail["problem"] and detail["limitations"] and detail["slidesUrl"]

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
    payload = {"equipmentUnitId": str(unit.id), "startsAt": starts.isoformat(), "endsAt": (starts + timedelta(hours=1)).isoformat(), "note": "아크릴 절단"}
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
    payload = {"equipmentUnitId": str(unit.id), "startsAt": starts.isoformat(), "endsAt": (starts + timedelta(hours=1)).isoformat(), "note": "목재 절단"}
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

    starts = awaiting_half_hour()
    window = {"startsAt": starts.isoformat(), "endsAt": (starts + timedelta(hours=2)).isoformat()}
    http = login(client, member)
    first = await http.post("/api/v1/reservations", json={"equipmentUnitId": str(arm_unit.id), "note": "데이터 수집", **window})
    second = await http.post("/api/v1/reservations", json={"equipmentUnitId": str(gpu_unit.id), "note": "정책 학습", **window})
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
    clash = await http.post("/api/v1/reservations", json={"equipmentUnitId": str(arm_unit.id), "note": "겹치는 신청", **window})
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
    # 지명하면 기능 권한도 함께 채우고, 승인 상태로 올린다. 수를 박아 두지 않고
    # 목록에서 세는 이유는, 권한이 하나 늘 때마다(문의 관리처럼) 이 시험이
    # 함께 깨지면서 정작 무엇이 잘못됐는지는 말해 주지 않기 때문이다.
    assert len(promoted.json()["permissions"]) == len(MANAGEABLE_PERMISSIONS)
    row = next(r for r in (await http.get("/api/v1/admin/users")).json() if r["email"] == "successor@example.com")
    assert row["isOwner"] and row["status"] == "APPROVED" and len(row["permissions"]) == len(MANAGEABLE_PERMISSIONS)

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
        "예약": await eyes.post("/api/v1/reservations", json={"equipmentUnitId": str(watcher.id), "startsAt": "2026-12-01T10:00:00+09:00", "endsAt": "2026-12-01T11:00:00+09:00", "note": "시도"}),
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
        "note": "실험 준비",
    })
    assert made.status_code == 201, made.text

    alerts = (await login(client, owner).get("/api/v1/notifications")).json()
    assert len(alerts) == 1, alerts
    assert equipment.name in alerts[0]["title"]
    # 누르면 **예약을 승인하는 탭이 열린 채로** 갑니다. 그냥 `/admin` 이면 맨 첫
    # 탭(히어로 편집)이 열려서 거기서 다시 두 번을 눌러야 했습니다.
    assert alerts[0]["url"] == STAFF_URL
    assert "장비예약" in unquote(alerts[0]["url"])

    # 신청한 본인에게는 가지 않는다.
    assert (await login(client, other).get("/api/v1/notifications")).json() == []

    # 같은 신청을 두 번 보내도 알림은 하나다.
    again = await login(client, other).post("/api/v1/reservations", json={
        "equipmentUnitId": str(unit.id),
        "startsAt": starts.isoformat(),
        "endsAt": (starts + timedelta(hours=1)).isoformat(),
        "note": "실험 준비",
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


async def test_shape_up_영상은_유튜브만_받는다(client, session):
    """영상을 우리가 받아 두지 않는다. 까닭은 `models.ShapeUpPost` 설명에.

    화면에서도 막지만 화면만 믿으면 안 되므로 서버가 한 번 더 본다.
    """
    member = await make_user(session, "video@example.com")
    http = login(client, member)
    base = {"title": "결과물", "summary": "요약"}

    for bad in ("https://vimeo.com/12345", "https://example.com/demo.mp4"):
        refused = await http.post("/api/v1/shape-up", json={**base, "videoUrl": bad})
        assert refused.status_code == 422, bad

    # 덩이 안의 영상도 같은 잣대를 받는다.
    refused = await http.post("/api/v1/shape-up", json={
        **base, "resultBlocks": [{"video": "https://vimeo.com/12345", "caption": "롤아웃"}]})
    assert refused.status_code == 422

    for good in ("https://youtu.be/dQw4w9WgXcQ", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"):
        ok = await http.post("/api/v1/shape-up", json={**base, "videoUrl": good})
        assert ok.status_code == 201, ok.text


async def test_shape_up_그림_칸에_넣은_유튜브는_영상으로_옮긴다(client, session):
    """한 덩이에 주소 칸이 둘이라 잘못 넣기 쉽다. 거절하지 말고 제자리로 옮긴다.

    그대로 두면 화면이 유튜브 주소를 `<img>` 로 그려 **깨진 그림**이 된다.
    실제로 눌러 보다가 그렇게 났다.
    """
    member = await make_user(session, "misplaced@example.com")
    made = await login(client, member).post("/api/v1/shape-up", json={
        "title": "결과물", "summary": "요약",
        "coverImage": "https://youtu.be/dQw4w9WgXcQ",
        "resultBlocks": [{"image": "https://youtu.be/abcdefghijk", "caption": "롤아웃"}],
    })
    assert made.status_code == 201, made.text
    post = made.json()
    # 덩이: 그림 자리는 비고 영상으로 옮겨간다.
    assert post["resultBlocks"][0]["image"] is None
    assert post["resultBlocks"][0]["video"] == "https://youtu.be/abcdefghijk"
    # 대표 그림도 같다. 목록 카드의 미리보기가 유튜브에서 나와야 한다.
    assert post["coverImage"] is None
    assert post["videoUrl"] == "https://youtu.be/dQw4w9WgXcQ"

    # 진짜 그림은 그대로 그림이다.
    photo = "https://res.cloudinary.com/demo/image/upload/v1/plot.webp"
    kept = await login(client, member).post("/api/v1/shape-up", json={
        "title": "둘째", "summary": "요약", "coverImage": photo,
        "resultBlocks": [{"image": photo, "caption": "그래프"}],
    })
    assert kept.json()["resultBlocks"][0]["image"] == photo
    assert kept.json()["coverImage"] == photo


async def test_shape_up_그림_주소는_고아_정리에서_살아남는다(client, session):
    """덩이 안의 그림이 '아무도 안 쓰는 사진' 으로 판정되면 안 된다.

    예전에는 본문(`content_html`)만 훑었다. 덩이로 바뀐 뒤에도 그대로 두었다면
    **쓰이고 있는 그림이 전부 지워졌을 것이다.**
    """
    from sqlalchemy import select

    from app.models import ShapeUpPost
    from app.services.media_sweep import _urls

    member = await make_user(session, "orphan@example.com")
    used = "https://res.cloudinary.com/demo/image/upload/v1/used.webp"
    created = await login(client, member).post("/api/v1/shape-up", json={
        "title": "결과물", "summary": "요약",
        "methodBlocks": [{"image": used, "caption": "구조도"}],
    })
    assert created.status_code == 201, created.text

    row = await session.scalar(select(ShapeUpPost))
    # 고아 정리기가 읽는 칸들을 그대로 훑어 본다(SQLite 에서도 도는 파이썬 쪽 규칙).
    assert used in _urls(row.cover_image, row.method_blocks, row.result_blocks)


async def test_shape_up_본문에_박은_사진도_고아_정리에서_살아남는다(client, session):
    """초록·문제 설정·한계는 편집기로 쓰므로 사진을 끼워 넣을 수 있다.

    그 주소를 `media_sweep` 이 읽는 칸에 넣지 않으면 **쓰이고 있는 그림이
    고아로 판정되어 지워진다.** 덩이만 챙기고 본문을 빠뜨리기 쉬운 자리다.
    """
    from app.services.media_sweep import COLUMNS, referenced

    member = await make_user(session, "inline@example.com")
    # 저장할 때 `sanitize_html` 이 주소에 축소 규칙(`f_auto,q_auto,…`)을 붙이므로
    # 담기는 주소는 이것과 다르다. 정리기는 `public_id_of` 로 변환 조각을 떼어
    # 이름만 견주므로 그래도 맞는다 — 그 사실까지 함께 확인한다.
    shot = "https://res.cloudinary.com/demo/image/upload/v1/shape/news/inline.webp"
    made = await login(client, member).post("/api/v1/shape-up", json={
        "title": "결과물", "summary": "요약",
        "abstract": f'<p>구조도입니다.</p><img src="{shot}" alt="">',
    })
    assert made.status_code == 201, made.text

    assert "shape/news/inline" in await referenced(session)

    # 정리기가 **실제로 그 칸을 읽도록** 등록돼 있는지까지 본다. 위 확인만으로는
    # 지금 통과할 뿐, 다음에 칸이 늘었을 때 빠뜨린 것을 잡지 못한다.
    watched = {column.property.columns[0].name for group in COLUMNS for column in group
               if column.property.columns[0].table.name == "shape_up_posts"}
    assert {"abstract", "problem", "limitations"} <= watched, watched


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
               "endsAt": (starts + timedelta(hours=1)).isoformat(), "note": "실험 준비"}
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
    running = Reservation(equipment_unit_id=unit.id, user_id=member.id, note="사용 중",
                          starts_at=now - timedelta(minutes=5), ends_at=now + timedelta(hours=1),
                          status=ReservationStatus.APPROVED)
    finished = Reservation(equipment_unit_id=unit.id, user_id=member.id, note="끝남",
                           starts_at=now - timedelta(hours=3), ends_at=now - timedelta(hours=2),
                           status=ReservationStatus.IN_USE, start_notified_at=now)
    session.add_all([running, finished])
    await session.commit()

    # 시작한 지 30분이 지났는데 사용 전 사진이 없는 예약
    stale = Reservation(equipment_unit_id=unit.id, user_id=member.id, note="사진 없음",
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
        "endsAt": (starts + timedelta(hours=1)).isoformat(), "note": "실험 준비",
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


async def test_a_reservation_can_name_who_uses_it_together(client, session):
    """장비 하나를 여럿이 함께 쓰는 경우를 담는다.

    예약 현황만 보고는 실제로 누가 함께 쓰는지 알 수 없었다. 사고나 파손이 있을 때
    누구에게 물어봐야 하는지도 알 수 없다.
    """
    from app.models import Equipment, EquipmentUnit, UserStatus

    asker = await make_user(session, "asks@example.com")
    mate = await make_user(session, "mate@example.com")
    mate.name = "함께쓰는사람"
    outsider = await make_user(session, "pending@example.com")
    outsider.status = UserStatus.PENDING
    equipment = Equipment(name="공동 사용 장비", category="공용")
    session.add(equipment)
    await session.flush()
    unit = EquipmentUnit(equipment_id=equipment.id, label="1호기")
    session.add(unit)
    await session.commit()

    starts = (datetime.now(UTC) + timedelta(days=1)).replace(minute=0, second=0, microsecond=0)
    body = {"equipmentUnitId": str(unit.id), "startsAt": starts.isoformat(),
            "endsAt": (starts + timedelta(hours=1)).isoformat(), "note": "함께 실험"}

    http = login(client, asker)
    # 승인되지 않은 계정은 넣을 수 없다.
    refused = await http.post("/api/v1/reservations", json={**body, "companionIds": [str(outsider.id)]})
    assert refused.status_code == 422, refused.text

    made = await http.post("/api/v1/reservations", json={**body, "companionIds": [str(mate.id), str(asker.id)]})
    assert made.status_code == 201, made.text
    # 신청한 본인은 '함께 쓰는 사람' 에 들어가지 않는다.
    assert made.json()["companions"] == ["함께쓰는사람"]

    # 마이페이지와 예약 현황에도 그대로 보인다.
    mine = (await http.get("/api/v1/reservations/me")).json()
    assert mine[0]["companions"] == ["함께쓰는사람"]
    month = starts.strftime("%Y-%m")
    calendar = (await http.get(f"/api/v1/reservations/calendar?month={month}")).json()
    assert any(row["companions"] == ["함께쓰는사람"] for row in calendar), calendar

    # 이름이 올라간 사람에게 알림이 간다.
    alerts = (await login(client, mate).get("/api/v1/notifications")).json()
    assert any("함께 쓰는 예약" in row["title"] for row in alerts), alerts

    # 고를 수 있는 회원 목록은 로그인한 회원에게만 보인다.
    # (login() 이 공용 클라이언트의 쿠키를 바꾸므로 여기서 비우고 확인한다)
    client.cookies.clear()
    assert (await client.get("/api/v1/members/directory")).status_code == 401
    listed = (await login(client, asker).get("/api/v1/members/directory")).json()
    assert any(row["name"] == "함께쓰는사람" for row in listed)
    assert all("email" not in row for row in listed)


# ------------------------------------------------ 아무도 안 쓰는 사진 정리하기


async def test_the_sweep_sees_every_place_a_photo_can_be_referenced(session):
    """본문에 박힌 사진까지 '쓰이는 중' 으로 본다."""
    from app.models import Equipment, NewsPost, ShapeUpPost
    from app.services.media_sweep import referenced

    base = "https://res.cloudinary.com/demo/image/upload"
    author = await make_user(session, "sweepref@example.com")
    session.add_all([
        Equipment(name="장비", category="시험", image_url=f"{base}/v1/shape/equipment/1/gear.jpg"),
        NewsPost(title="소식", summary="", category="활동", is_published=True,
                 published_at=datetime.now(UTC), cover_image=f"{base}/v1/shape/news/1/cover.webp",
                 content_html=f'<p><img src="{base}/f_auto,q_auto,c_limit,w_1400/v1/shape/news/1/body.webp"></p>'),
        ShapeUpPost(author_id=author.id, title="결과물", summary="", cohort="1기", team_name="가팀",
                    is_published=True, cover_image=f"{base}/v1/shape/shapeup/1/cover.webp"),
    ])
    await session.commit()

    used = await referenced(session)
    assert "shape/equipment/1/gear" in used
    assert "shape/news/1/cover" in used
    # 본문 안의 사진도, 변환 지시가 붙어 있어도 알아본다.
    assert "shape/news/1/body" in used
    assert "shape/shapeup/1/cover" in used


async def test_reservation_photos_and_fresh_uploads_are_never_swept(session, monkeypatch):
    """예약 사진은 활동 기록이라 남기고, 방금 올라온 것은 아직 판단하지 않는다."""
    from app.services import media_sweep

    now = datetime.now(UTC)
    listed = [
        # 예약 사진 — 아무도 안 가리켜도 남긴다.
        {"public_id": "shape/reservation/u1/before", "bytes": 1000, "created_at": (now - timedelta(days=30)).isoformat()},
        # 방금 올라온 것 — 아직 저장을 안 눌렀을 수 있다.
        {"public_id": "shape/news/1/justnow", "bytes": 2000, "created_at": (now - timedelta(minutes=5)).isoformat()},
        # 오래됐고 아무도 안 쓴다 — 이것만 지운다.
        {"public_id": "shape/equipment/1/leftover", "bytes": 3000, "created_at": (now - timedelta(days=3)).isoformat()},
    ]

    async def fake_listed(_client, kind):
        return listed if kind == "image" else []

    monkeypatch.setattr(media_sweep, "_listed", fake_listed)
    found = await media_sweep.find(session, grace_hours=24)
    assert [item["public_id"] for item in found] == ["shape/equipment/1/leftover"]


async def test_a_referenced_photo_is_never_swept(session, monkeypatch):
    """쓰이고 있는 사진은 오래됐어도 건드리지 않는다."""
    from app.models import Equipment
    from app.services import media_sweep

    old = (datetime.now(UTC) - timedelta(days=90)).isoformat()
    session.add(Equipment(name="쓰는 장비", category="시험",
                          image_url="https://res.cloudinary.com/demo/image/upload/v1/shape/equipment/9/live.webp"))
    await session.commit()

    async def fake_listed(_client, kind):
        return [{"public_id": "shape/equipment/9/live", "bytes": 500, "created_at": old}] if kind == "image" else []

    monkeypatch.setattr(media_sweep, "_listed", fake_listed)
    assert await media_sweep.find(session, grace_hours=0) == []


async def test_the_sweep_does_not_run_on_the_first_request_after_a_restart():
    """찬 시작 직후에 정리까지 얹히지 않는다."""
    from app.services import media_sweep

    # 뜬 시각을 시작점으로 잡으므로, 방금 뜬 서버는 아직 때가 아니다.
    before = media_sweep._last_run
    media_sweep.maybe_sweep()
    assert media_sweep._last_run == before


async def test_reservation_alerts_are_only_swept_for_signed_in_members(client, session, monkeypatch):
    """예약 알림 확인은 회원 요청에만 얹는다.

    로그인하지 않은 방문과 검색 크롤러는 지금 Neon 을 아예 건드리지 않는다.
    거기에 3분마다 조회를 얹으면 공개 캐시로 아낀 것이 그대로 사라진다.
    """
    from app import middleware

    ran: list[int] = []

    async def fake_sweep():
        ran.append(1)

    monkeypatch.setattr(middleware, "_sweep_reservation_alerts", fake_sweep)
    monkeypatch.setattr(middleware, "_last_sweep", 0.0)

    # 손님이 공개 페이지를 봐도 확인하지 않는다.
    logout(client)
    await client.get("/api/v1/equipment")
    await asyncio.sleep(0)
    assert ran == []

    # 회원이 들어오면 확인한다.
    member = await make_user(session, "alertsweep@example.com")
    await login(client, member).get("/api/v1/notices")
    await asyncio.sleep(0)
    assert ran == [1]

    # 그리고 3분 안에는 다시 보지 않는다.
    await login(client, member).get("/api/v1/notices")
    await asyncio.sleep(0)
    assert ran == [1]
    logout(client)


async def test_member_only_paths_never_look_like_public_reads():
    """회원 전용 주소가 공개 캐시 허용 목록에 걸리지 않는다.

    `/roadmap` 을 앞머리로 열어 두면 `/roadmap/me`(본인 일정)까지 걸려들었다.
    로그인을 요구하는 창구라 새지는 않았지만, 공개 여부가 인증 하나에만 기대게
    된다. 허용 목록 자체가 맞아야 한다.
    """
    from app.middleware import public_read

    assert public_read("/api/v1/roadmap") is True
    assert public_read("/api/v1/roadmap/me") is False
    # 옆 창구들도 함께 지킨다.
    assert public_read("/api/v1/equipment") is True
    # 회원 전용인 장비 권한 조회는 하이픈이라 걸리지 않는다. `/equipment/` 를
    # 앞머리로 여는 것은 `/equipment/{id}/availability` 때문이므로, 앞으로
    # `/equipment/` 아래에 회원 전용 창구를 만들면 안 된다.
    assert public_read("/api/v1/equipment-permissions") is False
    assert public_read("/api/v1/equipment/abc/availability") is True
    assert public_read("/api/v1/notices") is False
    assert public_read("/api/v1/notifications") is False
    assert public_read("/api/v1/reservations/me") is False


async def test_errors_are_never_marked_publicly_cacheable(client):
    """오류 응답에 공유 캐시 표시가 붙지 않는다.

    쿠키 없이 회원 전용 주소를 두드리면 401 이 돌아오는데, 예전에는 그 401 이
    `public, s-maxage=3600` 을 달고 나갔다. 앞에 공유 캐시를 붙이는 순간 그
    401 이 한 시간 동안 모두에게 나간다.
    """
    from app import cache

    cache.clear()
    logout(client)
    for path in ("/api/v1/roadmap/me", "/api/v1/news/00000000-0000-0000-0000-000000000000"):
        response = await client.get(path)
        assert response.status_code != 200, path
        assert "public" not in (response.headers.get("Cache-Control") or ""), path
    assert cache.size() == 0


# ------------------------------------------------- 구글 캘린더 연동


def test_calendar_title_matches_the_shared_calendar_convention():
    """'휴머노이드 운용' 캘린더에 이미 쌓인 일정과 같은 모양이어야 한다.

    그 캘린더는 SHAPE 만 쓰는 것이 아니라 장비를 함께 쓰는 다른 분들도 봅니다.
    새로 올라가는 일정만 다르게 생기면 한 달력 안에 두 형식이 섞입니다.
    """
    from zoneinfo import ZoneInfo

    from app.services import google_calendar

    seoul = ZoneInfo("Asia/Seoul")
    starts = datetime(2026, 9, 1, 14, 30, tzinfo=seoul)
    ends = datetime(2026, 9, 1, 20, 0, tzinfo=seoul)
    assert google_calendar.title("장하람", "AI Worker", starts, ends) == "SHAPE: 장하람 AI WORKER 오후 2:30~8시"


@pytest.mark.parametrize(
    "start,end,expected",
    [
        # 정각이면 분을 적지 않는다.
        ((10, 0), (12, 0), "오전 10시~오후 12시"),
        # 오전·오후가 같으면 뒤쪽에서 되풀이하지 않는다.
        ((14, 30), (20, 0), "오후 2:30~8시"),
        ((9, 0), (11, 30), "오전 9시~11:30"),
        # 자정을 넘기면 날짜가 달라지므로 뒤쪽에도 오전·오후를 적는다.
        ((22, 0), (0, 30), "오후 10시~오전 12:30"),
    ],
)
def test_calendar_time_span_reads_like_a_person_wrote_it(start, end, expected):
    from zoneinfo import ZoneInfo

    from app.services import google_calendar

    seoul = ZoneInfo("Asia/Seoul")
    starts = datetime(2026, 9, 1, *start, tzinfo=seoul)
    ends = datetime(2026, 9, 1 if end[0] > start[0] else 2, *end, tzinfo=seoul)
    assert google_calendar.span(starts, ends) == expected


def test_calendar_event_id_is_derived_from_the_reservation():
    """일정 번호를 따로 저장하지 않고 예약 id 에서 계산해 낸다.

    새 컬럼이 필요 없고, '캘린더에는 만들었는데 번호를 저장하기 전에 죽는'
    어중간한 상태도 생기지 않는다. 구글은 0-9·a-v 만 받으므로 16진수를 쓴다.
    """
    from app.services import google_calendar

    identifier = google_calendar.event_id(UUID("432c0226-326f-6284-6894-8322d1207ea4"))
    assert identifier == "shape432c0226326f628468948322d1207ea4"
    assert set(identifier) <= set("0123456789abcdefghijklmnopqrstuv")


async def _reserve(client, session, equipment_name, member, officer):
    """예약 하나를 신청까지 해 두고 (예약 id, 시작, 끝) 을 돌려준다."""
    equipment = Equipment(name=equipment_name, category="양팔 로봇")
    session.add(equipment)
    await session.flush()
    unit = EquipmentUnit(equipment_id=equipment.id, label="1호기")
    session.add(unit)
    await session.commit()

    starts = (datetime.now(UTC) + timedelta(days=1)).replace(minute=30, second=0, microsecond=0)
    ends = starts + timedelta(hours=2)
    created = await login(client, member).post("/api/v1/reservations", json={
        "equipment_unit_id": str(unit.id),
        "starts_at": starts.isoformat(),
        "ends_at": ends.isoformat(),
        "note": "텔레오퍼레이션 시험",
    })
    assert created.status_code == 201
    return created.json()["id"], starts, ends


async def test_calendar_stays_quiet_without_credentials(client, session, monkeypatch):
    """열쇠가 없으면 승인·취소가 구글을 두드리지 않는다.

    로컬 개발과 이 시험이 남의 달력에 일정을 올리면 안 된다.
    """
    from app.services import google_calendar

    sent: list[str] = []
    monkeypatch.setattr(google_calendar, "_spawn", lambda what, action: sent.append(what))

    officer = await make_user(session, "cal-quiet-officer@snu.ac.kr", status=UserStatus.APPROVED, owner=True)
    member = await make_user(session, "cal-quiet-member@snu.ac.kr", status=UserStatus.APPROVED)
    reservation_id, _, _ = await _reserve(client, session, "AI Worker", member, officer)

    http = login(client, officer)
    assert (await http.post(f"/api/v1/admin/reservations/{reservation_id}/decision", json={"approve": True})).status_code == 200
    assert (await http.post(f"/api/v1/admin/reservations/{reservation_id}/cancel", json={"approve": False})).status_code == 200
    assert sent == []


async def test_approving_ai_worker_puts_it_on_the_shared_calendar(client, session, monkeypatch):
    """승인하면 캘린더에 올라가고, 취소하면 같은 일정이 지워진다.

    사람이 사이트와 캘린더 두 곳에 같은 일정을 적던 일을 없애는 것이 이 연동의
    목적이므로, 승인과 취소가 한 쌍으로 맞아떨어져야 합니다.
    """
    from app.services import google_calendar

    monkeypatch.setattr(google_calendar, "configured", lambda: True)
    queued: list = []
    monkeypatch.setattr(google_calendar, "_spawn", lambda what, action: queued.append((what, action)))
    put: list[dict] = []
    removed: list[str] = []
    monkeypatch.setattr(google_calendar, "_put", lambda body: put.append(body))
    monkeypatch.setattr(google_calendar, "_delete", lambda identifier: removed.append(identifier))

    officer = await make_user(session, "cal-officer@snu.ac.kr", status=UserStatus.APPROVED, owner=True)
    member = await make_user(session, "cal-member@snu.ac.kr", status=UserStatus.APPROVED)
    reservation_id, starts, ends = await _reserve(client, session, "AI Worker", member, officer)

    http = login(client, officer)
    assert (await http.post(f"/api/v1/admin/reservations/{reservation_id}/decision", json={"approve": True})).status_code == 200
    assert [what for what, _ in queued] == ["등록"]
    queued.pop()[1]()
    body = put[0]
    assert body["id"] == google_calendar.event_id(UUID(reservation_id))
    assert body["summary"] == google_calendar.title("cal-member", "AI Worker", starts, ends)
    assert "텔레오퍼레이션 시험" in body["description"]
    assert body["start"]["timeZone"] == "Asia/Seoul"

    assert (await http.post(f"/api/v1/admin/reservations/{reservation_id}/cancel", json={"approve": False})).status_code == 200
    assert [what for what, _ in queued] == ["삭제"]
    queued.pop()[1]()
    assert removed == [body["id"]]


async def test_other_equipment_stays_off_the_humanoid_calendar(client, session, monkeypatch):
    """'휴머노이드 운용' 캘린더는 그 이름대로만 씁니다.

    다른 장비까지 올리면 그 캘린더를 함께 보는 분들의 달력을 우리가 채웁니다.
    """
    from app.services import google_calendar

    monkeypatch.setattr(google_calendar, "configured", lambda: True)
    queued: list = []
    monkeypatch.setattr(google_calendar, "_spawn", lambda what, action: queued.append((what, action)))

    officer = await make_user(session, "cal-other-officer@snu.ac.kr", status=UserStatus.APPROVED, owner=True)
    member = await make_user(session, "cal-other-member@snu.ac.kr", status=UserStatus.APPROVED)
    reservation_id, _, _ = await _reserve(client, session, "OMY", member, officer)

    http = login(client, officer)
    assert (await http.post(f"/api/v1/admin/reservations/{reservation_id}/decision", json={"approve": True})).status_code == 200
    assert (await http.post(f"/api/v1/admin/reservations/{reservation_id}/cancel", json={"approve": False})).status_code == 200
    assert queued == []


# ------------------------------------------------------------------ 서버 사용량


async def test_only_the_owner_can_see_server_usage(client, session):
    """운영진이라도 owner 가 아니면 못 봅니다.

    이 창구가 돌려주는 것은 계정 사용량이고, 뒤에서 쓰는 것은 계정 열쇠입니다.
    분야별 운영진(소식·장비)에게까지 열 이유가 없습니다.
    """
    manager = await make_user(session, "gear2@example.com", permissions=["equipment:manage"])
    assert (await login(client, manager).get("/api/v1/admin/usage")).status_code == 403
    assert (await logout(client).get("/api/v1/admin/usage")).status_code == 401


async def test_server_usage_is_collected_once_and_then_held(client, session, monkeypatch):
    """탭을 여러 번 열어도 바깥으로 나가는 요청은 한 번입니다.

    이 화면을 보는 일이 사용량을 늘리면 안 되므로, 백엔드가 값을 들고 있습니다.
    '다시 모으기' 로만 그 한 번을 당깁니다.
    """
    from app.services import usage

    calls = []

    async def fake_snapshot():
        calls.append(1)
        return {"collectedAt": "2026-08-25T00:00:00+00:00", "services": [], "problems": {}}

    monkeypatch.setattr(usage, "snapshot", fake_snapshot)
    owner = await make_user(session, "owner-usage@example.com", owner=True)
    login(client, owner)

    first = await client.get("/api/v1/admin/usage")
    assert first.status_code == 200
    assert first.json()["cached"] is False

    second = await client.get("/api/v1/admin/usage")
    assert second.json()["cached"] is True
    assert len(calls) == 1, "들고 있는 값이 있는데 다시 모았습니다"

    forced = await client.get("/api/v1/admin/usage?refresh=true")
    assert forced.json()["cached"] is False
    assert len(calls) == 2


async def test_server_usage_never_opens_the_database_beyond_the_login_check(client, session, monkeypatch):
    """수집 자체는 데이터베이스를 건드리지 않습니다.

    Neon 무료 한도에서 가장 먼저 닳는 것이 '깨어 있는 시간' 이라, 사용량을 보는
    일이 데이터베이스를 깨우면 화면을 볼수록 한도가 줄어듭니다. 로그인 검사
    한 번(운영진이 관리자 화면을 여는 순간 어차피 일어나는 일) 말고는 열지
    않는지를 여기서 못 박습니다.
    """
    import inspect

    from app.services import usage

    # **진짜** 수집기의 서명을 먼저 본다. 아래에서 가짜로 바꾼 뒤에 보면
    # 가짜를 검사하게 되어 아무것도 못 막는다.
    assert not inspect.signature(usage.snapshot).parameters, (
        "수집기가 인자를 받기 시작했습니다. db 세션을 넘기게 되면 이 화면이 "
        "데이터베이스를 깨우게 되므로, 넘길 수 없는 모양을 유지하세요."
    )

    async def fake_snapshot():
        return {"collectedAt": "2026-08-25T00:00:00+00:00", "services": [], "problems": {}}

    monkeypatch.setattr(usage, "snapshot", fake_snapshot)
    owner = await make_user(session, "owner-usage2@example.com", owner=True)
    login(client, owner)
    assert (await client.get("/api/v1/admin/usage")).status_code == 200


# ------------------------------------------------------------------ 수정 내역


async def test_every_admin_write_is_recorded_with_who_and_what(client, session):
    """창구마다 부르지 않고 라우터 전체에 걸었으므로, 쓰기는 빠짐없이 남아야 한다."""
    from app.models import AuditLog

    owner = await make_user(session, "audit-owner@example.com", owner=True)
    login(client, owner)

    made = await client.post("/api/v1/admin/links", json={
        "title": "부원 드라이브", "url": "https://drive.example.com", "description": "", "is_published": True})
    assert made.status_code == 201

    rows = (await session.scalars(select(AuditLog))).all()
    assert len(rows) == 1
    row = rows[0]
    assert row.actor_id == owner.id
    assert row.actor_name == owner.name
    assert row.action == "create"
    assert row.area == "바로가기"
    assert row.target == "부원 드라이브"


async def test_a_deleted_item_keeps_its_name_in_the_record(client, session):
    """지우고 나면 이름을 알 수 없다. 지우기 **전에** 읽어 두는지 확인한다.

    이 시험이 이 기능의 핵심이다. 나중에 찾게 되는 기록이 바로 "누가 이걸 지웠나"
    인데, 이름이 없으면 그 기록이 쓸모없다.
    """
    from app.models import AuditLog

    owner = await make_user(session, "audit-owner2@example.com", owner=True)
    login(client, owner)
    made = await client.post("/api/v1/admin/links", json={
        "title": "지워질 링크", "url": "https://gone.example.com", "description": "", "is_published": True})
    link_id = made.json()["id"]

    assert (await client.delete(f"/api/v1/admin/links/{link_id}")).status_code == 204

    rows = (await session.scalars(select(AuditLog).order_by(AuditLog.created_at))).all()
    assert [row.action for row in rows] == ["create", "delete"]
    assert rows[1].target == "지워질 링크", "지운 것의 이름이 기록에 남지 않았습니다"


async def test_failed_and_read_only_requests_leave_no_record(client, session):
    """튕긴 요청과 읽기는 남기지 않는다.

    실패까지 남기면 "고쳤다" 는 기록과 실제 상태가 어긋나고, 권한이 없어 튕긴
    시도가 수정 내역에 섞여 읽는 사람을 헷갈리게 한다.
    """
    from app.models import AuditLog

    owner = await make_user(session, "audit-owner3@example.com", owner=True)
    login(client, owner)
    # 없는 링크를 고치려는 시도 (창구 안에서 404 로 튕긴다)
    missing = await client.patch(f"/api/v1/admin/links/{uuid4()}", json={
        "title": "없는 링크", "url": "https://none.example.com", "description": "", "is_published": True})
    assert missing.status_code == 404
    # 읽기
    assert (await client.get("/api/v1/admin/links")).status_code == 200
    assert (await session.scalars(select(AuditLog))).all() == []

    # 권한이 없는 사람의 시도 (403) 도 남지 않는다
    manager = await make_user(session, "audit-news@example.com", permissions=["news:manage"])
    login(client, manager)
    assert (await client.post("/api/v1/admin/links", json={
        "title": "몰래", "url": "https://x.example.com", "description": "", "is_published": True})).status_code == 403
    assert (await session.scalars(select(AuditLog))).all() == []


async def test_only_the_owner_can_read_the_record(client, session):
    owner = await make_user(session, "audit-owner4@example.com", owner=True)
    manager = await make_user(session, "audit-links@example.com", permissions=["links:manage"])
    assert (await login(client, manager).get("/api/v1/admin/audit")).status_code == 403
    page = await login(client, owner).get("/api/v1/admin/audit")
    assert page.status_code == 200
    assert page.json()["items"] == []


async def test_a_top_level_create_is_not_mistaken_for_a_sub_action(client, session):
    """`/licenses` 로 라이선스를 만드는 것과 `/users/{id}/licenses` 로 설정하는 것은 다르다.

    주소 꼬리만 보고 동작을 정하면 둘 다 '라이선스 설정' 이 되어, 만든 기록이
    사라진다. 조각이 하나뿐이면 방식으로 정해야 한다.
    """
    from app.models import AuditLog

    owner = await make_user(session, "audit-owner5@example.com", owner=True)
    login(client, owner)
    made = await client.post("/api/v1/admin/licenses", json={"name": "기초 교육", "description": ""})
    assert made.status_code == 201
    license_id = made.json()["id"]

    member = await make_user(session, "audit-member@example.com")
    assert (await client.put(f"/api/v1/admin/users/{member.id}/licenses",
                             json={"licenseIds": [license_id]})).status_code == 200

    rows = (await session.scalars(select(AuditLog).order_by(AuditLog.created_at))).all()
    assert [(row.action, row.area) for row in rows] == [
        ("create", "라이선스"),
        ("licenses", "회원"),
    ]
    # 회원에게 준 기록은 '누구에게' 가 이름 자리에 와야 읽힌다.
    assert rows[1].target == member.name


# ------------------------------------------------ 지금 칸·자동 확정·정기·통계


async def _machine(session, name="OMY", *, unit_minutes=60, units=1):
    """장비 하나와 호기를 만들어 (장비, 호기목록) 을 돌려준다."""
    equipment = Equipment(name=name, category="로봇 팔", reservation_unit_minutes=unit_minutes)
    session.add(equipment)
    await session.flush()
    made = [EquipmentUnit(equipment_id=equipment.id, label=f"{name} {index + 1}호기") for index in range(units)]
    session.add_all(made)
    await session.commit()
    return equipment, made


def _block_start(unit_minutes: int) -> datetime:
    """지금이 들어 있는 예약 칸의 시작 시각. 서버가 쓰는 계산과 같은 것을 쓴다."""
    from app.services.reservations import block_floor

    return block_floor(datetime.now(UTC), unit_minutes)


async def test_지금_돌고_있는_칸은_예약할_수_있다(client, session):
    """17시 14분에 17~18시 칸을 잡을 수 있어야 한다.

    예전에는 시작 시각이 조금이라도 지나면 막아서, 장비 앞에 서 있는 사람이 남은
    46분을 쓰지 못하고 다음 정각을 기다려야 했다.
    """
    member = await make_user(session, "member@example.com")
    _, (unit,) = await _machine(session, "OMY", unit_minutes=60)
    http = login(client, member)
    now_block = _block_start(60)

    running = await http.post("/api/v1/reservations", json={
        "equipmentUnitId": str(unit.id), "startsAt": now_block.isoformat(),
        "endsAt": (now_block + timedelta(hours=1)).isoformat(), "note": "지금 사용",
    })
    assert running.status_code == 201, running.text

    # 지금 칸보다 앞선 칸은 막는다. 지나간 시간을 소급해 기록으로 남기는 일이다.
    earlier = await http.post("/api/v1/reservations", json={
        "equipmentUnitId": str(unit.id), "startsAt": (now_block - timedelta(hours=1)).isoformat(),
        "endsAt": (now_block + timedelta(hours=1)).isoformat(), "note": "소급",
    })
    assert earlier.status_code == 422
    assert "지금 사용 중인 칸" in earlier.json()["detail"]

    # 이미 끝난 칸도 막는다. 쓸 시간이 남아 있지 않다.
    done = await http.post("/api/v1/reservations", json={
        "equipmentUnitId": str(unit.id), "startsAt": (now_block - timedelta(hours=2)).isoformat(),
        "endsAt": (now_block - timedelta(hours=1)).isoformat(), "note": "지난 시간",
    })
    assert done.status_code == 422
    assert "이미 지난 시간" in done.json()["detail"]


async def test_두_시간_단위_장비도_지금_칸부터_잡힌다(client, session):
    """예약 단위가 120분이면 '지금 칸' 도 두 시간짜리다."""
    member = await make_user(session, "member@example.com")
    _, (unit,) = await _machine(session, "AI Worker", unit_minutes=120)
    http = login(client, member)
    now_block = _block_start(120)
    created = await http.post("/api/v1/reservations", json={
        "equipmentUnitId": str(unit.id), "startsAt": now_block.isoformat(),
        "endsAt": (now_block + timedelta(hours=2)).isoformat(), "note": "긴 실험",
    })
    assert created.status_code == 201, created.text
    # 60분 단위였다면 허용됐을 30분 앞 칸은, 120분 장비에서는 같은 칸 안이라 통과한다.
    assert _block_start(120) <= _block_start(60)


async def test_이미_끝난_예약은_승인할_수_없다(client, session):
    """끝난 시간을 승인하면 지나간 칸이 영원히 잠기고 헛된 사진 요청이 나간다."""
    officer = await make_user(session, "officer@example.com", permissions=["reservations:manage"])
    member = await make_user(session, "member@example.com")
    _, (unit,) = await _machine(session, "레이저 커터")
    now = datetime.now(UTC).replace(minute=0, second=0, microsecond=0)
    stale = Reservation(equipment_unit_id=unit.id, user_id=member.id, note="지난 신청",
                        starts_at=now - timedelta(hours=3), ends_at=now - timedelta(hours=2))
    session.add(stale)
    await session.commit()

    http = login(client, officer)
    decided = await http.post(f"/api/v1/admin/reservations/{stale.id}/decision", json={"approve": True})
    assert decided.status_code == 409
    assert "이미 끝난 시간" in decided.json()["detail"]
    assert (await session.scalar(select(func.count()).select_from(ReservationSlot))) == 0


async def test_예약은_분류와_시급도와_기타_내용을_함께_남긴다(client, session):
    member = await make_user(session, "member@example.com")
    _, (unit,) = await _machine(session, "3D 프린터")
    starts = awaiting_half_hour()
    http = login(client, member)
    created = await http.post("/api/v1/reservations", json={
        "equipmentUnitId": str(unit.id), "startsAt": starts.isoformat(),
        "endsAt": (starts + timedelta(hours=1)).isoformat(),
        "purposeCategory": "CONTEST", "urgency": "HIGH", "note": "금요일이 대회 마감입니다.",
    })
    assert created.status_code == 201, created.text
    body = created.json()
    assert (body["purposeCategory"], body["urgency"]) == ("CONTEST", "HIGH")
    assert body["note"] == "금요일이 대회 마감입니다."

    # 고르지 않으면 '기타'·'보통'. 옛 신청에 없던 값을 지어내지 않기 위한 기본값이다.
    plain = await http.post("/api/v1/reservations", json={
        "equipmentUnitId": str(unit.id), "startsAt": (starts + timedelta(hours=2)).isoformat(),
        "endsAt": (starts + timedelta(hours=3)).isoformat(),
    })
    assert plain.status_code == 201, plain.text
    assert (plain.json()["purposeCategory"], plain.json()["urgency"], plain.json()["note"]) == ("OTHER", "NORMAL", "")


async def test_시작_시각의_초는_거절한다(client, session):
    """`17:00:30` 으로 시작하는 신청은 겹침 검사를 통째로 비껴 간다.

    슬롯이 `17:00:30`·`17:30:30` 으로 깔려 이미 있는 `17:00:00` 과 초가 다르므로,
    `uq_reservation_slot` 제약에도 걸리지 않고 같은 장비 같은 시간에 확정 예약이
    둘 생긴다.
    """
    member = await make_user(session, "member@example.com")
    _, (unit,) = await _machine(session, "OMY")
    starts = awaiting_half_hour()
    http = login(client, member)
    sneaky = await http.post("/api/v1/reservations", json={
        "equipmentUnitId": str(unit.id),
        "startsAt": starts.replace(second=30).isoformat(),
        "endsAt": (starts + timedelta(hours=1)).isoformat(), "note": "초를 섞은 신청",
    })
    assert sneaky.status_code == 422


async def test_대기_신청은_예약_가능_시간에_보인다(client, session):
    """같은 시간을 원하는 사람이 둘이라는 것이 신청하기 전에 보여야 한다."""
    officer = await make_user(session, "officer@example.com", permissions=["reservations:manage"])
    member = await make_user(session, "member@example.com")
    equipment, (unit,) = await _machine(session, "OMY")
    starts = awaiting_half_hour()
    created = await login(client, member).post("/api/v1/reservations", json={
        "equipmentUnitId": str(unit.id), "startsAt": starts.isoformat(),
        "endsAt": (starts + timedelta(hours=1)).isoformat(), "note": "데이터 수집",
    })
    assert created.status_code == 201, created.text

    day = starts.astimezone(ZoneInfo("Asia/Seoul")).date().isoformat()
    cache.clear()
    grid = (await logout(client).get(f"/api/v1/equipment/{equipment.id}/availability?date={day}")).json()
    marks = grid["units"][0]
    assert marks["reservedStarts"] == []
    assert len(marks["pendingStarts"]) == 2  # 한 시간 = 30분 칸 둘

    # 승인하면 대기에서 확정으로 옮겨 간다.
    assert (await login(client, officer).post(
        f"/api/v1/admin/reservations/{created.json()['id']}/decision", json={"approve": True})).status_code == 200
    cache.clear()
    grid = (await logout(client).get(f"/api/v1/equipment/{equipment.id}/availability?date={day}")).json()
    assert len(grid["units"][0]["reservedStarts"]) == 2
    assert grid["units"][0]["pendingStarts"] == []


async def test_예약_가능_시간은_누가_신청했는지_말하지_않는다(client, session):
    """이 응답은 공유 캐시를 탄다. 사람이 들어가면 남의 정보가 새어 나간다."""
    member = await make_user(session, "member@example.com")
    equipment, (unit,) = await _machine(session, "OMY")
    starts = awaiting_half_hour()
    await login(client, member).post("/api/v1/reservations", json={
        "equipmentUnitId": str(unit.id), "startsAt": starts.isoformat(),
        "endsAt": (starts + timedelta(hours=1)).isoformat(), "note": "데이터 수집",
    })
    day = starts.astimezone(ZoneInfo("Asia/Seoul")).date().isoformat()
    cache.clear()
    response = await logout(client).get(f"/api/v1/equipment/{equipment.id}/availability?date={day}")
    raw = json.dumps(response.json())
    assert str(member.id) not in raw
    assert member.email not in raw and member.name not in raw
    assert "s-maxage" in response.headers.get("cache-control", "")


async def test_지금_시작하는_칸을_신청하면_바로_확정된다(client, session):
    """장비 앞에 서서 지금 칸을 잡는 가장 흔한 경우. 운영진을 기다리지 않는다."""
    await make_user(session, "officer@example.com", owner=True)
    member = await make_user(session, "member@example.com")
    _, (unit,) = await _machine(session, "OMY", unit_minutes=60)
    now_block = _block_start(60)
    created = await login(client, member).post("/api/v1/reservations", json={
        "equipmentUnitId": str(unit.id), "startsAt": now_block.isoformat(),
        "endsAt": (now_block + timedelta(hours=1)).isoformat(), "note": "지금 사용",
    })
    assert created.status_code == 201, created.text
    assert created.json()["status"] == "APPROVED"
    assert created.json()["autoDecidedAt"] is not None
    assert (await session.scalar(select(func.count()).select_from(ReservationSlot))) == 2


async def test_겹친_신청은_저절로_확정되지_않는다(client, session):
    """자동으로 한쪽을 고르면 '늦게 누른 사람' 이 이기는 규칙이 된다."""
    await make_user(session, "officer@example.com", owner=True)
    first = await make_user(session, "first@example.com")
    second = await make_user(session, "second@example.com")
    _, (unit,) = await _machine(session, "OMY", unit_minutes=60)
    starts = _block_start(60) + timedelta(minutes=30)
    window = {"startsAt": starts.isoformat(), "endsAt": (starts + timedelta(minutes=30)).isoformat()}

    one = await login(client, first).post("/api/v1/reservations", json={"equipmentUnitId": str(unit.id), "note": "먼저", **window})
    assert one.status_code == 201, one.text
    assert one.json()["status"] == "APPROVED"  # 다투는 상대가 아직 없다

    # 확정된 칸과 겹치므로 두 번째는 신청 자체가 막힌다.
    two = await login(client, second).post("/api/v1/reservations", json={"equipmentUnitId": str(unit.id), "note": "나중", **window})
    assert two.status_code == 409


async def test_대기끼리_겹치면_아무것도_확정되지_않는다(client, session):
    """둘 다 아직 대기인 경우가 사람이 봐야 하는 유일한 경우다."""
    from app.services.reservation_sweeps import sweep_auto_decisions

    await make_user(session, "officer@example.com", owner=True)
    first = await make_user(session, "first@example.com")
    second = await make_user(session, "second@example.com")
    _, (unit,) = await _machine(session, "OMY", unit_minutes=60)
    starts = awaiting_half_hour()
    window = {"startsAt": starts.isoformat(), "endsAt": (starts + timedelta(hours=1)).isoformat()}
    one = await login(client, first).post("/api/v1/reservations", json={"equipmentUnitId": str(unit.id), "note": "먼저", **window})
    two = await login(client, second).post("/api/v1/reservations", json={"equipmentUnitId": str(unit.id), "note": "나중", **window})
    assert (one.status_code, two.status_code) == (201, 201)
    assert {one.json()["status"], two.json()["status"]} == {"PENDING"}

    # 시각을 자동 확정 창 안으로 끌어당겨도 겹침 때문에 그대로 대기다.
    await session.execute(
        update(Reservation).values(starts_at=datetime.now(UTC) + timedelta(minutes=20),
                                   ends_at=datetime.now(UTC) + timedelta(minutes=80))
    )
    await session.commit()
    assert await sweep_auto_decisions(session) == []
    rows = (await session.scalars(select(Reservation))).all()
    assert {row.status for row in rows} == {ReservationStatus.PENDING}


async def test_충돌이_없는_신청은_한_시간_전에_저절로_확정된다(client, session):
    from app.services.reservation_sweeps import sweep_auto_decisions

    await make_user(session, "officer@example.com", owner=True)
    member = await make_user(session, "member@example.com")
    _, (unit,) = await _machine(session, "OMY")
    starts = awaiting_half_hour()
    created = await login(client, member).post("/api/v1/reservations", json={
        "equipmentUnitId": str(unit.id), "startsAt": starts.isoformat(),
        "endsAt": (starts + timedelta(hours=1)).isoformat(), "note": "실험",
    })
    assert created.json()["status"] == "PENDING"

    reservation = await session.get(Reservation, UUID(created.json()["id"]))
    reservation.starts_at = datetime.now(UTC) + timedelta(minutes=20)
    reservation.ends_at = datetime.now(UTC) + timedelta(minutes=80)
    await session.commit()

    alerts = await sweep_auto_decisions(session)
    assert any("자동으로 확정" in title for title, _, _ in alerts)
    await session.refresh(reservation)
    assert reservation.status == ReservationStatus.APPROVED
    assert reservation.auto_decided_at is not None
    # 두 번째 훑기는 할 일이 없다.
    assert await sweep_auto_decisions(session) == []


async def test_시간이_지난_대기_신청은_만료된다(client, session):
    from app.services.reservation_sweeps import sweep_auto_decisions

    member = await make_user(session, "member@example.com")
    _, (unit,) = await _machine(session, "OMY")
    now = datetime.now(UTC)
    forgotten = Reservation(equipment_unit_id=unit.id, user_id=member.id, note="잊힌 신청",
                            starts_at=now - timedelta(hours=3), ends_at=now - timedelta(hours=2))
    session.add(forgotten)
    await session.commit()

    alerts = await sweep_auto_decisions(session)
    assert any("만료" in title for title, _, _ in alerts)
    await session.refresh(forgotten)
    assert forgotten.status == ReservationStatus.EXPIRED
    assert (await login(client, member).get("/api/v1/notifications")).json()[0]["title"].startswith("신청한 시간이 지나")
    assert await sweep_auto_decisions(session) == []


async def test_운영진은_두_시간_전에_한_번_더_듣는다(client, session):
    from app.services.reservation_alerts import sweep_due

    officer = await make_user(session, "officer@example.com", owner=True)
    member = await make_user(session, "member@example.com")
    _, (unit,) = await _machine(session, "OMY")
    now = datetime.now(UTC)
    waiting = Reservation(equipment_unit_id=unit.id, user_id=member.id, note="대기 중",
                          starts_at=now + timedelta(minutes=90), ends_at=now + timedelta(minutes=150),
                          created_at=now - timedelta(days=1))
    session.add(waiting)
    await session.commit()

    alerts = await sweep_due(session)
    assert any("아직 승인하지 않은" in title for title, _, _ in alerts)
    assert any("자동으로 확정됩니다" in body for _, body, _ in alerts)
    assert (await login(client, officer).get("/api/v1/notifications")).json()[0]["title"].startswith("아직 승인하지 않은")
    # 두 번 울리지 않는다.
    assert not any("아직 승인하지 않은" in title for title, _, _ in await sweep_due(session))


async def test_처음부터_임박해_들어온_신청은_독촉하지_않는다(client, session):
    """접수 알림이 이미 독촉이었다. 같은 말을 두 번 하지 않는다."""
    from app.services.reservation_alerts import sweep_due

    await make_user(session, "officer@example.com", owner=True)
    member = await make_user(session, "member@example.com")
    _, (unit,) = await _machine(session, "OMY")
    now = datetime.now(UTC)
    fresh = Reservation(equipment_unit_id=unit.id, user_id=member.id, note="방금 신청",
                        starts_at=now + timedelta(minutes=90), ends_at=now + timedelta(minutes=150),
                        created_at=now)
    session.add(fresh)
    await session.commit()
    assert not any("아직 승인하지 않은" in title for title, _, _ in await sweep_due(session))


async def test_알림_훑기는_스스로_아무것도_결정하지_않는다(client, session):
    """`sweep_due` 는 알림만 만든다. 상태를 바꾸는 것은 `sweep_auto_decisions` 다."""
    from app.services.reservation_alerts import sweep_due

    await make_user(session, "officer@example.com", owner=True)
    member = await make_user(session, "member@example.com")
    _, (unit,) = await _machine(session, "OMY")
    now = datetime.now(UTC)
    rows = [
        Reservation(equipment_unit_id=unit.id, user_id=member.id, note="곧 시작",
                    starts_at=now + timedelta(minutes=20), ends_at=now + timedelta(minutes=80),
                    created_at=now - timedelta(days=1)),
        Reservation(equipment_unit_id=unit.id, user_id=member.id, note="이미 지남",
                    starts_at=now - timedelta(hours=3), ends_at=now - timedelta(hours=2)),
    ]
    session.add_all(rows)
    await session.commit()
    await sweep_due(session)
    for row in rows:
        await session.refresh(row)
        assert row.status == ReservationStatus.PENDING


async def test_겹친_두_대기_신청은_서로를_가리킨다(client, session):
    officer = await make_user(session, "officer@example.com", permissions=["reservations:manage"])
    first = await make_user(session, "first@example.com")
    second = await make_user(session, "second@example.com")
    _, units = await _machine(session, "OMY", units=2)
    starts = awaiting_half_hour()
    window = {"startsAt": starts.isoformat(), "endsAt": (starts + timedelta(hours=1)).isoformat()}
    await login(client, first).post("/api/v1/reservations", json={"equipmentUnitId": str(units[0].id), "note": "먼저", **window})
    await login(client, second).post("/api/v1/reservations", json={"equipmentUnitId": str(units[0].id), "note": "나중", **window})
    # 같은 시간이지만 다른 호기라 다투지 않는다.
    await login(client, first).post("/api/v1/reservations", json={"equipmentUnitId": str(units[1].id), "note": "옆 호기", **window})

    rows = (await login(client, officer).get("/api/v1/admin/reservations?status=PENDING")).json()
    by_note = {row["note"]: row for row in rows}
    assert by_note["먼저"]["conflictsWith"] == [by_note["나중"]["id"]]
    assert by_note["나중"]["conflictsWith"] == [by_note["먼저"]["id"]]
    assert by_note["옆 호기"]["conflictsWith"] == []


async def test_관리자_목록은_시급도와_신청순으로_정렬된다(client, session):
    """`HIGH, LOW, NORMAL` 은 알파벳 순이라 '낮음' 이 '보통' 위로 올라온다."""
    officer = await make_user(session, "officer@example.com", permissions=["reservations:manage"])
    member = await make_user(session, "member@example.com")
    _, units = await _machine(session, "OMY", units=3)
    starts = awaiting_half_hour()
    http = login(client, member)
    for unit, urgency, category in zip(units, ("LOW", "HIGH", "NORMAL"), ("OTHER", "CONTEST", "EDUCATION"), strict=True):
        assert (await http.post("/api/v1/reservations", json={
            "equipmentUnitId": str(unit.id), "startsAt": starts.isoformat(),
            "endsAt": (starts + timedelta(hours=1)).isoformat(),
            "urgency": urgency, "purposeCategory": category, "note": urgency,
        })).status_code == 201

    http = login(client, officer)
    ordered = (await http.get("/api/v1/admin/reservations?status=PENDING&sort=urgency")).json()
    assert [row["urgency"] for row in ordered] == ["HIGH", "NORMAL", "LOW"]

    # 신청 시각은 같은 초에 몰려 있으면 순서가 정해지지 않는다. 실제 상황처럼
    # 벌려 두고 확인한다.
    base = datetime.now(UTC) - timedelta(hours=3)
    for offset, note in enumerate(("LOW", "HIGH", "NORMAL")):
        await session.execute(update(Reservation).where(Reservation.note == note)
                              .values(created_at=base + timedelta(minutes=offset * 10)))
    await session.commit()
    by_created = (await http.get("/api/v1/admin/reservations?status=PENDING&sort=created")).json()
    assert [row["note"] for row in by_created] == ["NORMAL", "HIGH", "LOW"]

    only_urgent = (await http.get("/api/v1/admin/reservations?status=PENDING&urgency=HIGH")).json()
    assert [row["note"] for row in only_urgent] == ["HIGH"]
    assert (await http.get("/api/v1/admin/reservations?status=PENDING&category=CONTEST")).json()[0]["note"] == "HIGH"


async def test_추천_순서는_이유를_함께_보여_준다(client, session):
    """근거를 못 보여 주는 점수는 운영진이 믿을 수도 반박할 수도 없다."""
    officer = await make_user(session, "officer@example.com", permissions=["reservations:manage"])
    member = await make_user(session, "member@example.com")
    _, units = await _machine(session, "OMY", units=2)
    starts = awaiting_half_hour()
    http = login(client, member)
    await http.post("/api/v1/reservations", json={
        "equipmentUnitId": str(units[0].id), "startsAt": starts.isoformat(),
        "endsAt": (starts + timedelta(hours=1)).isoformat(),
        "urgency": "LOW", "purposeCategory": "OTHER", "note": "느긋함"})
    await http.post("/api/v1/reservations", json={
        "equipmentUnitId": str(units[1].id), "startsAt": starts.isoformat(),
        "endsAt": (starts + timedelta(hours=1)).isoformat(),
        "urgency": "HIGH", "purposeCategory": "CONTEST", "note": "대회 마감"})

    rows = (await login(client, officer).get("/api/v1/admin/reservations?status=PENDING&sort=priority")).json()
    assert [row["note"] for row in rows] == ["대회 마감", "느긋함"]
    assert rows[0]["priority"] == 70
    assert "매우 시급 +40" in rows[0]["priorityReasons"]
    assert "대회 +30" in rows[0]["priorityReasons"]


async def test_사용을_일찍_마치면_남은_시간이_풀린다(client, session):
    """예전에는 17~19시를 잡고 17시 10분에 끝내도 19시까지 아무도 못 썼다."""
    member = await make_user(session, "member@example.com")
    other = await make_user(session, "other@example.com")
    _, (unit,) = await _machine(session, "OMY", unit_minutes=60)
    now_block = _block_start(60)
    created = await login(client, member).post("/api/v1/reservations", json={
        "equipmentUnitId": str(unit.id), "startsAt": now_block.isoformat(),
        "endsAt": (now_block + timedelta(hours=4)).isoformat(), "note": "긴 실험",
    })
    assert created.status_code == 201, created.text
    reservation_id = created.json()["id"]

    http = login(client, member)
    assert (await http.post(f"/api/v1/reservations/{reservation_id}/before", json={"photoUrl": "https://x/before.webp"})).status_code == 200
    done = await http.post(f"/api/v1/reservations/{reservation_id}/after",
                           json={"photoUrl": "https://x/after.webp", "releaseRemaining": True})
    assert done.status_code == 200, done.text
    assert datetime.fromisoformat(done.json()["endsAt"]) < now_block + timedelta(hours=4)

    # 반납한 시간은 다른 사람이 곧바로 쓸 수 있다.
    later = now_block + timedelta(hours=2)
    taken = await login(client, other).post("/api/v1/reservations", json={
        "equipmentUnitId": str(unit.id), "startsAt": later.isoformat(),
        "endsAt": (later + timedelta(hours=1)).isoformat(), "note": "이어서 사용",
    })
    assert taken.status_code == 201, taken.text


async def test_반납하지_않으면_끝_시각이_그대로다(client, session):
    member = await make_user(session, "member@example.com")
    _, (unit,) = await _machine(session, "OMY", unit_minutes=60)
    now_block = _block_start(60)
    ends = now_block + timedelta(hours=4)
    created = await login(client, member).post("/api/v1/reservations", json={
        "equipmentUnitId": str(unit.id), "startsAt": now_block.isoformat(),
        "endsAt": ends.isoformat(), "note": "긴 실험",
    })
    reservation_id = created.json()["id"]
    http = login(client, member)
    await http.post(f"/api/v1/reservations/{reservation_id}/before", json={"photoUrl": "https://x/b.webp"})
    done = await http.post(f"/api/v1/reservations/{reservation_id}/after", json={"photoUrl": "https://x/a.webp"})
    assert datetime.fromisoformat(done.json()["endsAt"]) == ends


async def test_정기_예약은_요일마다_한_번에_잡힌다(client, session):
    """교육 트랙은 화·수·목이 학기 내내 고정이다."""
    officer = await make_user(session, "officer@example.com", permissions=["reservations:manage"])
    mate = await make_user(session, "mate@example.com")
    _, (unit,) = await _machine(session, "OMY")
    seoul = ZoneInfo("Asia/Seoul")
    start_day = (datetime.now(seoul) + timedelta(days=1)).date()
    http = login(client, officer)
    created = await http.post("/api/v1/admin/reservations/recurring", json={
        "equipmentUnitId": str(unit.id),
        "weekdays": [start_day.weekday()],
        "startTime": "18:00", "endTime": "20:00",
        "fromDate": start_day.isoformat(),
        "untilDate": (start_day + timedelta(days=21)).isoformat(),
        "purposeCategory": "EDUCATION", "note": "교육 트랙",
        "companionIds": [str(mate.id)],
    })
    assert created.status_code == 201, created.text
    body = created.json()
    assert len(body["created"]) == 4  # 4주치
    assert all(row["status"] == "APPROVED" for row in body["created"])
    assert body["created"][0]["companions"] == ["mate"]

    groups = (await http.get("/api/v1/admin/reservations/recurring")).json()
    assert groups[0]["total"] == 4
    assert groups[0]["startTime"] == "18:00"
    assert groups[0]["weekdays"] == [start_day.weekday()]

    # 겹치는 주는 건너뛰고 알려 준다. 학기 전체를 실패시키지 않는다.
    again = await http.post("/api/v1/admin/reservations/recurring", json={
        "equipmentUnitId": str(unit.id),
        "weekdays": [start_day.weekday()],
        "startTime": "18:00", "endTime": "20:00",
        "fromDate": start_day.isoformat(),
        "untilDate": (start_day + timedelta(days=21)).isoformat(),
    })
    assert again.status_code == 201, again.text
    assert again.json()["created"] == []
    assert len(again.json()["skipped"]) == 4
    assert again.json()["skipped"][0]["reason"] == "이미 확정된 예약이 있습니다."


async def test_정기_예약_해제는_앞으로_것만_물린다(client, session):
    """이미 지나간 것은 실제로 있었던 사용 기록이라 그대로 둔다."""
    officer = await make_user(session, "officer@example.com", permissions=["reservations:manage"])
    _, (unit,) = await _machine(session, "OMY")
    seoul = ZoneInfo("Asia/Seoul")
    start_day = (datetime.now(seoul) + timedelta(days=1)).date()
    http = login(client, officer)
    created = await http.post("/api/v1/admin/reservations/recurring", json={
        "equipmentUnitId": str(unit.id), "weekdays": [start_day.weekday()],
        "startTime": "18:00", "endTime": "20:00",
        "fromDate": start_day.isoformat(), "untilDate": (start_day + timedelta(days=14)).isoformat(),
    })
    group_id = created.json()["groupId"]
    # 첫 건을 과거로 옮겨 '이미 지난 것' 으로 만든다.
    oldest = (await session.scalars(select(Reservation).order_by(Reservation.starts_at))).first()
    oldest.starts_at = datetime.now(UTC) - timedelta(days=2)
    oldest.ends_at = datetime.now(UTC) - timedelta(days=2) + timedelta(hours=2)
    await session.commit()

    removed = await http.delete(f"/api/v1/admin/reservations/recurring/{group_id}")
    assert removed.status_code == 200
    assert removed.json()["cancelled"] == 2
    await session.refresh(oldest)
    assert oldest.status == ReservationStatus.APPROVED


async def test_정기_예약은_한_번에_서른_건까지만(client, session):
    officer = await make_user(session, "officer@example.com", permissions=["reservations:manage"])
    _, (unit,) = await _machine(session, "OMY")
    seoul = ZoneInfo("Asia/Seoul")
    start_day = (datetime.now(seoul) + timedelta(days=1)).date()
    body = {
        "equipmentUnitId": str(unit.id), "weekdays": [0, 1, 2, 3, 4],
        "startTime": "18:00", "endTime": "20:00",
        "fromDate": start_day.isoformat(), "untilDate": (start_day + timedelta(days=120)).isoformat(),
    }
    refused = await login(client, officer).post("/api/v1/admin/reservations/recurring", json=body)
    assert refused.status_code == 422
    assert "30건" in refused.json()["detail"]


async def test_사용_통계는_기간_안의_예약만_센다(client, session):
    officer = await make_user(session, "officer@example.com", permissions=["reservations:manage"])
    member = await make_user(session, "member@example.com")
    _, (unit,) = await _machine(session, "OMY")
    seoul = ZoneInfo("Asia/Seoul")
    today = datetime.now(seoul).date()
    # 정각에 맞춰 둔다. 히트맵은 예약이 걸쳐 있는 매 시간을 한 칸씩 채우므로,
    # 10시 37분에 시작하는 두 시간짜리는 10·11·12시 세 칸을 건드린다.
    now = datetime.now(UTC).replace(minute=0, second=0, microsecond=0)
    session.add_all([
        Reservation(equipment_unit_id=unit.id, user_id=member.id, note="안에 있음",
                    starts_at=now - timedelta(hours=3), ends_at=now - timedelta(hours=1),
                    status=ReservationStatus.COMPLETED, purpose_category=ReservationPurpose.CONTEST),
        Reservation(equipment_unit_id=unit.id, user_id=member.id, note="아주 예전",
                    starts_at=now - timedelta(days=90), ends_at=now - timedelta(days=90) + timedelta(hours=2),
                    status=ReservationStatus.COMPLETED),
    ])
    await session.commit()

    http = login(client, officer)
    window = f"from={(today - timedelta(days=1)).isoformat()}&to={(today + timedelta(days=1)).isoformat()}"
    stats = (await http.get(f"/api/v1/admin/reservations/stats?{window}")).json()
    assert stats["totalCount"] == 1
    assert stats["totalHours"] == 2.0
    assert stats["equipment"][0]["label"] == "OMY"
    assert stats["purposes"][0]["label"] == "대회"
    assert sum(sum(row) for row in stats["heatmap"]) == 2


async def test_사용_통계는_자동_확정과_사람_승인을_나눈다(client, session):
    officer = await make_user(session, "officer@example.com", permissions=["reservations:manage"])
    member = await make_user(session, "member@example.com")
    _, (unit,) = await _machine(session, "OMY")
    seoul = ZoneInfo("Asia/Seoul")
    today = datetime.now(seoul).date()
    now = datetime.now(UTC)
    session.add_all([
        Reservation(equipment_unit_id=unit.id, user_id=member.id, note="시계가 확정",
                    starts_at=now - timedelta(hours=3), ends_at=now - timedelta(hours=2),
                    status=ReservationStatus.COMPLETED, auto_decided_at=now),
        Reservation(equipment_unit_id=unit.id, user_id=member.id, note="사람이 확정",
                    starts_at=now - timedelta(hours=2), ends_at=now - timedelta(hours=1),
                    status=ReservationStatus.COMPLETED),
    ])
    await session.commit()
    window = f"from={(today - timedelta(days=1)).isoformat()}&to={(today + timedelta(days=1)).isoformat()}"
    stats = (await login(client, officer).get(f"/api/v1/admin/reservations/stats?{window}")).json()
    assert {row["label"]: row["count"] for row in stats["decisions"]} == {"자동 확정": 1, "운영진 승인": 1}


async def test_사용_통계는_권한과_기간을_따진다(client, session):
    officer = await make_user(session, "officer@example.com", permissions=["reservations:manage"])
    member = await make_user(session, "member@example.com")
    today = datetime.now(ZoneInfo("Asia/Seoul")).date()
    assert (await login(client, member).get(
        f"/api/v1/admin/reservations/stats?from={today.isoformat()}&to={today.isoformat()}")).status_code == 403
    too_long = await login(client, officer).get(
        f"/api/v1/admin/reservations/stats?from={(today - timedelta(days=400)).isoformat()}&to={today.isoformat()}")
    assert too_long.status_code == 422
    assert "366일" in too_long.json()["detail"]


# ---------------------------------------------------------------- 사용 제한(블록아웃)


SEOUL_TZ = ZoneInfo("Asia/Seoul")


async def make_gear(session, *, units=("1호기",), name="OMY", minutes=60):
    """장비 하나와 호기 몇 개. 사용 제한 시험이 매번 되풀이하던 준비다."""
    equipment = Equipment(name=name, category="로봇 팔", reservation_unit_minutes=minutes)
    session.add(equipment)
    await session.flush()
    rows = [EquipmentUnit(equipment_id=equipment.id, label=f"{name} {label}") for label in units]
    session.add_all(rows)
    await session.commit()
    return equipment, rows


def blackout_body(equipment, *, unit=None, weekday=None, start="00:00", end="24:00", day=None, cancel=False):
    """오늘(한국 시각)을 기본으로 하는 사용 제한 입력."""
    day = day or datetime.now(SEOUL_TZ).date()
    return {
        "equipmentId": str(equipment.id),
        "equipmentUnitId": str(unit.id) if unit else None,
        "reason": "정기 점검",
        "weekdays": [weekday if weekday is not None else day.weekday()],
        "startTime": start,
        "endTime": end,
        "fromDate": day.isoformat(),
        "untilDate": day.isoformat(),
        "cancelConflicts": cancel,
    }


async def test_막아_둔_시간에는_예약할_수_없다(client, session):
    officer = await make_user(session, "officer@example.com", permissions=["reservations:manage"])
    member = await make_user(session, "member@example.com")
    equipment, (unit,) = await make_gear(session)

    starts = awaiting_half_hour()
    day = starts.astimezone(SEOUL_TZ).date()
    body = blackout_body(equipment, day=day)
    assert (await login(client, officer).post("/api/v1/admin/blackouts", json=body)).status_code == 201

    refused = await login(client, member).post("/api/v1/reservations", json={
        "equipmentUnitId": str(unit.id),
        "startsAt": starts.isoformat(),
        "endsAt": (starts + timedelta(hours=1)).isoformat(),
    })
    assert refused.status_code == 409
    assert "정기 점검" in refused.json()["detail"]
    assert await session.scalar(select(func.count()).select_from(Reservation)) == 0


async def test_사용_제한은_고른_호기에만_걸린다(client, session):
    officer = await make_user(session, "officer@example.com", permissions=["reservations:manage"])
    member = await make_user(session, "member@example.com")
    equipment, (first, second) = await make_gear(session, units=("1호기", "2호기"))

    starts = awaiting_half_hour()
    day = starts.astimezone(SEOUL_TZ).date()
    assert (await login(client, officer).post(
        "/api/v1/admin/blackouts", json=blackout_body(equipment, unit=first, day=day))).status_code == 201

    http = login(client, member)
    payload = {"startsAt": starts.isoformat(), "endsAt": (starts + timedelta(hours=1)).isoformat()}
    assert (await http.post("/api/v1/reservations", json={**payload, "equipmentUnitId": str(first.id)})).status_code == 409
    # 2호기는 막히지 않았다. 장비 전체를 점검 중으로 돌리던 예전 방식과 다른 점이다.
    assert (await http.post("/api/v1/reservations", json={**payload, "equipmentUnitId": str(second.id)})).status_code == 201


async def test_사용_제한은_확정된_예약을_미리_보여_주고_함께_취소한다(client, session):
    officer = await make_user(session, "officer@example.com", permissions=["reservations:manage"])
    member = await make_user(session, "member@example.com")
    equipment, (unit,) = await make_gear(session)

    starts = awaiting_half_hour()
    day = starts.astimezone(SEOUL_TZ).date()
    booked = (await login(client, member).post("/api/v1/reservations", json={
        "equipmentUnitId": str(unit.id),
        "startsAt": starts.isoformat(),
        "endsAt": (starts + timedelta(hours=1)).isoformat(),
    })).json()
    http = login(client, officer)
    assert (await http.post(f"/api/v1/admin/reservations/{booked['id']}/decision", json={"approve": True})).status_code == 200

    body = blackout_body(equipment, day=day)
    preview = (await http.post("/api/v1/admin/blackouts/preview", json=body)).json()
    assert [row["userName"] for row in preview["clashes"]] == ["member"]
    assert preview["days"] == 1

    # 미리보기를 보지 않은 호출은 거절한다. 남의 확정 예약이 조용히 사라지면 안 된다.
    refused = await http.post("/api/v1/admin/blackouts", json=body)
    assert refused.status_code == 409 and "1건" in refused.json()["detail"]

    created = await http.post("/api/v1/admin/blackouts", json={**body, "cancelConflicts": True})
    assert created.status_code == 201, created.text
    row = await session.get(Reservation, UUID(booked["id"]))
    await session.refresh(row)
    assert row.status == ReservationStatus.CANCELLED
    # 시간이 실제로 풀렸는지. 확정 슬롯이 남아 있으면 막은 뒤에도 그 칸이 잠긴다.
    assert await session.scalar(select(func.count()).select_from(ReservationSlot)) == 0
    told = (await login(client, member).get("/api/v1/notifications")).json()
    assert any("취소" in item["title"] for item in told)


async def test_사용_제한은_예약_가능_시간에_막힌_칸으로_보인다(client, session):
    officer = await make_user(session, "officer@example.com", permissions=["reservations:manage"])
    equipment, (unit,) = await make_gear(session)
    day = (datetime.now(SEOUL_TZ) + timedelta(days=1)).date()
    assert (await login(client, officer).post("/api/v1/admin/blackouts", json=blackout_body(
        equipment, day=day, start="19:00", end="21:00"))).status_code == 201

    cache.clear()
    view = (await logout(client).get(f"/api/v1/equipment/{equipment.id}/availability?date={day.isoformat()}")).json()
    blocked = view["units"][0]["blockedStarts"]
    # 19:00~21:00 은 30분 칸 넷이다. 화면은 확정된 칸과 같은 모양으로 받아 잠근다.
    assert len(blocked) == 4
    assert blocked[0].startswith(f"{day.isoformat()}T19:00")
    assert view["blockedReasons"] == ["정기 점검"]


async def test_사용_제한은_예약_관리_권한을_요구한다(client, session):
    member = await make_user(session, "member@example.com")
    equipment, _ = await make_gear(session)
    http = login(client, member)
    assert (await http.get("/api/v1/admin/blackouts")).status_code == 403
    assert (await http.post("/api/v1/admin/blackouts", json=blackout_body(equipment))).status_code == 403


async def test_정기_예약은_막힌_날을_건너뛴다(client, session):
    officer = await make_user(session, "officer@example.com", permissions=["reservations:manage"])
    equipment, (unit,) = await make_gear(session)
    day = (datetime.now(SEOUL_TZ) + timedelta(days=1)).date()
    http = login(client, officer)
    assert (await http.post("/api/v1/admin/blackouts", json=blackout_body(
        equipment, day=day, start="19:00", end="21:00"))).status_code == 201

    made = await http.post("/api/v1/admin/reservations/recurring", json={
        "equipmentUnitId": str(unit.id),
        "weekdays": [day.weekday()],
        "startTime": "19:00", "endTime": "21:00",
        "fromDate": day.isoformat(), "untilDate": day.isoformat(),
    })
    assert made.status_code == 201, made.text
    result = made.json()
    assert result["created"] == []
    assert "사용 제한" in result["skipped"][0]["reason"]


# ------------------------------------------------------------------- 예약 정책


POLICY = {
    "autoApproveMinutes": 60, "staffReminderMinutes": 120, "startGraceMinutes": 10,
    "beforePhotoGraceMinutes": 30, "maxHours": 12, "bookingWindowDays": 180, "recurringMax": 30,
}


async def test_예약_정책을_바꾸면_상한이_따라_바뀐다(client, session):
    officer = await make_user(session, "officer@example.com", permissions=["reservations:manage"])
    member = await make_user(session, "member@example.com")
    _, (unit,) = await make_gear(session)

    http = login(client, officer)
    assert (await http.get("/api/v1/admin/reservation-policy")).json()["bookingWindowDays"] == 180
    saved = await http.put("/api/v1/admin/reservation-policy", json={**POLICY, "bookingWindowDays": 14, "maxHours": 2})
    assert saved.status_code == 200, saved.text

    starts = next_half_hour() + timedelta(days=20)
    refused = await login(client, member).post("/api/v1/reservations", json={
        "equipmentUnitId": str(unit.id),
        "startsAt": starts.isoformat(),
        "endsAt": (starts + timedelta(hours=1)).isoformat(),
    })
    assert refused.status_code == 422 and "14일" in refused.json()["detail"]

    near = awaiting_half_hour()
    too_long = await login(client, member).post("/api/v1/reservations", json={
        "equipmentUnitId": str(unit.id),
        "startsAt": near.isoformat(),
        "endsAt": (near + timedelta(hours=3)).isoformat(),
    })
    assert too_long.status_code == 422 and "2시간" in too_long.json()["detail"]


async def test_자동_확정_시점은_정책을_따른다(client, session):
    officer = await make_user(session, "officer@example.com", permissions=["reservations:manage"])
    member = await make_user(session, "member@example.com")
    _, (unit,) = await make_gear(session)

    # 0분으로 두면 시작하기 전에는 아무것도 저절로 확정되지 않는다.
    assert (await login(client, officer).put(
        "/api/v1/admin/reservation-policy", json={**POLICY, "autoApproveMinutes": 0})).status_code == 200
    starts = next_half_hour()
    made = (await login(client, member).post("/api/v1/reservations", json={
        "equipmentUnitId": str(unit.id),
        "startsAt": starts.isoformat(),
        "endsAt": (starts + timedelta(hours=1)).isoformat(),
    })).json()
    assert made["status"] == "PENDING"

    # 넉넉히 늘리면 같은 신청이 그 자리에서 확정된다.
    assert (await login(client, officer).put(
        "/api/v1/admin/reservation-policy", json={**POLICY, "autoApproveMinutes": 60 * 24 * 7})).status_code == 200
    later = awaiting_half_hour() + timedelta(days=2)
    second = (await login(client, member).post("/api/v1/reservations", json={
        "equipmentUnitId": str(unit.id),
        "startsAt": later.isoformat(),
        "endsAt": (later + timedelta(hours=1)).isoformat(),
    })).json()
    assert second["status"] == "APPROVED"


async def test_예약_정책은_누구나_읽되_운영진만_고친다(client, session):
    member = await make_user(session, "member@example.com")
    # 규칙 값만 실리므로 로그인 없이도 읽힌다. 화면이 안내를 정확한 시각으로 적는 데 쓴다.
    public = await logout(client).get("/api/v1/reservation-policy")
    assert public.status_code == 200
    assert public.json()["autoApproveMinutes"] == 60
    assert set(public.json()) == {"autoApproveMinutes", "startGraceMinutes", "maxHours", "bookingWindowDays"}
    assert public_read("/api/v1/reservation-policy") is True
    # 값이 바뀌면 부원 화면의 안내가 통째로 옛말이 되므로 짧은 캐시에 둔다.
    assert "s-maxage=30" in public.headers.get("cache-control", "")
    assert (await login(client, member).put("/api/v1/admin/reservation-policy", json=POLICY)).status_code == 403


# -------------------------------------------------------------- 확정 예정 시각 안내


async def test_대기_신청은_언제_확정되는지_알려_준다(client, session):
    member = await make_user(session, "member@example.com")
    rival = await make_user(session, "rival@example.com")
    _, (unit,) = await make_gear(session)
    starts = awaiting_half_hour()
    payload = {
        "equipmentUnitId": str(unit.id),
        "startsAt": starts.isoformat(),
        "endsAt": (starts + timedelta(hours=1)).isoformat(),
    }
    mine = (await login(client, member).post("/api/v1/reservations", json=payload)).json()
    assert mine["contested"] is False
    # 기본 정책은 한 시간 전이다. 규칙이 아니라 **내 신청의 시각**을 돌려준다.
    assert datetime.fromisoformat(mine["autoConfirmAt"]) == starts - timedelta(hours=1)

    assert (await login(client, rival).post("/api/v1/reservations", json=payload)).status_code == 201
    listed = (await login(client, member).get("/api/v1/reservations/me")).json()
    assert listed[0]["contested"] is True
    # 겹치면 사람이 고른다. 시각을 비워 두어야 화면이 "저절로 확정됩니다" 라고 하지 않는다.
    assert listed[0]["autoConfirmAt"] is None


# ------------------------------------------------------------- 라이선스 일괄 부여


async def test_라이선스를_여러_명에게_한_번에_부여한다(client, session):
    manager = await make_user(session, "gear@example.com", permissions=["equipment:manage"])
    first = await make_user(session, "one@example.com")
    second = await make_user(session, "two@example.com")
    third = await make_user(session, "three@example.com")
    licence = License(name="OMY 운용 교육")
    session.add(licence)
    await session.commit()

    http = login(client, manager)
    assert (await http.get(f"/api/v1/admin/licenses/{licence.id}/members")).json()["userIds"] == []
    result = await http.put(f"/api/v1/admin/licenses/{licence.id}/members",
                            json={"userIds": [str(first.id), str(second.id)]})
    assert result.status_code == 200, result.text
    assert result.json() == {"granted": 2, "revoked": 0, "total": 2}
    assert (await login(client, first).get("/api/v1/notifications")).json()[0]["title"].startswith("OMY 운용 교육")

    # 목록을 통째로 맞추므로 빠진 사람은 회수되고 새로 든 사람은 부여된다.
    again = await login(client, manager).put(f"/api/v1/admin/licenses/{licence.id}/members",
                                             json={"userIds": [str(first.id), str(third.id)]})
    assert again.json() == {"granted": 1, "revoked": 1, "total": 2}
    holders = set((await session.scalars(select(UserLicense.user_id).where(UserLicense.license_id == licence.id))).all())
    assert holders == {first.id, third.id}


async def test_라이선스_일괄_부여는_없는_회원을_거절한다(client, session):
    manager = await make_user(session, "gear@example.com", permissions=["equipment:manage"])
    member = await make_user(session, "member@example.com")
    licence = License(name="카메라 이용 교육")
    session.add(licence)
    await session.commit()
    http = login(client, manager)
    refused = await http.put(f"/api/v1/admin/licenses/{licence.id}/members", json={"userIds": [str(uuid4())]})
    assert refused.status_code == 422
    assert (await login(client, member).put(
        f"/api/v1/admin/licenses/{licence.id}/members", json={"userIds": []})).status_code == 403


# -------------------------------------------------------------------- 내 사용 기록


async def test_내_사용_기록은_내_예약만_센다(client, session):
    member = await make_user(session, "member@example.com")
    other = await make_user(session, "other@example.com")
    _, (unit,) = await make_gear(session)
    now = datetime.now(UTC)
    session.add_all([
        Reservation(equipment_unit_id=unit.id, user_id=member.id, starts_at=now - timedelta(hours=3),
                    ends_at=now - timedelta(hours=1), status=ReservationStatus.COMPLETED,
                    purpose_category=ReservationPurpose.CONTEST, after_photo_url="https://x/after.jpg"),
        # 끝났는데 사용 후 사진이 없는 예약. 본인이 볼 수 있어야 챙긴다.
        Reservation(equipment_unit_id=unit.id, user_id=member.id, starts_at=now - timedelta(hours=6),
                    ends_at=now - timedelta(hours=5), status=ReservationStatus.IN_USE),
        Reservation(equipment_unit_id=unit.id, user_id=member.id, starts_at=now + timedelta(days=1),
                    ends_at=now + timedelta(days=1, hours=1), status=ReservationStatus.APPROVED),
        # 남의 예약은 한 건도 섞이지 않아야 한다.
        Reservation(equipment_unit_id=unit.id, user_id=other.id, starts_at=now - timedelta(hours=9),
                    ends_at=now - timedelta(hours=8), status=ReservationStatus.COMPLETED),
    ])
    await session.commit()

    mine = (await login(client, member).get("/api/v1/reservations/summary")).json()
    assert mine["totalCount"] == 3
    assert mine["completedCount"] == 1
    assert mine["totalHours"] == 2.0
    assert mine["upcomingCount"] == 1
    assert mine["missingPhotoCount"] == 1
    assert [row["label"] for row in mine["purposes"]] == ["대회"]
    assert mine["equipment"][0]["hours"] == 2.0


async def test_예약_정책_변경은_무엇이_바뀌었는지_남는다(client, session):
    """설정 변경은 나중에 "언제부터 규칙이 달라졌지" 를 되짚게 되는 자리다.

    이 주소에는 식별자가 없어 자동으로는 이름을 찾을 수 없으므로(`services/audit.py`),
    창구가 직접 이름과 바뀐 값을 담는다.
    """
    from app.models import AuditLog

    officer = await make_user(session, "officer@example.com", permissions=["reservations:manage"])
    http = login(client, officer)
    # 먼저 한 번 읽어 설정 행을 만든다. 만들기까지 기록에 섞이지 않게 하기 위함이다.
    assert (await http.get("/api/v1/admin/reservation-policy")).status_code == 200
    assert (await http.put("/api/v1/admin/reservation-policy",
                           json={**POLICY, "autoApproveMinutes": 90, "maxHours": 8})).status_code == 200

    row = (await session.scalars(select(AuditLog).where(AuditLog.area == "예약 정책"))).all()[-1]
    assert row.target == "예약 정책"
    assert "자동 확정 60→90" in row.detail
    assert "한 건 최대 12→8" in row.detail


async def test_라이선스_일괄_부여는_어느_교육인지_남는다(client, session):
    """누구에게 주었는지는 한 줄에 담을 수 없다. 이름 자리에는 교육이 와야 읽힌다."""
    from app.models import AuditLog

    manager = await make_user(session, "gear@example.com", permissions=["equipment:manage"])
    member = await make_user(session, "member@example.com")
    licence = License(name="OMY 운용 교육")
    session.add(licence)
    await session.commit()
    assert (await login(client, manager).put(
        f"/api/v1/admin/licenses/{licence.id}/members", json={"userIds": [str(member.id)]})).status_code == 200

    row = (await session.scalars(select(AuditLog))).all()[-1]
    assert row.area == "라이선스"
    assert row.action == "members"
    assert row.target == "OMY 운용 교육"


async def test_예약_현황_달력은_막아_둔_시간도_알려_준다(client, session):
    """달력에 없으면 부원이 빈 칸을 보고 예약 화면까지 갔다가 거기서야 막힌 것을 안다."""
    officer = await make_user(session, "officer@example.com", permissions=["reservations:manage"])
    equipment, _ = await make_gear(session, units=("1호기", "2호기"))
    day = (datetime.now(SEOUL_TZ) + timedelta(days=1)).date()
    assert (await login(client, officer).post("/api/v1/admin/blackouts", json=blackout_body(
        equipment, day=day, start="19:00", end="22:00"))).status_code == 201

    cache.clear()
    # 로그인 없이도 열린다. 장비·시각·사유뿐이라 누구의 정보도 실리지 않는다.
    rows = (await logout(client).get(f"/api/v1/equipment/blackouts?month={day.strftime('%Y-%m')}")).json()
    assert len(rows) == 1
    assert rows[0]["reason"] == "정기 점검"
    assert rows[0]["equipmentName"] == "OMY"
    # 호기를 고르지 않았으므로 장비 전체가 막힌 것이고, 호기 이름은 비어 있다.
    assert rows[0]["unitLabel"] == ""
    # 예약 항목과 같은 기준(UTC)으로 나갑니다. 달력은 브라우저에서 한국 시각으로 읽습니다.
    seoul = datetime.fromisoformat(rows[0]["startsAt"].replace("Z", "+00:00")).astimezone(SEOUL_TZ)
    assert (seoul.date(), seoul.strftime("%H:%M")) == (day, "19:00")

    other = (await logout(client).get("/api/v1/equipment/blackouts?month=2020-01")).json()
    assert other == []


async def test_달력의_막힌_시간은_요일마다_펼쳐진다(client, session):
    """요일 규칙을 화면이 다시 펴게 하면 같은 계산이 두 곳에 생긴다."""
    officer = await make_user(session, "officer@example.com", permissions=["reservations:manage"])
    equipment, _ = await make_gear(session)
    today = datetime.now(SEOUL_TZ).date()
    first = today.replace(day=1)
    last_day = (first + timedelta(days=32)).replace(day=1) - timedelta(days=1)
    body = blackout_body(equipment, day=first)
    body.update(weekdays=[2], fromDate=first.isoformat(), untilDate=last_day.isoformat(),
                startTime="19:00", endTime="21:00")
    assert (await login(client, officer).post("/api/v1/admin/blackouts", json=body)).status_code == 201

    cache.clear()
    rows = (await logout(client).get(f"/api/v1/equipment/blackouts?month={first.strftime('%Y-%m')}")).json()
    wednesdays = sum(1 for offset in range((last_day - first).days + 1)
                     if (first + timedelta(days=offset)).weekday() == 2)
    assert len(rows) == wednesdays
    def at(value: str) -> str:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(SEOUL_TZ).strftime("%H:%M")

    assert all(at(row["startsAt"]) == "19:00" and at(row["endsAt"]) == "21:00" for row in rows)
    assert all(datetime.fromisoformat(row["startsAt"].replace("Z", "+00:00")).astimezone(SEOUL_TZ).weekday() == 2
               for row in rows)


# ── 문의 (2-3) ────────────────────────────────────────────────────────────────

CONTACT = {"name": "김서울", "replyTo": "seoul@snu.ac.kr", "subject": "가입 문의",
           "message": "2학기 모집이 언제인지 궁금합니다."}


async def test_문의는_로그인_없이_보내고_관리자만_읽는다(client, session):
    """`mailto:` 는 메일 앱이 없는 기기에서 아무 일도 하지 않았다. 표에 담는다."""
    sent = await logout(client).post("/api/v1/contact", json=CONTACT)
    assert sent.status_code == 201, sent.text

    # 아무나 읽을 수 있으면 안 된다. 회신 이메일과 문의 내용이 들어 있다.
    assert (await logout(client).get("/api/v1/admin/contact")).status_code == 401
    member = await make_user(session, "member@example.com")
    assert (await login(client, member).get("/api/v1/admin/contact")).status_code == 403

    staff = await make_user(session, "staff@example.com", permissions=["contact:manage"])
    page = (await login(client, staff).get("/api/v1/admin/contact")).json()
    assert page["unread"] == 1
    assert page["items"][0]["subject"] == "가입 문의"
    assert page["items"][0]["replyTo"] == "seoul@snu.ac.kr"
    assert page["items"][0]["isRead"] is False


async def test_문의는_운영진에게_알림을_보내지_않는다(client, session):
    """예약 알림에 섞이면 묻힌다. 관리자 화면의 문의 탭에서만 본다."""
    owner = await make_user(session, "owner@example.com", owner=True)
    assert (await logout(client).post("/api/v1/contact", json=CONTACT)).status_code == 201
    assert (await login(client, owner).get("/api/v1/notifications")).json() == []


async def test_사람이_안_보는_칸이_채워지면_담지_않는다(client, session):
    """자동 프로그램은 폼의 모든 칸을 채운다. 막혔다고 알려 주지는 않는다."""
    spam = {**CONTACT, "website": "http://spam.example"}
    assert (await logout(client).post("/api/v1/contact", json=spam)).status_code == 201
    staff = await make_user(session, "staff@example.com", permissions=["contact:manage"])
    assert (await login(client, staff).get("/api/v1/admin/contact")).json()["items"] == []


async def test_문의는_읽음과_답변_완료를_따로_센다(client, session):
    """읽었다고 사라지면 '읽었지만 아직 답을 못 한 것' 이 묻힌다."""
    staff = await make_user(session, "staff@example.com", permissions=["contact:manage"])
    assert (await logout(client).post("/api/v1/contact", json=CONTACT)).status_code == 201
    http = login(client, staff)
    row = (await http.get("/api/v1/admin/contact")).json()["items"][0]

    read = await http.patch(f"/api/v1/admin/contact/{row['id']}", json={"isRead": True})
    assert read.status_code == 200 and read.json()["isRead"] is True and read.json()["handledAt"] is None
    assert (await http.get("/api/v1/admin/contact")).json()["unread"] == 0

    done = await http.patch(f"/api/v1/admin/contact/{row['id']}", json={"handled": True})
    assert done.json()["handledAt"] is not None

    assert (await http.delete(f"/api/v1/admin/contact/{row['id']}")).status_code == 204
    assert (await http.get("/api/v1/admin/contact")).json()["items"] == []

    # 수정 내역에 사람이 읽을 수 있는 이름으로 남는다. 지운 뒤에는 이름을 알아낼
    # 길이 없으므로 창구가 지우기 전에 담아 둔다.
    owner = await make_user(session, "owner@example.com", owner=True)
    log = (await login(client, owner).get("/api/v1/admin/audit")).json()["items"]
    ours = [entry for entry in log if entry["area"] == "문의"]
    assert ours, log
    assert all("가입 문의" in entry["target"] for entry in ours)
    assert {entry["action"] for entry in ours} == {"update", "delete"}


async def test_회신_이메일이_없으면_문의를_받지_않는다(client):
    """답을 보낼 곳이 없는 문의는 받아 봐야 쓸 데가 없다."""
    assert (await logout(client).post("/api/v1/contact", json={**CONTACT, "replyTo": "없음"})).status_code == 422
    assert (await logout(client).post("/api/v1/contact", json={**CONTACT, "message": "   "})).status_code == 422


# ── 알림 세기 (3-7) ──────────────────────────────────────────────────────────

async def test_안_읽은_알림은_한_쪽이_아니라_전체를_센다(client, session):
    """예전에는 앞의 50건만 받아 그 안에서 세어 51건째부터 영영 50이라고 말했다."""
    from app.models import Notification

    member = await make_user(session, "many@example.com")
    # **일부러 시각을 모두 같게 둔다.** 공지 하나를 올리면 회원 전원의 알림이
    # 한 트랜잭션에서 만들어져 `now()` 가 같은 값이 된다. 시각만으로 이어받으면
    # 그 경계의 알림이 통째로 사라진다.
    #
    # `func.now()` 에 맡기지 않고 값을 박아 넣는 이유: SQLite 의
    # `CURRENT_TIMESTAMP` 는 초 단위 문자열('… 04:04:25')로 저장되는데 파이썬
    # datetime 은 소수점까지('… 04:04:25.000000') 묶여, 글자 비교에서 저장된
    # 쪽이 언제나 작아진다. 그러면 거르개가 통째로 무시되어 **동점 상황을 아예
    # 시험하지 못한다.** 운영 Postgres 에는 없는 현상이므로 시험이 그 함정에
    # 빠지지 않게 양쪽 모양을 맞춘다.
    same_moment = datetime.now(UTC) - timedelta(minutes=5)
    session.add_all([
        Notification(user_id=member.id, title=f"알림 {index}", created_at=same_moment, updated_at=same_moment)
        for index in range(60)
    ])
    await session.commit()

    http = login(client, member)
    assert (await http.get("/api/v1/notifications/unread")).json()["unread"] == 60
    first = (await http.get("/api/v1/notifications")).json()
    assert len(first) == 50
    older = (await http.get(
        f"/api/v1/notifications?before={first[-1]['createdAt']}&beforeId={first[-1]['id']}")).json()
    assert len(older) == 10
    assert not ({row["id"] for row in first} & {row["id"] for row in older})
    # 두 쪽을 합치면 하나도 빠지지 않는다.
    assert len({row["id"] for row in first} | {row["id"] for row in older}) == 60

    await http.post("/api/v1/notifications/read")
    assert (await http.get("/api/v1/notifications/unread")).json()["unread"] == 0


# ── 게시판 분류·검색 (2-4) ───────────────────────────────────────────────────

async def test_게시판_분류는_서버가_거른다(client, session):
    """화면에서 거르면 최근 30건 안에 없는 옛 질문 글을 영영 못 찾는다."""
    from app.models import Notice

    member = await make_user(session, "board@example.com")
    now = datetime.now(UTC)
    session.add_all([
        Notice(title="로봇팔 캘리브레이션 물어봅니다", category="질문", is_published=True,
               published_at=now - timedelta(days=400)),
        Notice(title="이번 주 세미나 자료", category="정보", is_published=True, published_at=now),
    ])
    await session.commit()

    http = login(client, member)
    only = (await http.get("/api/v1/notices?category=질문")).json()
    assert [row["title"] for row in only] == ["로봇팔 캘리브레이션 물어봅니다"]
    # 분류 이름은 제목 검색에 섞이지 않는다. '정보' 분류 글이 있어도 제목에
    # 그 말이 없으면 안 나온다.
    assert (await http.get("/api/v1/notices?q=정보")).json() == []
    assert [row["title"] for row in (await http.get("/api/v1/notices?q=세미나")).json()] == ["이번 주 세미나 자료"]
    # 없는 분류로 물으면 조용히 전체를 돌려주지 않는다.
    assert (await http.get("/api/v1/notices?category=없는분류")).status_code == 422


# ── 예약 목록 거르개 (3-4) ───────────────────────────────────────────────────

async def test_예약_목록은_사람과_기간과_장비로_좁힐_수_있다(client, session):
    """부원이 백 명이 되면 눈으로 못 찾는다."""
    officer = await make_user(session, "officer@example.com", permissions=["reservations:manage"])
    mine, _ = await make_gear(session, name="OMY")
    other, _ = await make_gear(session, name="AI Worker")
    seeker = await make_user(session, "seeker@example.com")
    stranger = await make_user(session, "stranger@example.com")

    tomorrow = (datetime.now(SEOUL_TZ) + timedelta(days=1)).replace(hour=14, minute=0, second=0, microsecond=0)
    async def book(user, equipment, when):
        unit = await session.scalar(select(EquipmentUnit).where(EquipmentUnit.equipment_id == equipment.id))
        body = {"equipmentUnitId": str(unit.id), "startsAt": when.astimezone(UTC).isoformat(),
                "endsAt": (when + timedelta(hours=1)).astimezone(UTC).isoformat(), "purposeCategory": "OTHER"}
        made = await login(client, user).post("/api/v1/reservations", json=body)
        assert made.status_code == 201, made.text

    await book(seeker, mine, tomorrow)
    await book(stranger, other, tomorrow + timedelta(days=3))

    http = login(client, officer)
    everything = (await http.get("/api/v1/admin/reservations?status=ALL")).json() if False else (await http.get("/api/v1/admin/reservations")).json()
    assert len(everything) == 2

    by_person = (await http.get("/api/v1/admin/reservations?q=seeker")).json()
    assert [row["userEmail"] for row in by_person] == ["seeker@example.com"]

    by_gear = (await http.get(f"/api/v1/admin/reservations?equipmentId={mine.id}")).json()
    assert [row["equipmentName"] for row in by_gear] == ["OMY"]

    # 기간은 서울 벽시계 날짜로 끊는다. 그 날 하루가 통째로 들어와야 한다.
    day = tomorrow.date().isoformat()
    same_day = (await http.get(f"/api/v1/admin/reservations?from={day}&to={day}")).json()
    assert [row["userEmail"] for row in same_day] == ["seeker@example.com"]
