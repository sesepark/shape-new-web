import os
import tempfile
from pathlib import Path

import pytest

DATABASE = Path(tempfile.gettempdir()) / "shape-test.sqlite3"
os.environ.setdefault("DATABASE_URL", f"sqlite+aiosqlite:///{DATABASE}")
os.environ.setdefault("SESSION_SECRET", "test-session-secret-value")
os.environ.setdefault("FRONTEND_URL", "http://localhost:3000")
os.environ.setdefault("API_BASE_URL", "http://localhost:8000")
os.environ.setdefault("INITIAL_OWNER_EMAILS", "owner@example.com")
os.environ.setdefault("CLOUDINARY_CLOUD_NAME", "demo")
os.environ.setdefault("CLOUDINARY_API_KEY", "123")
os.environ.setdefault("CLOUDINARY_API_SECRET", "secret")
# Every test shares one client address, so the production flood limits would
# reject later cases; the guard itself is exercised in its own test.
os.environ.setdefault("RATE_LIMIT_READ_PER_MINUTE", "5000")
os.environ.setdefault("RATE_LIMIT_WRITE_PER_MINUTE", "5000")

import httpx  # noqa: E402
from httpx import ASGITransport  # noqa: E402

from app.database import SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.middleware import CostGuardMiddleware  # noqa: E402
from app.models import Base, PermissionGrant, User, UserStatus  # noqa: E402
from app.security import COOKIE_NAME, create_session_token  # noqa: E402


@pytest.fixture(autouse=True)
def reset_rate_limits():
    for guard in CostGuardMiddleware.instances:
        guard.buckets.clear()


@pytest.fixture(autouse=True)
async def database():
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.drop_all)
        await connection.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.drop_all)


@pytest.fixture
async def session():
    async with SessionLocal() as value:
        yield value


@pytest.fixture
async def client():
    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as value:
        yield value


async def make_user(session, email="member@example.com", *, owner=False, status=UserStatus.APPROVED, permissions=()):
    user = User(google_sub=email, email=email, name=email.split("@")[0], is_owner=owner, status=status)
    session.add(user)
    await session.flush()
    session.add_all([PermissionGrant(user_id=user.id, permission=permission) for permission in permissions])
    await session.commit()
    return user


def login(client, user):
    client.cookies.set(COOKIE_NAME, create_session_token(user.id))
    return client


def logout(client):
    """Drop the session cookie so the next call is made as a visitor."""
    client.cookies.clear()
    return client
