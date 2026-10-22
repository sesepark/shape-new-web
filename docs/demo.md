# 로컬 데모와 테스트

[프로젝트 소개](../README.md) · [환경 설정](setup.md)

## 데모 실행

Google OAuth나 Neon 없이, SQLite 파일 하나로 전체 흐름을 볼 수 있음.

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

시드 스크립트가 출력한 토큰을 브라우저 쿠키 `shape_session`(도메인 `localhost`)에 넣으면
운영진으로 로그인된 상태가 됨. 시드를 다시 돌리면 계정 id가 새로 만들어져 이전 토큰이 통하지
않으므로, 그럴 때는 시드를 또 돌리지 말고 토큰만 다시 발급할 것.

```bash
DATABASE_URL="sqlite+aiosqlite:///$(pwd)/dev.sqlite3" SESSION_SECRET="local-development-secret-value" \
  uv run python scripts/dev_token.py        # 이름·이메일 일부로 검색, 생략하면 전체
```

외부 키가 없어도 프런트엔드는 안내용 빈 상태 화면을 보여 줌. Google 로그인, Cloudinary 업로드,
웹 푸시는 해당 환경변수를 채우면 켜짐.

## 테스트

```bash
cd backend  && PYTHONPATH=. uv run pytest -q   # 157개
cd frontend && npm test                        # 98개
```
