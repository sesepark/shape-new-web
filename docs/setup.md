# SHAPE 운영 설정

## 1. Neon

1. Neon에서 PostgreSQL 프로젝트를 만들고 pooled connection string을 복사합니다.
2. `backend/.env`의 `DATABASE_URL`에 `postgresql+asyncpg://` 형식으로 입력합니다.
3. Render 배포 전 `alembic upgrade head`로 스키마를 생성합니다.

## 2. Google 로그인

1. Google Cloud Console에서 OAuth 웹 클라이언트를 만듭니다.
2. 승인된 redirect URI에 **두 개**를 등록합니다.
   - `https://www.snu-shape.com/login/google/callback` — 지금 쓰는 길입니다. 구글이
     **우리 화면 주소로** 돌아와야 홈 화면에 추가한 앱이 그대로 유지됩니다. 백엔드
     주소로 돌아오면 앱 영역을 벗어나면서 브라우저 창이 열리고 위에 주소 막대가
     남습니다.
   - `https://api.snu-shape.com/api/v1/auth/google/callback` — 예전 길입니다.
     `NEXT_PUBLIC_GOOGLE_CLIENT_ID` 가 설정되기 전까지 쓰이므로 함께 남겨 둡니다.
3. Vercel 환경 변수에 `NEXT_PUBLIC_GOOGLE_CLIENT_ID`(구글 클라이언트 ID)를 넣습니다.
   이 값이 있어야 새 길로 갑니다. 비밀 열쇠(client secret)는 **넣지 않습니다** —
   코드를 세션으로 바꾸는 일은 서버가 합니다.
3. `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`과 첫 owner의 이메일을 `INITIAL_OWNER_EMAILS`에 설정합니다.

## 3. Cloudinary

1. Cloudinary 무료 계정을 만들고 Cloud name, API key, API secret을 입력합니다.
2. 업로드는 백엔드가 발급한 짧은 수명의 서명을 통해서만 수행합니다.
3. Cloudinary 대시보드에서 월간 사용량 알림을 활성화합니다.

## 4. 웹 푸시

1. VAPID public/private key를 생성합니다. (`npx web-push generate-vapid-keys`)
2. Render 환경변수 `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_CLAIMS_EMAIL`에 입력합니다. 프런트엔드는 `GET /api/v1/push/public-key`로 public key를 받아가므로 Vercel에는 따로 넣지 않습니다.
3. 브라우저 알림 권한은 회원이 마이페이지에서 직접 허용해야 합니다. 게시판에 새 글이 공개되면 알림 목록과 웹 푸시로 함께 전달됩니다.

## 5. 저장 즉시 반영 (REVALIDATE_SECRET)

공개 페이지는 방문자에게 5분간 캐시됩니다. 관리자가 글을 저장했을 때 곧바로 반영되도록,
백엔드가 저장 직후 프런트엔드에 새로고침을 요청합니다.

1. 임의의 긴 문자열을 하나 만듭니다. (`openssl rand -hex 24`)
2. Render 환경변수 `REVALIDATE_SECRET` 과 Vercel 환경변수 `REVALIDATE_SECRET` 에 **같은 값**을 넣습니다.
   Vercel 쪽은 `NEXT_PUBLIC_` 접두사를 붙이지 않아야 브라우저에 노출되지 않습니다.
3. 값을 비워 두면 이 기능만 꺼지고, 공개 페이지는 기존대로 5분 안에 스스로 갱신됩니다.

## 6. 구글 캘린더 연동 (AI Worker)

AI Worker 예약이 **승인되면** 동아리 공유 캘린더 '휴머노이드 운용' 에 일정이 자동으로
올라가고, **취소되면** 그 일정이 지워집니다. 그 캘린더는 SHAPE 만 쓰는 것이 아니라
장비를 함께 쓰는 다른 분들도 보는 곳이라, 예전에는 사이트에 신청하고 캘린더에 같은
일정을 손으로 한 번 더 적었습니다.

1. 구글 클라우드 콘솔에서 **Google Calendar API** 를 켜고, 서비스 계정
   (`shape-calendar@snu-shape.iam.gserviceaccount.com`) 의 **JSON 키**를 받습니다.
2. 캘린더 주인이 `calendar.google.com` → 그 캘린더 → **설정 및 공유** →
   **특정 사용자 또는 그룹과 공유** 에 그 서비스 계정 주소를 넣고 **'변경' 권한**을
   줍니다. 보기 전용이면 403 으로 막힙니다. 서비스 계정은 사람이 아니므로 초대
   수락 절차 없이 바로 적용됩니다.
3. 같은 화면의 **캘린더 통합 → 캘린더 ID** (`…@group.calendar.google.com`) 를 복사합니다.
4. Render 환경변수에 넣습니다.
   * `GOOGLE_CALENDAR_ID` — 3번의 캘린더 ID
   * `GOOGLE_SERVICE_ACCOUNT_JSON` — 1번 JSON 파일의 **내용 전체**(한 줄로 압축해 넣는
     편이 안전합니다). **저장소에는 절대 넣지 마세요.**
5. 둘 중 하나라도 비어 있으면 이 기능만 조용히 쉬어 갑니다. 로컬 개발과 자동 시험이
   남의 달력에 일정을 올리지 않도록 하기 위한 것입니다.

연동을 끊고 싶으면 캘린더 공유 설정에서 그 주소를 지우거나, Render 환경변수를 비우면
됩니다. 이미 올라간 일정은 그대로 남습니다.

## 7. 첫 운영 준비 순서

배포 직후 관리자 페이지에서 아래 순서로 등록해야 회원이 예약까지 진행할 수 있습니다.

