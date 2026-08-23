"use client";

import Link from "next/link";
import { Pencil, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAsk } from "@/components/ask-dialog";
import { board } from "@/lib/board";
import { useSession } from "@/lib/session";
import type { ShapeUpItem } from "@/lib/types";

/**
 * 상세 페이지는 누구나 볼 수 있으므로 서버에서 미리 그립니다. 수정·삭제 권한은
 * 로그인 상태에 달려 있어 이 조각만 화면에서 판단합니다.
 */
export function ShapeUpOwnerActions({ post }: { post: ShapeUpItem }) {
  const router = useRouter();
  const { session } = useSession();
  const { ask, dialogNode } = useAsk();
  const [message, setMessage] = useState("");
  const mine = Boolean(session && (session.isOwner || session.permissions.includes("content:manage") || session.name === post.authorName));
  if (!mine) return null;

  async function remove() {
    const confirmed = await ask({
      title: "이 결과물을 삭제할까요?",
      description: `${post.title} · 되돌릴 수 없습니다.`,
      confirmLabel: "삭제",
      tone: "danger",
    });
    if (confirmed === null) return;
    if ((await board(`/shape-up/${post.id}`, { method: "DELETE" })).ok) {
      router.push("/shape-up");
      router.refresh();
      return;
    }
    setMessage("삭제하지 못했습니다.");
  }

  return (
    <>
      <Link className="button secondary small" href={`/shape-up/write?id=${post.id}`}>
        <Pencil size={15} /> 수정
      </Link>
      <button type="button" className="text-button danger" onClick={remove}>
        <Trash2 size={15} /> 삭제
      </button>
      {message && <p className="save-notice">{message}</p>}
      {dialogNode}
    </>
  );
}
