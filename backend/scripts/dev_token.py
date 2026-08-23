"""Print a login cookie value for a seeded account.

Development helper only. `dev_seed.py` creates fresh user ids every run, so any
token printed by an earlier run stops working. Re-run this instead of reseeding:

    DATABASE_URL="sqlite+aiosqlite:///$(pwd)/dev.sqlite3" \
    SESSION_SECRET="local-development-secret-value" \
    python scripts/dev_token.py            # 모든 계정
    python scripts/dev_token.py 오유하       # 이름이나 이메일 일부로 하나만
"""

import asyncio
import sys

from sqlalchemy import select

from app.database import SessionLocal, engine
from app.models import User
from app.security import create_session_token


async def main() -> None:
    wanted = sys.argv[1] if len(sys.argv) > 1 else ""
    async with SessionLocal() as db:
        users = (await db.scalars(select(User).order_by(User.is_owner.desc(), User.name))).all()
        matched = [user for user in users if wanted in user.name or wanted in user.email]
        if not matched:
            print(f"'{wanted}' 에 해당하는 계정이 없습니다. 등록된 계정:")
            for user in users:
                print(f"  {user.name} · {user.email}")
            return
        print("브라우저 개발자도구 > Application > Cookies > http://localhost:3000")
        print("이름 shape_session 으로 아래 값을 넣으세요.\n")
        for user in matched:
            role = "owner" if user.is_owner else user.status.value
            print(f"# {user.name} · {user.email} · {role}")
            print(create_session_token(user.id))
            print()
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
