# Vercel · Render · Neon 무료 운영 기준

## 배치

- Vercel: `shape_web/frontend` Next.js 앱
- Render: `shape_web/backend` FastAPI 앱
- Neon: PostgreSQL pooled connection URL

## 필수 안전 설정

- Render 환경 변수에서 `DB_POOL_SIZE=2`, `DB_MAX_OVERFLOW=1`을 유지합니다. 20명 규모에서 연결 수를 작게 유지해 Neon 무료 한도를 보호합니다.
- CDN 캐시는 허용 목록 방식입니다. `/pages/*`, `/news*`, `/equipment*`, `/roadmap`, `/links`, `/push/public-key`만 5분 공유 캐시(10분 stale)를 쓰고, 그 밖의 응답(세션·알림·공지·예약·관리자)은 모두 `private, no-store`로 내려갑니다.
- 예약 가능 시간(`/equipment/{id}/availability`)은 승인 즉시 바뀌므로 공유 캐시를 30초로 짧게 둡니다.
- API는 IP별 분당 공개 읽기 120회, 쓰기 20회로 제한합니다. 요청 본문은 2MB를 넘으면 데이터베이스 접근 전에 거절합니다.
- 예약은 180일 이내·1회 12시간 이내만 접수하고, 승인 슬롯은 데이터베이스 고유 제약으로 중복을 막습니다. 이미 확정된 시간은 신청 단계에서 먼저 거절합니다.
- 홈 화면 로봇 3D는 선택한 모델만 먼저 내려받고 나머지는 브라우저가 한가할 때 미리 받습니다. 데이터 절약 모드나 2G에서는 미리 받지 않습니다. 세 모델 합계는 약 3.2MB입니다.
- Vercel과 Render에서 자동 확장 상한 또는 지출 한도를 설정할 수 있으면 최소값으로 설정하고, 사용량 알림을 활성화합니다.

## 배포 순서

1. Neon의 pooled URL을 Render `DATABASE_URL`에 입력합니다. 일반 `postgresql://` URL과 `sslmode=require`도 앱이 asyncpg 형식으로 정규화합니다.
2. Render에 `SESSION_SECRET`, `FRONTEND_URL`, Google OAuth 환경 변수를 입력하고 배포 전에 `alembic upgrade head`를 실행합니다.
3. Vercel에 `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SITE_URL`을 입력합니다.
4. Google Search Console에 `/sitemap.xml`을 제출하고 `/robots.txt`와 공개 페이지의 canonical 도메인을 확인합니다.

사용자별·관리자 응답에 CDN 캐시를 추가하거나 공개 데이터의 재검증 주기를 바꿀 때는 운영자 합의 후 변경합니다.