1. `INITIAL_OWNER_EMAILS`에 넣은 계정으로 Google 로그인하면 곧바로 owner로 승인됩니다.
2. 장비 예약 › **라이선스**에서 교육 항목(예: 로봇 안전 교육)을 등록합니다.
3. 장비 예약 › **보유 장비**에서 장비를 등록하고, 필요한 라이선스를 선택한 뒤 **개별 호기**를 한 대 이상 추가합니다. 호기가 없으면 예약 화면에 시간표가 나오지 않습니다.
4. 시스템 › **회원 및 권한**에서 가입 신청을 승인하고, 운영진에게 기능 권한을, 부원에게 장비 라이선스를 부여합니다.
5. SHAPE › 인사말·동아리 소개·조직도·부원, 바로가기 › 관련 링크·SHAPE 자료를 채우면 공개 페이지에 즉시 반영됩니다.
6. 부원 카드에 구글 로그인 계정을 연결하면, 사진과 소개말은 각 부원이 마이페이지에서 직접 관리합니다.

### 게시판 운영 기준

승인된 회원은 누구나 게시판에 질문·정보·일반 글을 쓰고 댓글과 답글을 달 수 있습니다.
`공지` 종류와 상단 고정, 그리고 전체 알림 발송은 `notices:manage` 권한을 가진 운영진만 할 수 있습니다.
글과 댓글은 작성자 본인 또는 게시판 관리 권한자가 지울 수 있고, 댓글은 지워도 답글 맥락이
남도록 "삭제된 댓글입니다" 표시만 남습니다.

## 8. 배포

- Vercel Root Directory: `frontend`
- Render Root Directory: `backend`
- Render Start Command: `python -m uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- Render Build Command: `pip install .`
- `www.snu-shape.com`은 Vercel, `api.snu-shape.com`은 Render로 연결합니다.

런타임 버전은 저장소에 고정되어 있습니다. Vercel은 `frontend/package.json`의
`engines.node`(20.x), Render는 `backend/.python-version`(Python 3.12)을 읽습니다.
두 버전에서 빌드와 테스트를 확인했으므로 대시보드에서 따로 바꾸지 않는 편이 좋습니다.

저장소 최상위에는 Node 표식을 두지 않습니다. `.nvmrc` 를 거기 두었더니 Render가
Python 서비스인데도 Node 런타임으로 판단해, 시작 명령에서 `fastapi` 실행 파일을
찾지 못하고 죽었습니다. 시작 명령을 `python -m uvicorn` 형태로 적는 것도 같은
이유입니다. 콘솔 스크립트가 PATH 에 있는지에 기대지 않습니다.

### 커밋 이메일

Vercel은 배포하려는 커밋의 작성자 이메일을 GitHub 계정과 맞춰 보고, 맞는 계정이
없으면 빌드를 시작하지도 않고 `Deployment was blocked` 로 끝냅니다. `contact@example.com`
은 GitHub 계정에 등록된 주소가 아니어서 이 상태에 걸렸습니다.

그래서 이 저장소의 `user.email` 은 동아리 GitHub 계정(`snuhumanoid`)의 noreply
주소로 두었습니다.

```bash
git config user.email "263350575+snuhumanoid@users.noreply.github.com"
git config user.name  "SHAPE"
```

noreply 주소는 GitHub이 그 계정에 대해 발급한 것이라 따로 인증할 필요가 없고,
커밋 기록에 동아리 메일 주소가 남지도 않습니다. `contact@example.com` 을 그대로
쓰고 싶다면 GitHub `snuhumanoid` 계정의 Settings → Emails 에 그 주소를 추가하고
인증 메일을 확인하면 됩니다. 어느 쪽이든 **작성자 이메일이 바뀌기 전에 만든 커밋은
계속 막히므로**, 막힌 커밋 위에 새 커밋을 올려 배포를 다시 태워야 합니다.

### 첫 배포에서 데이터베이스 채우기

Neon은 바깥에서도 접속할 수 있으므로 **로컬에서** Neon URL을 가리켜 실행합니다.
Render 무료 티어에는 Shell이 없을 수 있고, 옛 사이트에서 받아 둔 `legacy-data/`
폴더는 저장소 밖에 있어 Render에서는 보이지 않습니다.

```bash
cd backend
export DATABASE_URL="<Neon pooled URL>" SESSION_SECRET="<Render에 넣은 값과 동일>"

# 1) 옛 사이트 사진을 Cloudinary로 옮기고 주소 대응표를 만든다
CLOUDINARY_CLOUD_NAME=... CLOUDINARY_API_KEY=... CLOUDINARY_API_SECRET=... \
    .venv/bin/python scripts/migrate_legacy.py --upload

# 2) 스키마 → 공개 페이지 → 옛 소식 순서로 채운다
.venv/bin/alembic upgrade head
.venv/bin/python scripts/seed_content.py
.venv/bin/python scripts/migrate_legacy.py
```

세 스크립트 모두 이미 있는 내용은 건너뛰므로, 중간에 실패해서 다시 돌려도
중복되지 않고 편집한 내용을 덮지도 않습니다.

### 도메인 전환

옛 사이트도 Vercel에 있습니다. 한 도메인을 두 프로젝트가 동시에 가질 수 없으므로,
옛 프로젝트의 Domains에서 `snu-shape.com`과 `www.snu-shape.com`을 먼저 제거한 뒤
새 프로젝트에 추가합니다. 같은 Vercel 계정 안에서 옮기면 Cloudflare의 `www`·apex
레코드는 그대로 두어도 됩니다. 새로 추가할 레코드는 Render를 가리키는 `api`
하나이고, Cloudflare 프록시(주황 구름)는 인증서 발급이 막히므로 꺼 둡니다.
