"use client";

import { API_URL } from "@/lib/api";

export type UploadPurpose = "equipment" | "news" | "notice" | "members" | "profile" | "reservation";

const MAX_BYTES = 10 * 1024 * 1024;

/**
 * One upload path for the whole site: ask the API to sign the request, then
 * send the file straight to Cloudinary so it never passes through our server.
 */
export async function uploadImage(file: File, purpose: UploadPurpose): Promise<{ url?: string; error?: string }> {
  if (!file.type.startsWith("image/")) return { error: "JPG, PNG, WebP 이미지만 올릴 수 있습니다." };
  if (file.size > MAX_BYTES) return { error: "이미지는 10MB 이하만 올릴 수 있습니다." };
  try {
    const signature = await fetch(`${API_URL}/media/signature?purpose=${purpose}`, { method: "POST", credentials: "include" });
    if (signature.status === 403) return { error: "이미지를 올릴 권한이 없습니다." };
    if (signature.status === 503) return { error: "이미지 저장소 설정이 아직 완료되지 않았습니다." };
    if (!signature.ok) return { error: "업로드 설정을 불러오지 못했습니다." };
    const data = await signature.json();
    const form = new FormData();
    form.append("file", file);
    form.append("api_key", data.apiKey);
    form.append("timestamp", String(data.timestamp));
    form.append("signature", data.signature);
    form.append("folder", data.folder);
    form.append("allowed_formats", data.allowedFormats.join(","));
    const response = await fetch(`https://api.cloudinary.com/v1_1/${data.cloudName}/image/upload`, { method: "POST", body: form });
    if (!response.ok) return { error: "이미지 업로드에 실패했습니다." };
    return { url: (await response.json()).secure_url as string };
  } catch {
    return { error: "이미지 업로드에 실패했습니다. 연결을 확인해 주세요." };
  }
}


const DOCUMENT_EXTENSIONS = ["pdf", "hwp", "hwpx", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "csv", "txt", "md", "zip"];

/**
 * Documents go to Cloudinary's `raw` endpoint, which keeps the original file
 * untouched. Images have their own signed path; this one is for 자료실.
 */
export async function uploadDocument(file: File): Promise<{ url?: string; name?: string; size?: number; error?: string }> {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!DOCUMENT_EXTENSIONS.includes(extension)) {
    return { error: `${DOCUMENT_EXTENSIONS.join(", ")} 형식만 올릴 수 있습니다.` };
  }
  if (file.size > MAX_BYTES) return { error: "파일은 10MB 이하만 올릴 수 있습니다." };
  try {
    const signature = await fetch(`${API_URL}/media/file-signature`, { method: "POST", credentials: "include" });
    if (signature.status === 401 || signature.status === 403) return { error: "로그인한 회원만 자료를 올릴 수 있습니다." };
    if (signature.status === 503) return { error: "파일 저장소 설정이 아직 완료되지 않았습니다." };
    if (!signature.ok) return { error: "업로드 설정을 불러오지 못했습니다." };
    const data = await signature.json();
    const form = new FormData();
    form.append("file", file);
    form.append("api_key", data.apiKey);
    form.append("timestamp", String(data.timestamp));
    form.append("signature", data.signature);
    form.append("folder", data.folder);
    const response = await fetch(`https://api.cloudinary.com/v1_1/${data.cloudName}/raw/upload`, { method: "POST", body: form });
    if (!response.ok) return { error: "파일 업로드에 실패했습니다." };
    const uploaded = await response.json();
    return { url: uploaded.secure_url as string, name: file.name, size: file.size };
  } catch {
    return { error: "파일 업로드에 실패했습니다. 연결을 확인해 주세요." };
  }
}
