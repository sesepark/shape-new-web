# SHAPE Web

SHAPE의 공개 웹사이트와 내부 운영 시스템입니다.

## 구성

- `frontend/`: Next.js 앱 (Vercel 배포)
- `backend/`: FastAPI API (Render 배포)
- `docs/`: 배포와 외부 서비스 설정 안내

## 로컬 실행

1. `frontend/.env.local` 및 `backend/.env`를 각각 `.env.example`에서 복사해 필요한 값을 채웁니다.
2. Neon PostgreSQL에 연결한 뒤 `backend`에서 `alembic upgrade head`를 실행합니다.
3. 각각의 폴더에서 의존성을 설치하고 개발 서버를 실행합니다.

## 데모 데이터로 둘러보기

Google OAuth·Neon 없이 로컬에서 전체 흐름을 확인할 때는 SQLite 한 파일로 띄울 수 있습니다.

```bash
# 1) 데모 데이터 시드 (운영진/부원/장비/호기/라이선스/예약/로드맵/공지)
cd backend
DATABASE_URL="sqlite+aiosqlite://$(pwd)/dev.sqlite3" SESSION_SECRET="local-development-secret-value" \
  .venv/bin/python scripts/dev_seed.py

# 2) API
DATABASE_URL="sqlite+aiosqlite://$(pwd)/dev.sqlite3" SESSION_SECRET="local-development-secret-value" \
  FRONTEND_URL="http://localhost:3000" .venv/bin/python -m uvicorn app.main:app --port 8000

# 3) 웹
cd ../frontend && npm run dev
```

시드 스크립트가 출력한 토큰을 브라우저 쿠키 `shape_session`(도메인 `localhost`)에 넣으면 운영진으로 로그인된 상태가 됩니다.

시드를 다시 돌리면 계정 id가 새로 만들어져 이전 토큰은 더 이상 통하지 않습니다.
그럴 때는 시드를 또 돌리지 말고 토큰만 다시 발급하세요.

```bash
cd backend
DATABASE_URL="sqlite+aiosqlite://$(pwd)/dev.sqlite3" SESSION_SECRET="local-development-secret-value" \
  .venv/bin/python scripts/dev_token.py 오유하    # 이름·이메일 일부로 검색, 생략하면 전체
```

외부 키가 없는 상태에서도 프론트엔드는 안내용 빈 상태 화면을 표시합니다. Google 로그인, Cloudinary 업로드, 푸시는 해당 환경변수를 설정한 뒤 활성화됩니다.

