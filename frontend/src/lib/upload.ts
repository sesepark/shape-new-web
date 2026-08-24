"use client";

import { API_URL } from "@/lib/api";

export type UploadPurpose = "equipment" | "news" | "notice" | "members" | "profile" | "reservation";

const MAX_BYTES = 10 * 1024 * 1024;

/**
 * 올리기 전에 브라우저에서 사진을 줄입니다.
 *
 * 요즘 휴대폰 사진은 4000px 넘는 3~5MB 짜리인데, 웹에서 실제로 쓰는 폭은
 * 아무리 커도 1600px 입니다. 원본을 그대로 올리면 세 군데에서 손해입니다.
 * 올리는 사람의 데이터, Cloudinary 무료 요금제의 저장 용량, 그리고 나중에
 * 그 사진을 변환해 내보낼 때의 전송량입니다. 여기서 한 번 줄여 두면 셋 다
 * 줄어듭니다.
 *
 * WebP 로 바꿔 보내되, 브라우저가 WebP 를 못 만들거나 오히려 커지면 원본을
 * 그대로 씁니다. 사진이 이미 작으면 손대지 않습니다. GIF 는 움직임이 사라지므로
 * 건드리지 않습니다.
 */
const MAX_EDGE = 1600;
const QUALITY = 0.82;
/** 이보다 작으면 줄여 봐야 얻는 것이 없습니다. */
const SKIP_UNDER_BYTES = 300 * 1024;

async function shrink(file: File): Promise<File> {
  if (file.type === "image/gif" || file.type === "image/svg+xml") return file;
  if (file.size < SKIP_UNDER_BYTES) return file;
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return file;
  try {
    // EXIF 방향을 반영해서 읽습니다. 이것을 빼면 세로로 찍은 사진이 눕습니다.
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", QUALITY));
    if (!blob || blob.type !== "image/webp" || blob.size >= file.size) return file;
    const name = file.name.replace(/\.[^.]+$/, "") + ".webp";
    return new File([blob], name, { type: "image/webp", lastModified: file.lastModified });
  } catch {
    return file;
  }
}

/**
 * One upload path for the whole site: ask the API to sign the request, then
 * send the file straight to Cloudinary so it never passes through our server.
 */
export async function uploadImage(file: File, purpose: UploadPurpose): Promise<{ url?: string; error?: string }> {
  if (!file.type.startsWith("image/")) return { error: "JPG, PNG, WebP 이미지만 올릴 수 있습니다." };
  if (file.size > MAX_BYTES) return { error: "이미지는 10MB 이하만 올릴 수 있습니다." };
  const upload = await shrink(file);
  try {
    const signature = await fetch(`${API_URL}/media/signature?purpose=${purpose}`, { method: "POST", credentials: "include" });
    if (signature.status === 403) return { error: "이미지를 올릴 권한이 없습니다." };
    if (signature.status === 503) return { error: "이미지 저장소 설정이 아직 완료되지 않았습니다." };
    if (!signature.ok) return { error: "업로드 설정을 불러오지 못했습니다." };
    const data = await signature.json();
    const form = new FormData();
    form.append("file", upload);
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


/**
 * 자료실에 올리는 파일.
 *
 * 어떤 형식을 받을지는 **서버가 정합니다.** 예전에는 같은 목록을 화면에도 적어
 * 두어, 서버에서 형식을 늘려도 화면이 막는 일이 생겼습니다. 이제 서명을 받아 올
 * 때 함께 오는 목록(`allowedExtensions`)으로 확인합니다. 형식이 틀리면 올리기
 * 전에 걸러지므로 큰 파일이 헛되이 나가지 않습니다.
 *
 * Cloudinary 의 `raw` 자리에 올려 원본을 그대로 둡니다. 사진은 자기 길이 따로
 * 있고, 이 길은 자료실 전용입니다.
 */
export async function uploadDocument(file: File): Promise<{ url?: string; name?: string; size?: number; error?: string }> {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  try {
    const signature = await fetch(`${API_URL}/media/file-signature`, { method: "POST", credentials: "include" });
    if (signature.status === 401 || signature.status === 403) return { error: "로그인한 회원만 자료를 올릴 수 있습니다." };
    if (signature.status === 503) return { error: "파일 저장소 설정이 아직 완료되지 않았습니다." };
    if (!signature.ok) return { error: "업로드 설정을 불러오지 못했습니다." };
    const data = await signature.json();
    const allowed: string[] = Array.isArray(data.allowedExtensions) ? data.allowedExtensions : [];
    if (allowed.length && !allowed.includes(extension)) {
      return { error: `${extension ? `.${extension} 는 ` : ""}올릴 수 없는 형식입니다. 압축해서 올려 주세요.` };
    }
    const limit: number = typeof data.maxFileSize === "number" ? data.maxFileSize : MAX_BYTES;
    if (file.size > limit) return { error: `파일은 ${Math.round(limit / 1024 / 1024)}MB 이하만 올릴 수 있습니다.` };

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
