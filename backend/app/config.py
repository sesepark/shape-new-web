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
    # 승인된 AI Worker 예약을 올릴 동아리 공유 캘린더('휴머노이드 운용')와, 그
    # 캘린더에 '변경' 권한으로 초대해 둔 서비스 계정의 열쇠(JSON 파일 내용 그대로).
    # 둘 중 하나라도 없으면 캘린더 연동은 조용히 쉬어 갑니다 — 로컬 개발과 자동
    # 시험에서 남의 달력에 일정이 올라가면 안 됩니다.
    google_calendar_id: str | None = None
    google_service_account_json: str | None = None
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
    # 아무도 안 쓰는 Cloudinary 파일을 얼마나 자주 정리할지. 0 이면 자동 정리를
    # 끄고 `scripts/sweep_orphan_media.py` 로만 돌립니다.
    #
    # 한 시간이었는데 여섯 시간으로 늘렸습니다. 이 정리는 한 번 돌 때마다 여덟 개
    # 표를 **조건 없이** 훑습니다 — 소식·공지·SHAPE UP·페이지의 본문까지 전부입니다.
    # 주소를 뽑는 일 자체는 데이터베이스 안에서 하도록 옮겨서(`media_sweep.py`)
    # 밖으로 나오는 양은 이미 주소 몇십 건으로 줄었지만, 훑는 일이 사라진 것은
    # 아닙니다. 횟수도 함께 줄여 둡니다.
    #
    # 더 늘리지 않는 이유는 이 시계가 **프로세스 안에** 있기 때문입니다. Render
    # 무료 인스턴스는 15분만 놀아도 잠들고 깨어날 때마다 시계가 0 부터 다시 갑니다.
    # 하루로 두면 서버가 하루를 내리 깨어 있는 날이 없어 자동 정리가 사실상 한
    # 번도 돌지 않습니다. 여섯 시간은 활동이 이어지는 날 한두 번은 닿는 값입니다.
    # 확실하게 돌려야 할 때는 `scripts/sweep_orphan_media.py` 를 직접 돌립니다.
    media_sweep_seconds: int = 21600
    # 올라온 지 이만큼 안 된 파일은 건드리지 않습니다. 사진은 저장 버튼보다 먼저
    # 올라가므로, 방금 올렸지만 아직 저장하지 않은 파일과 고아를 구별할 수 없습니다.
    media_orphan_grace_hours: int = 24
    rate_limit_read_per_minute: int = 120
    rate_limit_write_per_minute: int = 20
    max_request_bytes: int = 2_000_000

    @property
    def owner_emails(self) -> set[str]:
        return {email.strip().lower() for email in self.initial_owner_emails.split(",") if email.strip()}


@lru_cache
def get_settings() -> Settings:
    return Settings()
