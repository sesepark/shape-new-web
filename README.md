# SHAPE Web

서울대학교 휴머노이드 · Physical AI 동아리 **SHAPE** 의 공개 웹사이트이자 내부 운영
시스템입니다. 소개 페이지 같은 정적인 홍보물이 아니라, 장비 예약·자격 관리·게시판·
권한 위임까지 동아리 운영이 실제로 돌아가는 자리를 웹으로 옮긴 것입니다.

프런트엔드와 백엔드, 데이터베이스 스키마, 배포와 운영 문서까지 전부 직접 만들었습니다.

| | |
|---|---|
| 페이지 라우트 | 32 |
| API 엔드포인트 | 119 |
| 데이터베이스 테이블 | 25 (Alembic 마이그레이션 22) |
| React 컴포넌트 | 66 |
| 테스트 | 264 (백엔드 166 · 프런트엔드 98) |
| 코드 | 약 36,000줄 (Python 16.5k · TypeScript 18.3k) |

## 기술 스택

**프런트엔드** — Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 ·
TipTap(리치 텍스트 편집기) · three.js(장비 3D 뷰어) · Vitest · Playwright

**백엔드** — FastAPI · SQLAlchemy 2.0 (async) · Alembic · PostgreSQL · Authlib(Google
OAuth) · pywebpush(웹 푸시) · pytest

**배포** — Vercel(프런트) · Render(API) · Neon(PostgreSQL) · Cloudinary(이미지)

## 무엇이 들어 있나

**공개 사이트** — 인사말 · 소개 · 조직도 · 부원 카드 · 소식 · 언론보도 · 공지 ·
자료실 · 보유 장비 · 활동 로드맵 · 오시는 길 · 문의

**운영 시스템** — 장비 예약(30분 단위 슬롯, 동행자, 사용 목적·긴급도), 라이선스 기반
사용 자격 검증, 기능별 권한 위임, 가입 승인 흐름, 게시판과 댓글, 웹 푸시 공지,
감사 로그, 운영진용 관리 화면

## 기록해 둘 만한 설계

이 프로젝트에서 가장 많은 고민이 들어간 부분은 **전부 무료 티어 위에서 돌아가게
만드는 것**이었습니다. `docs/free-tier-deployment.md` 에 근거와 실측을 적어 두었고,
요약하면 이렇습니다.

- **2단 캐시의 창 길이를 맞췄습니다.** 앞은 Next.js Data Cache, 뒤는 백엔드 응답
  캐시입니다. Neon 요금은 질의 횟수가 아니라 *깨어 있는 시간* 이라, 두 창이 어긋나면
  데이터베이스를 깨우는 시점이 흩어져 이득이 사라집니다. 대신 정확히 같은 순간에
  만료시키지는 않습니다(30초 안에서 분산) — 그 순간이 곧 부하가 되기 때문입니다.
- **같은 창구는 한 번만 채웁니다**(`cache.lock_for`). Vercel 이 여러 지역에서 동시에
  재검증하는 탓에, 묶지 않으면 동시 8건이 질의 24건이 되는 것을 실측했습니다.
  연결이 셋뿐인 무료 인스턴스에서는 그대로 줄서기가 됩니다.
- **캐시는 허용 목록 방식입니다.** 세션 쿠키가 실린 요청은 공개 읽기라도
  `private, no-store` 로 내려갑니다. 같은 주소인데 보는 사람에 따라 `canEdit` 이
  달라지는 응답이 있어, 남의 화면에 수정 버튼이 뜨는 사고를 구조적으로 막았습니다.
- **레이트 리밋을 로그인 회원은 계정별로, 나머지는 주소별로 셉니다.** 학교 Wi-Fi처럼
  여러 명이 한 주소를 나눠 쓰는 곳에서 서로의 한도를 깎지 않게 하기 위해서입니다.
- **목록을 돌려주는 창구에는 모두 개수 상한과 커서 페이지네이션을 두었습니다.**
  상한 없는 조회는 학기가 쌓이는 만큼 응답이 무거워집니다.
- **모바일을 먼저 봅니다.** 눈대중이 맞지 않아서, 32:9 울트라와이드부터 320px
  휴대폰까지 14가지 폭을 훑는 Playwright 감사 스크립트(`frontend/scripts/responsive-audit.mjs`)를
  만들어 넘침·잘림·줄바꿈 붕괴를 자동으로 찾게 했습니다.

구조 전체는 [`docs/architecture.md`](docs/architecture.md) 한 장에 정리해 두었습니다.

## 데모 실행

Google OAuth 나 Neon 없이, SQLite 파일 하나로 전체 흐름을 볼 수 있습니다.

```bash
# 1) 데모 데이터 시드 (운영진·부원·장비·라이선스·예약·로드맵·공지)
cd backend
uv sync
DATABASE_URL="sqlite+aiosqlite:///$(pwd)/dev.sqlite3" SESSION_SECRET="local-development-secret-value" \
  uv run python scripts/dev_seed.py

# 2) API
DATABASE_URL="sqlite+aiosqlite:///$(pwd)/dev.sqlite3" SESSION_SECRET="local-development-secret-value" \
  FRONTEND_URL="http://localhost:3000" uv run uvicorn app.main:app --port 8000

# 3) 웹
cd ../frontend && npm install && npm run dev
```

시드 스크립트가 출력한 토큰을 브라우저 쿠키 `shape_session`(도메인 `localhost`)에
넣으면 운영진으로 로그인된 상태가 됩니다. 시드를 다시 돌리면 계정 id 가 새로 만들어져
이전 토큰이 통하지 않으므로, 그럴 때는 시드를 또 돌리지 말고 토큰만 다시 발급하세요.

```bash
DATABASE_URL="sqlite+aiosqlite:///$(pwd)/dev.sqlite3" SESSION_SECRET="local-development-secret-value" \
  uv run python scripts/dev_token.py        # 이름·이메일 일부로 검색, 생략하면 전체
```

외부 키가 없어도 프런트엔드는 안내용 빈 상태 화면을 보여 줍니다. Google 로그인,
Cloudinary 업로드, 웹 푸시는 해당 환경변수를 채우면 켜집니다.

## 테스트

```bash
cd backend  && PYTHONPATH=. uv run pytest -q   # 166개
cd frontend && npm test                        # 98개
```

## 공개본에 대하여

이 저장소는 실제 운영 저장소를 **공개용으로 정리한 판본**입니다. 동아리 부원들의
개인정보는 코드가 아니라 사람에 관한 것이므로, 현재 이력과 작업 트리 어디에도 남지
않도록 제거했습니다.

- 부원 실명은 전부 가상의 이름으로 바꿨습니다.
- 부원 사진은 삭제했습니다. 사진이 없으면 부원 카드가 이름만 남기는 대체 화면을
  그리므로 화면은 정상 동작합니다.
- 시드 데이터의 계정·이메일·게시글은 모두 예시 값입니다.

코드와 구조, 마이그레이션, 테스트는 운영본과 같습니다.
