"use client";

import { API_URL } from "@/lib/api";

/** The Push API expects the VAPID key as raw bytes, not the base64url text. */
function decodeKey(value: string) {
  const padded = (value + "=".repeat((4 - (value.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const binary = window.atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function pushSupported() {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export async function currentSubscription() {
  if (!pushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  return (await registration?.pushManager.getSubscription()) ?? null;
}

export async function subscribeToNotices(): Promise<string> {
  if (!pushSupported()) return "이 브라우저는 웹 푸시 알림을 지원하지 않습니다.";
  const response = await fetch(`${API_URL}/push/public-key`).catch(() => null);
  const publicKey = response?.ok ? (await response.json()).publicKey : "";
  if (!publicKey) return "알림 서버 설정이 아직 완료되지 않았습니다. 운영진에게 문의해 주세요.";
  if ((await Notification.requestPermission()) !== "granted") return "브라우저에서 알림 권한이 허용되지 않았습니다.";
  const registration = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js", { scope: "/" }));
  await navigator.serviceWorker.ready;
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeKey(publicKey) }));
  const saved = await fetch(`${API_URL}/push-subscriptions`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(subscription.toJSON()),
  });
  return saved.ok ? "새 공지 알림을 켰습니다." : "알림 등록에 실패했습니다. 잠시 후 다시 시도해 주세요.";
}

export async function unsubscribeFromNotices(): Promise<string> {
  const subscription = await currentSubscription();
  if (!subscription) return "이미 알림이 꺼져 있습니다.";
  await fetch(`${API_URL}/push-subscriptions?endpoint=${encodeURIComponent(subscription.endpoint)}`, { method: "DELETE", credentials: "include" }).catch(() => undefined);
  await subscription.unsubscribe();
  return "새 공지 알림을 껐습니다.";
}
