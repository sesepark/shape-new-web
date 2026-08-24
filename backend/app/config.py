from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    database_url: str
    frontend_url: str = "http://localhost:3000"
    api_base_url: str = "http://localhost:8000"
    cookie_domain: str | None = None
    session_secret: str
    google_client_id: str | None = None
    google_client_secret: str | None = None
    initial_owner_emails: str = ""
    cloudinary_cloud_name: str | None = None
    cloudinary_api_key: str | None = None
    cloudinary_api_secret: str | None = None
    vapid_public_key: str | None = None
    vapid_private_key: str | None = None
    vapid_claims_email: str = "mailto:admin@snu-shape.com"
    revalidate_secret: str | None = None
    db_pool_size: int = 2
    db_max_overflow: int = 1
    db_pool_timeout_seconds: int = 30
    db_pool_recycle_seconds: int = 300
    # 공개 데이터를 얼마나 오래 들고 있을지. 백엔드 안 캐시의 '창' 길이이자
    # 응답에 실리는 s-maxage 값이다. 운영진이 저장하면 그 즉시 캐시를 버리고
    # Next.js 재검증까지 부르므로, 이 값이 길다고 해서 수정이 늦게 보이지 않는다.
    # 늦게 보이는 것은 관리자 화면을 거치지 않고 바꾼 경우뿐이다.
    public_cache_seconds: int = 3600
    # 예약 가능 시간은 승인 즉시 바뀌므로 훨씬 짧게 둔다.
    volatile_cache_seconds: int = 30
    # 창이 끝나는 시각을 창구마다 이 초 안에서 조금씩 민다. 0 이면 다 같이
    # 만료돼 그 순간에 질의가 몰린다. Neon 은 5분을 놀아야 잠들므로 이 정도로
    # 흩어도 '한 번 깨어남' 은 그대로다.
    cache_spread_seconds: int = 30
    rate_limit_read_per_minute: int = 120
    rate_limit_write_per_minute: int = 20
    max_request_bytes: int = 2_000_000

    @property
    def owner_emails(self) -> set[str]:
        return {email.strip().lower() for email in self.initial_owner_emails.split(",") if email.strip()}


@lru_cache
def get_settings() -> Settings:
    return Settings()
