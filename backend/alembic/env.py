import asyncio
from logging.config import fileConfig
from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config
from app.config import get_settings
from app.database import asyncpg_url
from app.models import Base

config = context.config
# 앱과 같은 정규화를 거쳐야 한다. Neon이 주는 주소는 postgresql:// 로 시작해서,
# 그대로 넘기면 SQLAlchemy가 기본 드라이버인 psycopg2 를 찾다가 실패한다.
# sslmode 를 asyncpg 가 아는 ssl 로 바꾸는 것도 이 함수가 한다.
config.set_main_option("sqlalchemy.url", asyncpg_url(get_settings().database_url))
if config.config_file_name:
    fileConfig(config.config_file_name)
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(url=config.get_main_option("sqlalchemy.url"), target_metadata=target_metadata, literal_binds=True, dialect_opts={"paramstyle": "named"})
    with context.begin_transaction(): context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction(): context.run_migrations()


async def run_async_migrations() -> None:
    connectable = async_engine_from_config(config.get_section(config.config_ini_section, {}), prefix="sqlalchemy.", poolclass=pool.NullPool)
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


if context.is_offline_mode(): run_migrations_offline()
else: asyncio.run(run_async_migrations())

