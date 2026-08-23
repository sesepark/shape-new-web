"use client";

import { API_URL } from "@/lib/api";

/** Board calls are always member-scoped, so they share one credentialed helper. */
export async function board(path: string, init: RequestInit = {}) {
  try {
    return await fetch(`${API_URL}${path}`, { credentials: "include", cache: "no-store", ...init });
  } catch {
    return new Response(null, { status: 503 });
  }
}

export function boardSend(path: string, method: string, body?: unknown) {
  return board(path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function boardError(status: number) {
  if (status === 0 || status === 503) return "서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.";
  if (status === 403) return "권한이 없습니다. 공지 등록과 상단 고정은 운영진만 할 수 있습니다.";
  if (status === 404) return "글을 찾을 수 없습니다.";
  return "저장하지 못했습니다. 입력한 내용을 확인해 주세요.";
}
