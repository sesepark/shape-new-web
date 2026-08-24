"""올린 파일을 실제로 지웁니다.

자료실에서 자료를 지우면 표의 행만 사라지고 Cloudinary 에 있는 원본은 그대로
남아 있었습니다. 무료 25 크레딧에서 저장은 **1 GB 당 매달 1 크레딧**이라,
지워진 자료의 파일이 영영 매달 값을 치릅니다. 자료실이 받는 형식에 10MB 짜리
영상·학습 가중치·로그가 들어 있어서, 한 방향으로만 쌓이는 유일한 항목입니다.

지우기가 실패해도 사용자의 삭제는 성공해야 합니다. 파일이 남는 것은 다음에
정리하면 되지만, 지우려던 자료가 화면에 그대로 있는 것은 바로 문제가 됩니다.
그래서 실패는 기록만 남기고 삼킵니다.
"""

import hashlib
import logging
import re
import time

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)
TIMEOUT = 5.0

# https://res.cloudinary.com/{cloud}/{종류}/upload/{변환}/{v판번호}/{public_id}.{확장자}
DELIVERY = re.compile(
    r"^https://res\.cloudinary\.com/(?P<cloud>[^/]+)/(?P<kind>image|video|raw)/upload/(?P<rest>.+)$"
)
VERSION = re.compile(r"^v\d+$")
# 변환 지시는 `f_auto,q_auto` 나 `c_limit` 처럼 `글자_값` 꼴이 쉼표로 이어집니다.
TRANSFORM = re.compile(r"^[a-z]{1,3}_[^/]*$")


def public_id_of(url: str) -> tuple[str, str] | None:
    """전달 주소에서 (종류, public_id) 를 뽑습니다. 우리 주소가 아니면 None.

    주소에는 변환 지시와 판 번호가 사이에 낄 수 있어 둘 다 걷어냅니다. 사진과
    영상은 확장자를 뗀 것이 public_id 이고, raw 파일은 확장자까지가 이름입니다.
    """
    match = DELIVERY.match(url or "")
    if not match:
        return None
    kind = match.group("kind")
    segments = match.group("rest").split("/")
    while segments and (VERSION.match(segments[0]) or all(TRANSFORM.match(part) for part in segments[0].split(",") if part)):
        segments.pop(0)
    if not segments:
        return None
    name = "/".join(segments)
    if kind != "raw" and "." in name.rsplit("/", 1)[-1]:
        name = name.rsplit(".", 1)[0]
    return kind, name


async def destroy(url: str | None) -> bool:
    """올린 파일 하나를 지웁니다. 지웠으면 True."""
    settings = get_settings()
    if not url or not all([settings.cloudinary_cloud_name, settings.cloudinary_api_key, settings.cloudinary_api_secret]):
        return False
    found = public_id_of(url)
    if not found:
        return False
    kind, public_id = found
    timestamp = int(time.time())
    # Cloudinary 는 정렬한 인자 문자열 뒤에 시크릿을 **붙여서** SHA-1 을 냅니다.
    # 같은 입력의 HMAC 을 보내면 서명이 틀렸다고 거절합니다.
    signature = hashlib.sha1(f"public_id={public_id}&timestamp={timestamp}{settings.cloudinary_api_secret}".encode()).hexdigest()
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            response = await client.post(
                f"https://api.cloudinary.com/v1_1/{settings.cloudinary_cloud_name}/{kind}/destroy",
                data={
                    "public_id": public_id,
                    "timestamp": timestamp,
                    "signature": signature,
                    "api_key": settings.cloudinary_api_key,
                },
            )
        result = response.json().get("result") if response.is_success else None
    except (httpx.HTTPError, ValueError) as error:
        logger.warning("Cloudinary 삭제 실패 %s: %s", public_id, error)
        return False
    # 이미 없는 파일은 "not found" 로 돌아옵니다. 지우려던 상태가 됐으므로 성공과
    # 같이 봅니다.
    if result not in {"ok", "not found"}:
        logger.warning("Cloudinary 삭제가 거절됐습니다 %s: %s", public_id, result)
        return False
    return True
