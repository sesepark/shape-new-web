import hashlib
import time

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.models import PermissionGrant, User
from app.security import approved_user

router = APIRouter(prefix="/media", tags=["media"])


# 게시판 글은 승인 회원 누구나 쓸 수 있으므로 "notice" 는 권한을 요구하지 않습니다.
MANAGED_UPLOAD_PERMISSIONS = {"equipment": "equipment:manage", "news": "news:manage", "members": "content:manage"}


RAW_MAX_BYTES = 10 * 1024 * 1024
# 자료실에 올릴 수 있는 파일 형식.
#
# 처음에는 문서 몇 가지만 받았는데, 실제로 오가는 자료는 그보다 넓습니다. URDF 와
# 런치 파일, 학습 로그와 점군, 실험 영상, 노트북과 설정 파일이 다 자료실에 올라올
# 만한 것들입니다. 형식이 막혀 있으면 각자 개인 드라이브로 흩어지고, 그러면 다음
# 기수에 아무것도 남지 않습니다.
#
# 웹 페이지로 열릴 수 있는 형식(html·htm·svg)과 실행 파일(exe·dll·bat 따위)은
# 일부러 뺐습니다. 내려받아 여는 파일과 브라우저가 바로 실행하는 파일은 다릅니다.
RAW_EXTENSIONS = (
    # 문서
    "pdf", "hwp", "hwpx", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
    "odt", "ods", "odp", "rtf", "epub", "txt", "md", "csv", "tsv",
    # 압축
    "zip", "7z", "tar", "gz", "tgz", "bz2", "xz", "rar",
    # 코드·설정·노트북
    "py", "ipynb", "json", "yaml", "yml", "toml", "xml", "cfg", "ini",
    "c", "h", "cpp", "hpp", "cc", "cu", "rs", "go", "js", "ts", "sh", "bash",
    "cmake", "launch", "urdf", "xacro", "sdf", "rviz", "srdf", "proto",
    # 데이터·모델·로그
    "bag", "mcap", "db3", "npy", "npz", "pt", "pth", "onnx", "safetensors",
    "pcd", "ply", "las", "parquet", "log",
    # 3D·설계
    "stl", "obj", "dae", "fbx", "glb", "gltf", "step", "stp", "iges", "igs",
    "dxf", "dwg", "f3d", "sldprt", "sldasm", "3mf",
    # 그림·소리·영상
    "png", "jpg", "jpeg", "webp", "gif", "heic", "bmp", "tif", "tiff",
    "mp3", "wav", "m4a", "flac", "mp4", "mov", "webm", "mkv", "avi",
)


@router.post("/file-signature")
async def file_upload_signature(user: User = Depends(approved_user), db: AsyncSession = Depends(get_db)):
    """Sign a Cloudinary *raw* upload so 자료실 can hold documents, not just images.

    **형식과 크기 제한은 서명 안에 들어가야 뜻이 있습니다.** 예전에는 받아도 되는
    확장자와 10MB 라는 값을 화면에 알려 주기만 했습니다. 화면은 그 값을 지켰지만,
    서명이 담고 있는 것은 폴더와 시각뿐이라 **같은 서명으로 무엇이든 올릴 수
    있었습니다** — 브라우저 개발자 도구로 요청을 한 번 바꾸면 끝입니다. 저장 용량은
    무료 25 크레딧에서 1GB 마다 매달 값을 치르므로, 막지 않으면 계정 하나가 요금제를
    통째로 태울 수 있습니다.

    Cloudinary 는 요청에 실린 인자 **전부**로 서명을 다시 계산해 견주므로, 여기
    넣은 값은 보내는 쪽이 뺄 수도 바꿀 수도 없습니다.
    """
    settings = get_settings()
    if not all([settings.cloudinary_cloud_name, settings.cloudinary_api_key, settings.cloudinary_api_secret]):
        raise HTTPException(503, "Cloudinary 설정이 아직 완료되지 않았습니다.")
    assert db is not None
    timestamp = int(time.time())
    folder = f"shape/resources/{user.id}"
    allowed_formats = ",".join(RAW_EXTENSIONS)
    # Cloudinary 는 정렬한 인자 문자열 뒤에 시크릿을 붙여 SHA-1 을 냅니다.
    params = f"allowed_formats={allowed_formats}&folder={folder}&timestamp={timestamp}"
    signature = hashlib.sha1(f"{params}{settings.cloudinary_api_secret}".encode()).hexdigest()
    return {
        "timestamp": timestamp, "folder": folder, "signature": signature,
        "apiKey": settings.cloudinary_api_key, "cloudName": settings.cloudinary_cloud_name,
        "allowedFormats": allowed_formats,
        "maxFileSize": RAW_MAX_BYTES, "allowedExtensions": list(RAW_EXTENSIONS),
    }


@router.post("/signature")
async def upload_signature(purpose: str, user: User = Depends(approved_user), db: AsyncSession = Depends(get_db)):
    if purpose not in {"profile", "reservation", "news", "equipment", "notice", "members"}:
        raise HTTPException(422, "지원하지 않는 업로드 목적입니다.")
    permission = MANAGED_UPLOAD_PERMISSIONS.get(purpose)
    if permission and not user.is_owner:
        grant = await db.scalar(select(PermissionGrant.id).where(PermissionGrant.user_id == user.id, PermissionGrant.permission == permission))
        if not grant:
            raise HTTPException(403, "해당 콘텐츠의 이미지를 올릴 권한이 없습니다.")
    settings = get_settings()
    if not all([settings.cloudinary_cloud_name, settings.cloudinary_api_key, settings.cloudinary_api_secret]):
        raise HTTPException(503, "Cloudinary 설정이 아직 완료되지 않았습니다.")
    timestamp = int(time.time())
    folder = f"shape/{purpose}/{user.id}"
    allowed_formats = "jpg,jpeg,png,webp"
    # Cloudinary signs the sorted upload parameters with the API secret appended
    # to the string itself; an HMAC of the same input is rejected as invalid.
    params = f"allowed_formats={allowed_formats}&folder={folder}&timestamp={timestamp}"
    signature = hashlib.sha1(f"{params}{settings.cloudinary_api_secret}".encode()).hexdigest()
    return {"timestamp": timestamp, "folder": folder, "signature": signature, "apiKey": settings.cloudinary_api_key, "cloudName": settings.cloudinary_cloud_name, "allowedFormats": allowed_formats.split(","), "maxFileSize": 10 * 1024 * 1024}
