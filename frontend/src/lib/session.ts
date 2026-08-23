"use client";

import { useCallback, useEffect, useState } from "react";
import { API_URL } from "@/lib/api";
import type { SessionUser } from "@/lib/types";

/** One in-flight request is shared by the header, the gate and my page. */
let cached: Promise<SessionUser | null> | undefined;

export function loadSession(refresh = false): Promise<SessionUser | null> {
  if (refresh || !cached) {
    cached = fetch(`${API_URL}/auth/me`, { credentials: "include", cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<SessionUser>) : null))
      .catch(() => null);
  }
  return cached;
}

export function useSession() {
  const [session, setSession] = useState<SessionUser | null | undefined>(undefined);
  const refresh = useCallback(async () => {
    const value = await loadSession(true);
    setSession(value);
    return value;
  }, []);
  useEffect(() => {
    let active = true;
    void loadSession().then((value) => { if (active) setSession(value); });
    return () => { active = false; };
  }, []);
  return { session, setSession, refresh };
}

export async function endSession() {
  await fetch(`${API_URL}/auth/logout`, { method: "POST", credentials: "include" }).catch(() => undefined);
  cached = Promise.resolve(null);
}

export function canManage(session: SessionUser | null | undefined) {
  return Boolean(session && (session.isOwner || session.permissions.length > 0));
}
