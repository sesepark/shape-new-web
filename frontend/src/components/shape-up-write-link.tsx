"use client";

import Link from "next/link";
import { PenLine } from "lucide-react";
import { useSession } from "@/lib/session";

/** 결과물 목록은 누구나 보지만, 올리기 버튼은 승인된 회원에게만 보입니다. */
export function ShapeUpWriteLink() {
  const { session } = useSession();
  if (!session || session.status !== "APPROVED") return null;
  return (
    <Link className="button small" href="/shape-up/write">
      <PenLine size={16} /> 결과물 올리기
    </Link>
  );
}
