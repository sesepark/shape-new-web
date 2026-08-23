"use client";

import { BadgeCheck, X } from "lucide-react";
import { useState } from "react";

export function LicenseCard({ name, eligible }: { name: string; eligible: boolean }) {
  const [open, setOpen] = useState(false);
  return <><button type="button" className="license-view-button" onClick={() => setOpen(true)}>라이선스 카드 보기</button>{open && <div className="license-dialog" role="dialog" aria-modal="true" aria-label={`${name} 라이선스 카드`} onClick={() => setOpen(false)}><section className="license-dialog-panel" onClick={(event) => event.stopPropagation()}><button type="button" className="license-close" onClick={() => setOpen(false)} aria-label="닫기"><X size={18} /></button><div className="license-card" onPointerMove={(event) => { const rect = event.currentTarget.getBoundingClientRect(); event.currentTarget.style.setProperty("--rx", `${((event.clientY - rect.top) / rect.height - .5) * -10}deg`); event.currentTarget.style.setProperty("--ry", `${((event.clientX - rect.left) / rect.width - .5) * 12}deg`); event.currentTarget.style.setProperty("--px", `${((event.clientX - rect.left) / rect.width) * 100}%`); event.currentTarget.style.setProperty("--py", `${((event.clientY - rect.top) / rect.height) * 100}%`); }} onPointerLeave={(event) => { event.currentTarget.style.setProperty("--rx", "0deg"); event.currentTarget.style.setProperty("--ry", "0deg"); }}><span>SHAPE EQUIPMENT LICENSE</span><BadgeCheck size={44} /><strong>{name}</strong><small>{eligible ? "AUTHORIZED MEMBER" : "TRAINING REQUIRED"}</small><em>서울대학교 Physical AI 동아리</em></div><p>{eligible ? "이 라이선스로 연결된 장비를 예약할 수 있습니다." : "장비 사용 전 운영진의 교육 및 라이선스 승인이 필요합니다."}</p></section></div>}</>;
}
