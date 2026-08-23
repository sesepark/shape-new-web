"use client";

import { ImagePlus, LoaderCircle, X } from "lucide-react";
import Image from "next/image";
import { useRef, useState } from "react";
import { media, optimizable } from "@/lib/media";
import { uploadImage, type UploadPurpose } from "@/lib/upload";

export function ImageUploadField({
  value,
  onChange,
  purpose = "equipment",
  label = "대표 이미지",
}: {
  value: string;
  onChange: (url: string) => void;
  purpose?: UploadPurpose;
  label?: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function upload(file: File) {
    setBusy(true);
    setMessage("");
    const result = await uploadImage(file, purpose);
    setBusy(false);
    if (result.url) {
      onChange(result.url);
      setMessage("이미지를 등록했습니다.");
      return;
    }
    setMessage(result.error ?? "이미지 업로드에 실패했습니다.");
  }
  return (
    <div className="image-upload-field">
      <span className="field-label">{label}</span>
      <input
        ref={fileRef}
        className="sr-only"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
          event.target.value = "";
        }}
      />
      {value ? (
        <div className="image-upload-preview">
          <Image
            src={media(value, 640)}
            alt="등록할 이미지 미리보기"
            width={960}
            height={540}
            unoptimized={!optimizable(value)}
          />
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label="이미지 제거"
          >
            <X size={18} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="image-upload-dropzone"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
        >
          {busy ? (
            <LoaderCircle className="spin" size={20} />
          ) : (
            <ImagePlus size={22} />
          )}
          <span>{busy ? "업로드 중…" : "이미지 선택"}</span>
          <small>JPG, PNG, WebP · 최대 10MB</small>
        </button>
      )}
      <label className="image-url-field">
        또는 이미지 URL
        <input
          type="url"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="https://"
        />
      </label>
      {message && <p className="form-note">{message}</p>}
    </div>
  );
}
