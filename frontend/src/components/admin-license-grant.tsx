"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { GraduationCap, Search } from "lucide-react";
import { useAsk } from "@/components/ask-dialog";
import { ScrollingName } from "@/components/scrolling-name";
import { useNotice } from "@/components/use-notice";
import { adminFetch, adminSend } from "@/lib/admin-api";
import { media, optimizable } from "@/lib/media";
import type { AdminUserItem, LicenseItem } from "@/lib/types";

/**
 * 교육 하나를 골라 **여러 명에게 한 번에** 부여하는 곳.
 *
 * 예전에는 회원 한 명을 고르고 그 사람의 라이선스를 손보는 길밖에 없었습니다
 * (회원 및 권한 탭). 교육을 한 번 하고 마흔 명에게 부여하려면 마흔 번 들어갔다
 * 나와야 했습니다. 부원이 100명 가까이 되면 여기가 가장 먼저 막힙니다.
 *
 * 목록을 **통째로 맞추는** 방식입니다. 체크를 풀면 회수되므로, 저장하기 전에
 * 몇 명이 부여되고 몇 명이 회수되는지 확인을 받습니다 — 실수로 하나를 풀면
 * 그 사람이 장비를 못 쓰게 되는데, 그 사실이 저장하는 순간에는 보이지 않습니다.
 */
