/**
 * 관리자 화면이 서버를 부를 때 쓰는 최소한의 감싸개.
 *
 * `admin-console.tsx` 안에 있던 것을 옮겼습니다. 관리자 탭이 파일 하나에 모두
 * 들어가기에는 커져서 탭을 따로 떼어내는데, 그 파일들이 다시 `admin-console` 을
 * 부르면 import 가 둥글게 돕니다. 공용으로 쓰는 것은 여기 둡니다.
 */
export const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

/** A dropped connection must read as a failed call, never an unhandled reject. */
export type AdminResult = { ok: boolean; status: number; json: () => Promise<unknown> };
const offline: AdminResult = { ok: false, status: 0, json: async () => ({}) };

export async function adminFetch(path: string, init: RequestInit = {}): Promise<AdminResult> {
  try {
    return await fetch(`${apiUrl}${path}`, { credentials: "include", cache: "no-store", ...init });
  } catch {
    return offline;
  }
}

export async function adminSend(path: string, method: string, body?: unknown): Promise<AdminResult> {
  return adminFetch(path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
