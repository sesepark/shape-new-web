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

/**
 * 홈 화면에 추가해서 앱처럼 연 상태인지.
 *
 * 아이폰(사파리)은 **홈 화면에 추가한 상태에서만** 웹 알림을 받을 수 있습니다.
 * 그냥 사파리에서 열어 두고 단추를 누르면 아무 일도 일어나지 않아, 왜 안 되는지
 * 알 수 없었습니다. 그래서 안내 문구를 갈라 주기 위해 확인합니다.
 */
export function installedToHomeScreen() {
  if (typeof window === "undefined") return false;
  const standalone = (window.navigator as Navigator & { standalone?: boolean }).standalone;
  return window.matchMedia("(display-mode: standalone)").matches || standalone === true;
}

/** 아이폰·아이패드인지. 알림 규칙이 다릅니다. */
export function appleDevice() {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export async function currentSubscription() {
  if (!pushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  return (await registration?.pushManager.getSubscription()) ?? null;
}

export async function subscribeToNotices(): Promise<string> {
  if (!pushSupported()) {
    return appleDevice() && !installedToHomeScreen()
      ? "아이폰에서는 홈 화면에 추가한 뒤에만 알림을 받을 수 있습니다. 공유 → ‘홈 화면에 추가’ 를 먼저 해 주세요."
      : "이 브라우저는 웹 푸시 알림을 지원하지 않습니다.";
  }
  if (appleDevice() && !installedToHomeScreen()) {
    return "아이폰에서는 홈 화면에 추가한 뒤에만 알림을 받을 수 있습니다. 공유 → ‘홈 화면에 추가’ 를 먼저 해 주세요.";
  }

  // 권한 요청을 **가장 먼저** 합니다. 사파리는 사용자가 단추를 누른 그 순간에만
  // 권한 창을 띄워 주는데, 앞에서 fetch 를 기다리면 그 순간이 지나가 버려
  // 아무 일도 일어나지 않은 것처럼 보였습니다. 아이폰에서 '브라우저 알림 받기'
  // 가 먹통이던 이유입니다.
  let permission: NotificationPermission;
  try {
    permission = await Notification.requestPermission();
  } catch {
    return "알림 권한을 요청하지 못했습니다. 브라우저 설정에서 알림을 허용해 주세요.";
  }
  if (permission === "denied") return "브라우저에서 알림을 막아 두었습니다. 설정에서 알림을 허용해 주세요.";
  if (permission !== "granted") return "알림 권한이 허용되지 않았습니다.";

  const response = await fetch(`${API_URL}/push/public-key`).catch(() => null);
  const publicKey = response?.ok ? (await response.json()).publicKey : "";
  if (!publicKey) return "알림 서버 설정이 아직 완료되지 않았습니다. 운영진에게 문의해 주세요.";
  const registration = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js", { scope: "/" }));
  await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    try {
      subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeKey(publicKey) });
    } catch (error) {
      // 왜 실패했는지 알려 주지 않으면 계속 다시 누르게 됩니다.
      return `알림 등록에 실패했습니다. ${error instanceof Error ? error.message : "브라우저가 거절했습니다."}`;
    }
  }
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
