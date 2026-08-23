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
RAW_EXTENSIONS = ("pdf", "hwp", "hwpx", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "csv", "txt", "md", "zip")


@router.post("/file-signature")
async def file_upload_signature(user: User = Depends(approved_user), db: AsyncSession = Depends(get_db)):
    """Sign a Cloudinary *raw* upload so 자료실 can hold documents, not just images."""
    settings = get_settings()
    if not all([settings.cloudinary_cloud_name, settings.cloudinary_api_key, settings.cloudinary_api_secret]):
        raise HTTPException(503, "Cloudinary 설정이 아직 완료되지 않았습니다.")
    assert db is not None
    timestamp = int(time.time())
    folder = f"shape/resources/{user.id}"
    params = f"folder={folder}&timestamp={timestamp}"
    signature = hashlib.sha1(f"{params}{settings.cloudinary_api_secret}".encode()).hexdigest()
    return {
        "timestamp": timestamp, "folder": folder, "signature": signature,
        "apiKey": settings.cloudinary_api_key, "cloudName": settings.cloudinary_cloud_name,
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
