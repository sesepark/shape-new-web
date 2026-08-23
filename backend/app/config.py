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
    public_cache_seconds: int = 300
    rate_limit_read_per_minute: int = 120
    rate_limit_write_per_minute: int = 20
    max_request_bytes: int = 2_000_000

    @property
    def owner_emails(self) -> set[str]:
        return {email.strip().lower() for email in self.initial_owner_emails.split(",") if email.strip()}


@lru_cache
def get_settings() -> Settings:
    return Settings()