export function AdminLicenseGrant() {
  const { ask, dialogNode } = useAsk();
  const { say, node: notice } = useNotice();
  const [licenses, setLicenses] = useState<LicenseItem[]>([]);
  const [people, setPeople] = useState<AdminUserItem[]>([]);
  const [licenseId, setLicenseId] = useState("");
  const [holders, setHolders] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [keyword, setKeyword] = useState("");
  const [onlyHolders, setOnlyHolders] = useState(false);
  const [busy, setBusy] = useState(false);


  const pick = useCallback(async (id: string) => {
    setLicenseId(id);
    setKeyword("");
    setOnlyHolders(false);
    if (!id) { setHolders(new Set()); setSaved(new Set()); return; }
    const response = await adminFetch(`/admin/licenses/${id}/members`).catch(() => null);
    if (!response?.ok) { say("이수자 목록을 불러오지 못했습니다.", false); return; }
    const { userIds } = (await response.json()) as { userIds: string[] };
    setHolders(new Set(userIds));
    setSaved(new Set(userIds));
  }, [say]);

  useEffect(() => {
    const load = async () => {
      const [list, users] = await Promise.all([adminFetch("/admin/licenses"), adminFetch("/admin/users")]);
      if (!list.ok || !users.ok) { say("이 화면은 장비 관리 권한이 필요합니다.", false); return; }
      const rows = (await list.json()) as LicenseItem[];
      setLicenses(rows);
      // 승인된 회원만 고를 수 있습니다. 가입 대기·보기 전용 계정은 애초에 예약을
      // 신청할 수 없으므로 교육 이수를 적어 둘 이유가 없습니다.
      setPeople(((await users.json()) as AdminUserItem[]).filter((row) => row.status === "APPROVED"));
      // 아무것도 고르지 않은 상태로 두면 첫 화면이 빈 껍데기입니다. 무엇을 할 수
      // 있는 곳인지 보이도록 첫 교육을 미리 골라 둡니다.
      if (rows[0]) await pick(rows[0].id);
    };
    void load();
  }, [say, pick]);

  const shown = useMemo(() => {
    const needle = keyword.trim().toLocaleLowerCase("ko");
    return people.filter((person) => {
      if (onlyHolders && !holders.has(person.id)) return false;
      if (!needle) return true;
      return `${person.name} ${person.email}`.toLocaleLowerCase("ko").includes(needle);
    });
  }, [people, keyword, onlyHolders, holders]);

  const added = [...holders].filter((id) => !saved.has(id));
  const removed = [...saved].filter((id) => !holders.has(id));
  const dirty = added.length > 0 || removed.length > 0;
  const name = licenses.find((row) => row.id === licenseId)?.name ?? "교육";

  function toggle(id: string) {
    setHolders((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  /** 지금 보이는 사람 전부를 켜고 끕니다. 검색으로 좁힌 뒤 쓰면 조 단위로 처리됩니다. */
  function toggleShown(on: boolean) {
    setHolders((current) => {
      const next = new Set(current);
      for (const person of shown) {
        if (on) next.add(person.id); else next.delete(person.id);
      }
      return next;
    });
  }

  async function submit() {
    const label = (ids: string[]) => ids
      .map((id) => people.find((person) => person.id === id)?.name ?? "회원")
      .join(", ");
    const confirmed = await ask({
      title: `${name} 이수자를 바꿀까요?`,
      description: (
        <>
          {added.length > 0 && <p><b>{added.length}명에게 부여</b> — {label(added)}</p>}
          {removed.length > 0 && <p className="ask-lead"><b>{removed.length}명에게서 회수</b> — {label(removed)}</p>}
          <p>부여받은 부원에게는 알림이 갑니다. 회수하면 그 장비를 더는 신청할 수 없게 됩니다.</p>
        </>
      ),
      confirmLabel: "저장",
      tone: removed.length > 0 ? "danger" : "default",
    });
    if (confirmed === null) return;
    setBusy(true);
    const response = await adminSend(`/admin/licenses/${licenseId}/members`, "PUT", { userIds: [...holders] });
    setBusy(false);
    if (!response.ok) {
      const detail = (await response.json().catch(() => null)) as { detail?: string } | null;
      say(detail?.detail ?? "저장하지 못했습니다.", false);
      return;
    }
    const result = (await response.json()) as { granted: number; revoked: number; total: number };
    setSaved(new Set(holders));
    say(`${name} · ${result.granted}명 부여, ${result.revoked}명 회수. 이제 ${result.total}명이 이수 상태입니다.`);
  }

  return (
    <div className="admin-form admin-license-grant">
      <p className="form-note">
        교육 하나를 고른 뒤 이수한 부원을 한 번에 체크합니다. <b>목록을 통째로 맞추는 방식</b>이라
        체크를 풀면 회수됩니다. 저장하기 전에 몇 명이 부여·회수되는지 다시 확인합니다.
      </p>
      <p className="form-note">
        교육 항목 자체를 만들고 고치는 곳은 <b>라이선스</b> 탭이고, 한 사람의 이수 내역을 통째로 보려면
        <b> 회원 및 권한</b> 탭을 쓰세요.
      </p>

      <label>
        교육 항목
        <select value={licenseId} onChange={(event) => void pick(event.target.value)}>
          <option value="">고르기</option>
          {licenses.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
        </select>
      </label>

      {licenseId && (
        <>
          <div className="grant-toolbar">
            <label className="grant-search">
              <Search size={15} aria-hidden="true" />
              <input
                type="search"
                value={keyword}
                placeholder="이름이나 이메일로 찾기"
                onChange={(event) => setKeyword(event.target.value)}
              />
            </label>
            <label className="grant-filter">
              <input type="checkbox" checked={onlyHolders} onChange={(event) => setOnlyHolders(event.target.checked)} />
              이수자만 보기
            </label>
          </div>

          <div className="grant-bulk">
            <span>보이는 {shown.length}명</span>
            <button type="button" className="text-button" onClick={() => toggleShown(true)}>모두 이수로</button>
            <button type="button" className="text-button" onClick={() => toggleShown(false)}>모두 해제</button>
          </div>

          <ul className="grant-people">
            {shown.length === 0 ? (
              <li className="companion-empty">찾는 부원이 없습니다.</li>
            ) : shown.map((person) => (
              <li key={person.id}>
                <label>
                  <input type="checkbox" checked={holders.has(person.id)} onChange={() => toggle(person.id)} />
                  {person.imageUrl
                    ? <Image src={media(person.imageUrl, 96, "eco")} alt="" width={30} height={30} unoptimized={!optimizable(person.imageUrl)} />
                    : <span className="pick-face" aria-hidden="true">{person.name.slice(0, 1)}</span>}
                  <ScrollingName name={person.name || "회원"} className="grant-name" />
                  <i>{person.email}</i>
                </label>
              </li>
            ))}
          </ul>

          <div className="admin-actions">
            <button className="button" type="button" disabled={busy || !dirty} onClick={submit}>
              <GraduationCap size={16} aria-hidden="true" />
              {busy ? "저장 중" : dirty ? `부여 ${added.length} · 회수 ${removed.length} 저장` : "바뀐 값 없음"}
            </button>
            {dirty && (
              <button className="button secondary" type="button" onClick={() => setHolders(new Set(saved))}>
                되돌리기
              </button>
            )}
          </div>
        </>
      )}
      {notice}
      {dialogNode}
    </div>
  );
}
