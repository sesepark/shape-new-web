# SHAPE 운영 설정

## 1. Neon

1. Neon에서 PostgreSQL 프로젝트를 만들고 pooled connection string을 복사합니다.
2. `backend/.env`의 `DATABASE_URL`에 `postgresql+asyncpg://` 형식으로 입력합니다.
3. Render 배포 전 `alembic upgrade head`로 스키마를 생성합니다.

## 2. Google 로그인

1. Google Cloud Console에서 OAuth 웹 클라이언트를 만듭니다.
2. 승인된 redirect URI에 `https://api.snu-shape.com/api/v1/auth/google/callback`을 등록합니다.
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

## 6. 첫 운영 준비 순서

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

## 7. 배포

- Vercel Root Directory: `frontend`
- Render Root Directory: `backend`
- Render Start Command: `fastapi run app/main.py --host 0.0.0.0 --port $PORT`
- Render Build Command: `pip install .`
- `www.snu-shape.com`은 Vercel, `api.snu-shape.com`은 Render로 연결합니다.
