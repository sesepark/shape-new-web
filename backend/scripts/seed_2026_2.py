"""2기(2026-2학기) 확정 정보를 운영 데이터베이스에 넣는다.

``seed_content.py`` 가 배포 직후 한 번 돌리는 초기 내용이라면, 이 스크립트는
2기 명단과 기획서가 확정된 뒤 그 내용을 실제 사이트에 반영하기 위한 것이다.
넣는 것은 다음 네 가지이고, 모두 아래 출처에서 그대로 옮긴 값이다.

* 부원 카드 — ``SHAPE 명단_2기.xlsx`` (명단 · 시트3 · 대회 인원)
* 언론보도 — 실제로 SHAPE 가 언급된 기사 3건. 제목과 날짜는 원문에서 확인했다.
* 로드맵 — ``SHAPE 2기 운영 계획서`` 와 ``SHAPE-UP 2026-2 기획안``
* 관련 링크 · 보유 장비 · 필수 교육 — 명단 파일 머리글과 기획안 7절 자원 목록

넣지 않은 것과 그 이유는 ``docs/architecture.md`` 의 "운영 데이터" 절에 적어 두었다.

    cd backend
    DATABASE_URL="<Neon pooled URL>" SESSION_SECRET="<Render 와 같은 값>" \
        .venv/bin/python scripts/seed_2026_2.py

부원 카드를 뺀 나머지는 이미 있는 값을 건너뛰므로 여러 번 돌려도 안전하다.
부원 카드만은 명단이 곧 정답이라 통째로 덮어쓴다. ``--dry-run`` 을 붙이면
무엇이 바뀔지만 출력하고 아무것도 쓰지 않는다.
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
    NewsPost,
    RelatedLink,
    RoadmapItem,
)

SEOUL = ZoneInfo("Asia/Seoul")


def at(year: int, month: int, day: int, hour: int = 0, minute: int = 0) -> datetime:
    return datetime(year, month, day, hour, minute, tzinfo=SEOUL)


def photo(name: str) -> str:
    """부원 사진은 우리 public 폴더에 있는 파일을 상대 경로로 가리킨다.

    옛 사이트의 절대 주소로 두면 이미지 최적화가 제 사이트에 HTTP 요청을 한 번
    더 보낸다. 파일 이름은 NFC 로 맞춰 둔다. macOS 에서 만든 NFD 이름은 리눅스에서
    다른 파일로 취급되어 404 가 난다.
    """
    return f"/figs/{name}.jpeg"


# --------------------------------------------------------------------- 부원 카드
#
# `역할` 은 명단의 운영진 표를, `팀` 은 시트3 의 배정을 따른다. 두 시트에 모두
# 없는 신입 정회원은 팀이 아직 정해지지 않았으므로 "미배정" 으로 둔다.
#
# 회원 구분은 다음 기준으로 넣었다.
#   정회원 — 전 인원 명단 또는 대회 인원에 이름이 있는 사람 (= 2기 활동자)
#   멤버   — 시트3(1기 팀 배정)에만 있고 2기 활동 명단 어디에도 없는 사람
#   알럼   — 이번 학기에는 두지 않는다. 알럼은 SHAPE-UP 1회 이상 이수자인데
#            첫 SHAPE-UP 이 2026-2 학기라 아직 이수자가 없다.
#   준회원 — 2기 모집(8/24~9/6)이 끝나고 합격자가 나온 뒤에 넣는다.
#
# 이메일·학번·연락처는 넣지 않는다. 부원 페이지는 로그인 없이 누구나 본다.
MEMBERS = [
    # 이름, 팀, 역할, 회원 구분, 사진 여부
    ("강채아", "회장", "정회원", True),
    ("전라온", "부회장", "정회원", True),
    ("황새봄", "총무", "정회원", True),
    ("장하람", "기획팀장", "정회원", True),
    ("최은서", "교육팀장", "정회원", False),
    ("오보람", "대회팀장", "정회원", False),
    ("박시연", "외부 컨택", "정회원", True),
    ("김하윤", "팀원", "정회원", False),
    ("이도현", "팀원", "정회원", True),
    ("조나윤", "팀원", "정회원", True),
    ("윤소율", "팀원", "정회원", False),
    ("임리원", "팀원", "정회원", False),
    ("한아윤", "팀원", "정회원", True),
    ("오유하", "팀원", "정회원", True),
    ("서서하", "팀원", "정회원", False),
    ("권온유", "팀원", "정회원", False),
    ("안가온", "팀원", "정회원", False),
    ("류루아", "팀원", "정회원", False),
    ("전한별", "팀원", "정회원", True),
    ("김지안", "팀원", "정회원", True),
    ("이예솔", "팀원", "정회원", True),
    ("박하진", "팀원", "정회원", True),
    ("최시온", "팀원", "정회원", True),
    ("강나래", "팀원", "정회원", True),
    ("조초아", "팀원", "정회원", True),
    ("장세아", "팀원", "정회원", False),
    ("임미르", "팀원", "정회원", False),
    ("한아라", "팀원", "정회원", False),
    ("서슬기", "팀원", "정회원", False),
    ("신하늬", "팀원", "정회원", False),
    ("권여울", "팀원", "정회원", True),
    ("황단하", "팀원", "정회원", True),
    ("안시하", "팀원", "정회원", True),
    ("송윤슬", "팀원", "정회원", True),
    ("정예린", "팀원", "멤버", True),
    ("신다인", "팀원", "멤버", True),
    ("송도하", "팀원", "멤버", False),
    ("정다올", "팀원", "멤버", False),
    ("윤유진", "팀원", "멤버", True),
    ("류이든", "팀원", "멤버", True),
]


def member_cards() -> list[dict]:
    cards = []
    for index, (name, role, membership, has_photo) in enumerate(MEMBERS, start=1):
        card = {
            "id": f"member-{index:02d}-{name}",
            "name": name,
            "role": role,
            "affiliation": "서울대학교",
            "membership": membership,
        }
        if has_photo:
            card["imageUrl"] = photo(name)
        cards.append(card)
    return cards


# --------------------------------------------------------------------- 언론보도
#
# 제목·날짜는 2026-08-24 에 원문에서 직접 확인한 값이다. 요약과 본문은 기사에
# 실린 내용만 옮겼고, 기사에 없는 사실은 넣지 않았다.
PRESS = [
    {
        "title": "인천 로보컵 참가 오보람 학생 “우승보다 값진 건 로봇 만드는 경험”",
        "summary": "SHAPE 대회팀장 오보람 학생이 로보컵 2026 인천 휴머노이드 챌린지에 참가한 이야기를 인천일보가 다뤘습니다.",
        "url": "https://www.incheonilbo.com/news/articleView.html?idxno=1327404",
        "published_at": at(2026, 7, 15, 19, 6),
        "html": (
            "<p>인천 송도컨벤시아에서 열린 <strong>로보컵(RoboCup) 2026 인천</strong>에 "
            "SHAPE 대회팀장 오보람 학생이 참가했습니다. 부품 선별과 운반, 순차 조립, "
            "휠 장착까지 제조 공정을 로봇이 수행하는 휴머노이드 챌린지 종목입니다.</p>"
            "<p>기사에서 오보람 학생은 직접 로봇을 만들고 문제를 해결하는 경험이 가장 큰 "
            "자산이라고 말했습니다. 대회 성적보다 실물 로봇을 굴려 보며 얻은 것과 국제 "
            "교류의 가치를 강조한 인터뷰입니다.</p>"
        ),
    },
    {
        "title": "“상상 속 로봇, 100시간 만에 실물로”… KAIST·서울대, 로봇 해커톤 개최",
        "summary": "SHAPE가 참여하는 학생 연합 로보틱어스가 국내 첫 학생 주도 피지컬 AI 로봇 해커톤을 열었습니다.",
        "url": "https://www.irobotnews.com/news/articleView.html?idxno=47752",
        "published_at": at(2026, 8, 4, 10, 28),
        "html": (
            "<p>서울대학교 로봇동아리 <strong>SHAPE·SIGMA</strong>와 KAIST 로봇동아리 MR이 "
            "함께 만든 학생 연합 단체 <strong>로보틱어스(RoboticUS)</strong>가 8월 3일부터 "
            "8일까지 제1회 로봇 해커톤을 열었습니다.</p>"
            "<p>두 대학에서 선발한 10개 팀 30명이 100시간 동안 아이디어부터 설계, 조립, "
            "프로그래밍까지 마쳐 실제로 움직이는 로봇을 완성하는 방식입니다. 국내 최초의 "
            "학생 주도형 피지컬 AI 로봇 해커톤입니다.</p>"
            "<p>마지막 날에는 일반 시민도 참여할 수 있는 공개 컨퍼런스와 발표회를 함께 "
            "열었습니다.</p>"
        ),
    },
    {
        "title": "경쟁이 아닌 협력… 제1회 로봇해커톤",
        "summary": "100시간의 해커톤이 끝났습니다. 전자신문이 협력이라는 운영 방식에 주목해 현장을 정리했습니다.",
        "url": "https://www.etnews.com/20260809000085",
        "published_at": at(2026, 8, 9, 14, 44),
        "html": (
            "<p>제1회 로봇 해커톤이 100시간의 일정을 마쳤습니다. 10개 팀 30명이 아기 요람, "
            "신발 정리, 고기 굽기처럼 실생활에서 마주치는 문제를 푸는 로봇을 만들었습니다.</p>"
            "<p>기사는 <strong>경쟁이 아니라 협력</strong>이라는 운영 방식에 주목했습니다. "
            "팀끼리 막힌 지점을 서로 알려 주며 진행했다는 점입니다. 최우수상은 아기의 표정을 "
            "읽어 다섯 가지 감정에 따라 열다섯 가지 동작으로 움직이는 요람 로봇 ‘토닥’"
            "(서울대 시그마 팀)이 받았습니다.</p>"
            "<p>로보틱어스는 서울대 로봇동아리 SHAPE·시그마·메로와 KAIST MR이 함께 만든 "
            "비영리 학생단체입니다.</p>"
        ),
    },
]


# ----------------------------------------------------------------------- 로드맵
#
# 모집·면접·발표·전체 OT 날짜는 2기 운영 계획서와 2기 모집글이 서로 달랐다.
# 운영진 확인 결과 **모집글이 맞다**. 아래 날짜는 모두 모집글을 따른 것이다.
ROADMAP = [
    ("2기 부원 모집", "SHAPE-UP", at(2026, 8, 24, 9), at(2026, 9, 6, 23),
     "동아리 소개제 주간을 포함해 2주간 2기 부원을 모집합니다. 정회원과 준회원을 구분해 지원을 받습니다."),
    ("동아리 소개제 부스 운영", "기타", at(2026, 9, 1, 10), at(2026, 9, 3, 18),
     "SO-ARM 101 실물 시연과 보유 플랫폼 영상으로 SHAPE를 소개합니다. 모집 폼 QR을 현장에서 함께 안내합니다."),
    ("2기 면접", "SHAPE-UP", at(2026, 9, 10, 9), at(2026, 9, 11, 23),
     "정회원과 준회원을 구분해 면접을 진행합니다. 기술 수준의 서열이 아니라 준비도, 자기주도성, 몰입도, 팀 적합성을 종합적으로 봅니다."),
    ("2기 합격자 발표", "SHAPE-UP", at(2026, 9, 12, 9), None,
     "서류와 면접 결과를 개별 안내합니다."),
    ("전체 OT", "SHAPE-UP", at(2026, 9, 15, 19), at(2026, 9, 15, 22),
     "정회원과 준회원 합동 오리엔테이션입니다. 회원 구분 없이 전원 참석합니다. 동아리 소개와 한 학기 운영 방식을 안내합니다."),
    ("교육 트랙 2026-2 (총 10회)", "교육", at(2026, 9, 17, 19), at(2027, 1, 31, 22),
     "준회원 대상 정규 교육입니다. 매주 목요일 19:00~22:00에 열리며, 시험 기간과 공휴일을 제외하고 총 10회로 구성합니다. "
     "로봇 기초와 하드웨어, AI 기초, 강화학습, 모방학습, 최신 주제와 Demo까지 5개 모듈로 이어집니다. "
     "출석과 필수 실습, 최종 Demo 참여를 마치면 정회원으로 전환됩니다."),
    ("SHAPE-UP OT — 주제 피칭과 팀 편성", "SHAPE-UP", at(2026, 9, 22, 19), at(2026, 9, 22, 22),
     "운영진이 예시 주제와 사용 가능한 자원을 공개하고, 희망자가 주제를 피칭한 뒤 팀 빌딩을 진행합니다. 이 자리에서 팀과 팀장을 확정합니다."),
    ("SHAPE-UP 2026-2 팀 프로젝트", "SHAPE-UP", at(2026, 9, 22, 19), at(2027, 1, 30, 18),
     "정회원이 7~10개 팀으로 나뉘어 한 학기 동안 자율 주제 프로젝트를 수행합니다. 격주 정기 미팅에서 발표와 리뷰를 교대로 맡고, Demo Day에서 결과물을 공개합니다."),
    ("정기 미팅 1 — 제안서 발표 및 확정", "SHAPE-UP", at(2026, 9, 29, 19), at(2026, 9, 29, 21),
     "팀별 제안서를 발표하고 운영진이 스코프와 자원 계획을 함께 조정합니다."),
    ("마트 챌린지 예선 제출", "대회", at(2026, 10, 1, 9), at(2026, 10, 31, 23),
     "2026 마트 환경 기반 휴머노이드 로봇 챌린지 예선 자료를 준비해 제출합니다."),
    ("정기 미팅 2 — 초기 진행 점검", "SHAPE-UP", at(2026, 10, 13, 19), at(2026, 10, 13, 21),
     "프로젝트 초기 진행 상황을 점검하고 막힌 지점을 공유합니다."),
    ("중간고사 휴식", "기타", at(2026, 10, 19), at(2026, 11, 1, 23),
     "정기 활동을 쉬어 갑니다. 장비 예약은 평소대로 가능합니다."),
    ("정기 미팅 3 — 프로젝트 재가동", "SHAPE-UP", at(2026, 11, 3, 19), at(2026, 11, 3, 21),
     "시험 기간 이후 프로젝트를 재가동하고 남은 기간에 맞춰 스코프를 조정합니다."),
    ("마트 챌린지 본선 (대구 EXCO)", "대회", at(2026, 11, 13, 9), at(2026, 11, 14, 18),
     "대구 EXCO에서 열리는 본선에 출전합니다. 로봇 운송과 현장 세팅 일정을 포함합니다."),
    ("정기 미팅 4 — Mid Check", "SHAPE-UP", at(2026, 11, 17, 19), at(2026, 11, 17, 22),
     "전 팀이 발표합니다. 최초 제안서 대비 현재 위치를 확인하는 중간 점검 자리입니다."),
    ("RoboCup@Home 1차 지원 제출", "대회", at(2026, 11, 20, 9), at(2026, 11, 30, 23),
     "Qualification Video와 Team Description Paper, 영문 팀 홈페이지를 포함한 1차 지원 자료를 제출합니다."),
    ("정기 미팅 5 — 최종 목표 점검", "SHAPE-UP", at(2026, 12, 1, 19), at(2026, 12, 1, 21),
     "학기 마무리를 앞두고 최종 산출물 목표를 확정합니다."),
    ("기말고사 휴식", "기타", at(2026, 12, 7), at(2026, 12, 20, 23),
     "정기 활동을 쉬어 갑니다."),
    ("정기 미팅 6 — 방학 계획 확정", "SHAPE-UP", at(2026, 12, 22, 19), at(2026, 12, 22, 21),
     "방학 중 자율 진행 계획과 개별 체크 일정을 확정합니다."),
    ("RoboCup@Home 예선 결과 발표", "대회", at(2026, 12, 21, 9), at(2026, 12, 31, 23),
     "1차 지원 결과가 12월 말에 발표됩니다. 정확한 날짜는 주최 측 공지에 따릅니다."),
    ("정기 미팅 7 — 방학 중간 점검", "SHAPE-UP", at(2027, 1, 12, 19), at(2027, 1, 12, 21),
     "방학 자율 진행 상황을 점검하고 발표 자료와 GitHub 정리 상태를 확인합니다."),
    ("SHAPE-UP 최종 제출 기간", "SHAPE-UP", at(2027, 1, 25), at(2027, 1, 29, 23),
     "GitHub Project Page, 발표 PPT, 프로젝트별 실제 결과물을 제출합니다."),
    ("Demo Day", "SHAPE-UP", at(2027, 1, 30, 13), at(2027, 1, 30, 18),
     "2기 활동의 마무리입니다. 팀별 발표와 질의응답을 각 7~8분으로 진행하며 정회원·준회원 전원이 참여합니다. Open Lab 형태를 지향합니다."),
    ("RoboCup@Home 국제대회 본선 (독일 뉘른베르크)", "대회", at(2027, 6, 17, 9), at(2027, 6, 21, 18),
     "국제대회 본선입니다. 인원 출장에 더해 로봇 국제 운송, 운송 케이스 제작, 통관과 보험이 수반됩니다."),
]


# ------------------------------------------------------------------- 관련 링크
#
# GitHub 와 인스타그램만 공개한다. 노션과 구글 드라이브는 주소만 알면 외부인도
# 열 수 있는 공유 링크라, 등록은 하되 공개 목록에는 내보내지 않는다.
LINKS = [
    ("SHAPE GitHub", "https://github.com/snu-shape",
     "SHAPE-UP 팀별 Project Page와 공개 코드가 모여 있습니다.", 1, True),
    ("SHAPE Instagram", "https://www.instagram.com/snu_shape",
     "활동 사진과 데모 영상을 짧게 공유합니다.", 2, True),
    ("SHAPE Notion", "https://www.notion.so/SHAPE-f3deea5dba4a83238d7801f86db258df",
     "운영 계획서와 회의록을 정리합니다. (내부 공유용 — 공개 목록에는 나오지 않습니다)", 3, False),
    ("SHAPE 구글 드라이브", "https://drive.google.com/drive/folders/1ILJuSxjEqvH1xSa6BsMsAWX7I7OqdUEN",
     "발표 자료와 교육 슬라이드를 보관합니다. (내부 공유용 — 공개 목록에는 나오지 않습니다)", 4, False),
]


# 예약 단위는 장비마다 다르면 화면마다 시간표가 달라져 헷갈린다. 모두 한 시간이다.
RESERVATION_UNIT_MINUTES = 60

# 홈 화면에 쓰는 3D 모델을 배경 없는 그림으로 뽑아 카드에 붙인다. 제조사 제품
# 사진을 가져다 쓰지 않는 이유는 저작권이 그쪽에 있기 때문이고, 실제로 이 그림이
# 사이트의 다른 화면과 결이 같아 더 깔끔하다. 모델이 없는 장비는 비워 둔다.
# 파일 이름 끝의 번호는 판 번호입니다. 이미지 최적화 결과를 1년 동안 들고
# 있으므로(next.config.ts 의 minimumCacheTTL), 사진을 다시 뽑을 때는 **파일 이름을
# 바꿔야** 합니다. 주소 뒤에 ?v= 를 붙이는 방법은 쓸 수 없습니다 — Next.js 이미지
# 최적화가 로컬 주소에 붙은 물음표를 받지 않습니다(400).
EQUIPMENT_IMAGES = {
    "AI Worker": "/equipment/ai-worker-2.png",
    "AI Sapiens": "/equipment/ai-sapiens-2.png",
    "OMY": "/equipment/omy-2.png",
    "LeRobot SO-ARM 101": "/equipment/so-arm101-2.png",
}


# ------------------------------------------------------------------- 보유 장비
#
# 대수는 SHAPE-UP 2026-2 기획안 7절 "현재 활용 가능 자원" 과 3차 운영진 회의록의
# "SO-ARM 101 2대" 를 따랐다. 로봇 손은 제조사가 서로 달라 따로 등록한다.
# 필수 교육은 장비 종류마다 하나씩 둔다.
EQUIPMENT = [
    {
        "name": "AI Worker", "category": "양팔 로봇 · Teleoperation", "sort": 1,
        "units": ["AI Worker 1호기"], "license": "AI Worker 운용 교육",
        "unit_minutes": RESERVATION_UNIT_MINUTES,
        "description": (
            "양팔 조작과 원격 조종(teleoperation) 데이터 수집을 위한 Physical AI 플랫폼입니다. "
            "SHAPE-UP과 대회, 대외 행사가 동시에 필요로 하는 자원이므로 SHAPE-UP 사용 계획을 "
            "먼저 확정하고 나머지 일정을 여기에 맞춥니다. SHAPE-UP 팀은 주 3~4시간 이상 사용을 "
            "보장받고, 평일 코어 타임에 최소 한 세션을 확보합니다."
        ),
    },
    {
        "name": "OMY", "category": "로봇 팔 · 조작 정책 실험", "sort": 2,
        "units": ["OMY 1호기", "OMY 2호기"], "license": "OMY 운용 교육",
        "unit_minutes": RESERVATION_UNIT_MINUTES,
        "description": (
            "조작 정책 실험과 데이터 수집에 사용하는 로봇 팔 2대입니다. 두 대를 연동한 "
            "리더–팔로워 구성으로 원격 조종 데이터를 모을 수 있습니다."
        ),
    },
    {
        "name": "LeRobot SO-ARM 101", "category": "교육용 로봇 팔", "sort": 3,
        "units": ["SO-ARM 101 1호기", "SO-ARM 101 2호기"], "license": "SO-ARM 101 운용 교육",
        "unit_minutes": RESERVATION_UNIT_MINUTES,
        "description": (
            "교육 트랙 실습에 사용하는 소형 로봇 팔 2대입니다. 모방학습의 데이터 수집부터 "
            "정책 학습과 평가까지 한 사이클을 짧게 돌려 볼 수 있어 초심자 실습에 적합합니다. "
            "목요일 저녁 교육 시간에는 조별 실습에 쓰이므로 그 시간대 개인 예약은 피해 주세요."
        ),
    },
    {
        "name": "RTX PRO 6000 워크스테이션", "category": "GPU · 시뮬레이션 및 학습", "sort": 4,
        "units": ["GPU 워크스테이션 1호기", "GPU 워크스테이션 2호기", "GPU 워크스테이션 3호기"],
        "license": "GPU 워크스테이션 이용 교육", "unit_minutes": RESERVATION_UNIT_MINUTES,
        "description": (
            "로봇 시뮬레이션과 정책 학습, 비전 모델 실험에 쓰는 GPU 워크스테이션 3대입니다. "
            "교육 트랙과 대회팀, SHAPE-UP이 함께 사용하므로 배분은 기획팀과 협의합니다. "
            "장시간 학습은 야간과 주말로 옮기면 주간 실험 수요와 충돌하지 않습니다."
        ),
    },
    {
        "name": "Tesollo Robot Hand", "category": "Dexterous Hand", "sort": 5,
        "units": ["Tesollo Hand 1호기"], "license": "Tesollo Hand 운용 교육",
        "unit_minutes": RESERVATION_UNIT_MINUTES,
        "description": (
            "정교한 파지와 손가락 조작 정책 연구를 위한 다관절 로봇 손입니다. 손가락 링크가 "
            "얇아 과도한 토크나 충돌에 취약하므로, 새 정책을 실물에 올리기 전에 시뮬레이션에서 "
            "동작 범위를 먼저 확인해 주세요."
        ),
    },
    {
        "name": "ROBOTIS Hand", "category": "Dexterous Hand", "sort": 6,
        "units": ["ROBOTIS Hand 1호기"], "license": "ROBOTIS Hand 운용 교육",
        "unit_minutes": RESERVATION_UNIT_MINUTES,
        "description": "파지와 조작 실험에 사용하는 로봇 손입니다. Tesollo Hand와는 별개 장비로 예약합니다.",
    },
    {
        "name": "LEAP Hand", "category": "Dexterous Hand", "sort": 7,
        "units": ["LEAP Hand 1호기"], "license": "LEAP Hand 운용 교육",
        "unit_minutes": RESERVATION_UNIT_MINUTES,
        "description": (
            "저비용 다지 로봇 손 플랫폼입니다. 조작 정책 연구와 손 하드웨어 실험에 사용합니다."
        ),
    },
    {
        "name": "카메라", "category": "센서 · 데이터 수집", "sort": 8,
        "units": [f"카메라 {number}호기" for number in range(1, 8)],
        "license": "카메라 이용 교육", "unit_minutes": RESERVATION_UNIT_MINUTES,
        "description": (
            "로봇 비전과 데이터 수집에 사용하는 카메라 7대입니다. 조작 데이터는 카메라 위치와 "
            "조명이 세션마다 같아야 하나의 데이터셋으로 성립하므로, 세팅을 바꿨다면 사용 후 "
            "원래 자리로 돌려놓고 배치를 기록으로 남겨 주세요."
        ),
    },
    {
        "name": "Unitree G1 휴머노이드", "category": "전신 제어 · 확보 논의 중", "sort": 9,
        "units": [], "license": None, "unit_minutes": RESERVATION_UNIT_MINUTES,
        "status": EquipmentStatus.INACTIVE,
        "description": (
            "전신 제어와 보행, 조작 연구를 위한 휴머노이드 플랫폼입니다. 확보 여부를 논의 중이며 "
            "도입이 확정되면 운용 교육을 개설한 뒤 예약을 받습니다."
        ),
    },
    {
        # 지난 학기에 운용했던 플랫폼. 지금 보유하고 있지 않으므로 호기도 교육도
        # 두지 않고 상태를 INACTIVE 로 둔다. 예약 화면에 아예 뜨지 않는다.
        "name": "AI Sapiens", "category": "휴머노이드 · 이전 운용", "sort": 10,
        "units": [], "license": None, "unit_minutes": RESERVATION_UNIT_MINUTES,
        "status": EquipmentStatus.INACTIVE,
        "description": (
            "SHAPE가 1기 활동 기간에 운용했던 휴머노이드 플랫폼입니다. 현재 보유 장비가 아니어서 "
            "예약을 받지 않으며, 그동안 다뤄 온 플랫폼을 남겨 두기 위해 목록에 둡니다."
        ),
    },
]

LICENSE_NOTE = "해당 장비를 예약하기 전에 이수해야 하는 운용 교육입니다. 기동 절차, 안전 수칙, 사용 후 정리 기준을 다룹니다."


async def main(dry_run: bool) -> None:
    changes: list[str] = []
    async with SessionLocal() as db:
        # ---- 부원 카드 : 명단이 곧 정답이므로 통째로 덮어쓴다 -----------------
        page = await db.scalar(select(ContentPage).where(ContentPage.slug == "members"))
        cards = member_cards()
        if page is None:
            page = ContentPage(slug="members", title="부원", content_html="", is_published=True)
            db.add(page)
        before = len((page.content_json or {}).get("members", []))
        page.content_json = {"members": cards}
        page.is_published = True
        changes.append(f"부원 카드 {before}명 → {len(cards)}명 (전면 교체)")

        # ---- 언론보도 : 같은 제목이 이미 있으면 건너뛴다 ---------------------
        known_titles = set((await db.scalars(select(NewsPost.title))).all())
        for item in PRESS:
            if item["title"] in known_titles:
                changes.append(f"  건너뜀 (이미 있음) 언론보도 · {item['title'][:24]}…")
                continue
            db.add(NewsPost(
                title=item["title"], summary=item["summary"], category="언론보도",
                content_html=item["html"], content_json={}, external_url=item["url"],
                published_at=item["published_at"], is_published=True,
            ))
            changes.append(f"  추가 언론보도 · {item['title'][:24]}…")

        # ---- 로드맵 ----------------------------------------------------------
        known_items = set((await db.scalars(select(RoadmapItem.title))).all())
        added = 0
        for title, category, starts, ends, description in ROADMAP:
            if title in known_items:
                continue
            db.add(RoadmapItem(title=title, category=category, description=description,
                               starts_at=starts, ends_at=ends, is_published=True))
            added += 1
        changes.append(f"로드맵 일정 {added}건 추가 (이미 있는 {len(ROADMAP) - added}건은 건너뜀)")

        # ---- 관련 링크 -------------------------------------------------------
        known_links = set((await db.scalars(select(RelatedLink.title))).all())
        added = 0
        for title, url, description, order, published in LINKS:
            if title in known_links:
                continue
            db.add(RelatedLink(title=title, url=url, description=description,
                               sort_order=order, is_published=published))
            added += 1
        changes.append(f"관련 링크 {added}건 추가 (공개 2건 · 내부 2건)")

        # ---- 필수 교육과 보유 장비 -------------------------------------------
        licenses = {row.name: row for row in (await db.scalars(select(License))).all()}
        for item in EQUIPMENT:
            name = item["license"]
            if name and name not in licenses:
                licenses[name] = License(name=name, description=LICENSE_NOTE, is_active=True)
                db.add(licenses[name])
                changes.append(f"  추가 교육 · {name}")
        await db.flush()

        known_equipment = {row.name: row for row in (await db.scalars(select(Equipment))).all()}
        for item in EQUIPMENT:
            if item["name"] in known_equipment:
                # 설명이나 상태는 관리자가 고쳤을 수 있으니 건드리지 않는다. 다만
                # 목록에서 보이는 순서는 이 파일이 기준이므로 그것만 맞춰 준다.
                existing = known_equipment[item["name"]]
                fixed = []
                if existing.sort_order != item["sort"]:
                    existing.sort_order = item["sort"]
                    fixed.append(f"순서 {item['sort']}번째")
                # 예약 단위가 장비마다 다르면 화면마다 시간표가 달라 헷갈린다.
                if existing.reservation_unit_minutes != item["unit_minutes"]:
                    existing.reservation_unit_minutes = item["unit_minutes"]
                    fixed.append(f"예약 단위 {item['unit_minutes']}분")
                # 그림은 아직 없을 때만 붙인다. 운영진이 올린 사진을 덮지 않는다.
                picture = EQUIPMENT_IMAGES.get(item["name"])
                if picture and not existing.image_url:
                    existing.image_url = picture
                    fixed.append("사진")
                changes.append(
                    f"  {'조정' if fixed else '건너뜀'} 장비 · {item['name']}"
                    + (f" ({' · '.join(fixed)})" if fixed else " (이미 있음)")
                )
                continue
            equipment = Equipment(
                name=item["name"], category=item["category"], description=item["description"],
                status=item.get("status", EquipmentStatus.ACTIVE),
                reservation_unit_minutes=item["unit_minutes"], sort_order=item["sort"],
                image_url=EQUIPMENT_IMAGES.get(item["name"]),
            )
            db.add(equipment)
            await db.flush()
            for label in item["units"]:
                db.add(EquipmentUnit(equipment_id=equipment.id, label=label,
                                     status=EquipmentStatus.ACTIVE))
            if item["license"]:
                db.add(EquipmentLicenseRequirement(equipment_id=equipment.id,
                                                   license_id=licenses[item["license"]].id))
            changes.append(f"  추가 장비 · {item['name']} (호기 {len(item['units'])}대)")

        if dry_run:
            await db.rollback()
        else:
            await db.commit()
    await engine.dispose()

    print("\n".join(changes))
    print("\n실제로 쓰지 않았습니다 (--dry-run)." if dry_run else "\n반영을 마쳤습니다.")


if __name__ == "__main__":
    asyncio.run(main("--dry-run" in sys.argv))
