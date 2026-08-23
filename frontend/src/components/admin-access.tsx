"use client";

import { AdminConsole } from "@/components/admin-console";
import { AuthGate } from "@/components/auth-gate";

export function AdminAccess() {
  return <AuthGate admin>{(session) => <AdminConsole name={session.name} isOwner={session.isOwner} permissions={session.permissions} />}</AuthGate>;
}
