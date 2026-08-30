"use client";

import { Check, Copy, Mail, Send } from "lucide-react";
import { FormEvent, useState } from "react";
import { API_URL } from "@/lib/api";
import { ShapeSymbol } from "@/components/shape-symbol";

const recipient = "contact@example.com";

/**
 * 문의 폼.
 *
 * 예전에는 `mailto:` 를 열었습니다. 메일 앱이 걸려 있지 않은 기기 — 브라우저에서
 * Gmail 만 쓰는 학생 대부분 — 에서는 보내기를 눌러도 **아무 일도 일어나지
 * 않았습니다.** 오류도 안내도 없이, 네 칸을 채운 사람은 보냈다고 생각하고
 * 떠났습니다. 가입 문의가 들어오는 창구라 조용히 사라지는 것이 제일 곤란합니다.
 *
 * 지금은 서버에 담고 운영진이 관리자 화면의 '문의' 탭에서 봅니다. 보내지 못했을
 * 때는 **적은 내용을 지우지 않고** 메일 주소로 직접 보낼 수 있게 안내합니다 —
 * 실패한 화면에서 사람이 다시 타이핑하게 만들면 그냥 떠납니다.
 */
export function ContactForm() {
  const [name, setName] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  // 사람 눈에는 안 보이는 칸. 자동 프로그램은 폼의 모든 칸을 채우므로 여기에
  // 무언가 들어오면 사람이 쓴 것이 아닙니다. 서버가 같은 기준으로 거릅니다.
  const [website, setWebsite] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const [copied, setCopied] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (state === "sending") return;
    setState("sending");
    const response = await fetch(`${API_URL}/contact`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, replyTo, subject, message, website }),
    }).catch(() => null);
    if (!response?.ok) { setState("failed"); return; }
    setState("sent");
    setName(""); setReplyTo(""); setSubject(""); setMessage("");
  }

  /** 보내지 못했을 때, 적은 내용을 그대로 들고 메일 앱으로 넘어가는 길. */
  const mailto = `mailto:${recipient}?subject=${encodeURIComponent(subject || "SHAPE 문의")}&body=${encodeURIComponent(
    [`보낸 사람: ${name || "미입력"}`, `회신 이메일: ${replyTo || "미입력"}`, "", message].join("\n"),
  )}`;

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(recipient);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // 클립보드가 막힌 곳(안전하지 않은 연결 등)에서는 주소가 화면에 그대로
      // 적혀 있으므로 눈으로 보고 옮겨 적으면 됩니다.
    }
  }

  return (
    <div className="contact-layout">
      <aside className="contact-card">
        <span>DIRECT CONTACT</span>
        <div className="contact-brand-lockup">
          <ShapeSymbol className="contact-symbol" />
          <h3>
            <strong>SHAPE</strong>
            <span>Together</span>
          </h3>
        </div>
        <p>동아리 가입, 프로젝트 협업, 장비 및 행사 관련 문의를 환영합니다.</p>
        <a href={`mailto:${recipient}`}>
          <Mail size={18} /> {recipient}
        </a>
      </aside>
      {state === "sent" ? (
        <div className="contact-form contact-sent">
          <Check size={34} aria-hidden="true" />
          <h3>문의를 보냈습니다</h3>
          <p>
            운영진이 확인한 뒤 적어 주신 회신 이메일로 답을 드립니다. 급한 일이면
            <a href={`mailto:${recipient}`}> {recipient}</a> 으로 직접 보내 주셔도 됩니다.
          </p>
          <button className="button secondary" type="button" onClick={() => setState("idle")}>
            문의 하나 더 보내기
          </button>
        </div>
      ) : (
        <form className="contact-form" onSubmit={submit}>
          <div className="contact-form-row">
            <label>
              이름
              <input
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="이름"
                maxLength={80}
                autoComplete="name"
              />
            </label>
            <label>
              회신 이메일
              <input
                required
                type="email"
                value={replyTo}
                onChange={(event) => setReplyTo(event.target.value)}
                placeholder="you@example.com"
                maxLength={200}
                autoComplete="email"
              />
            </label>
          </div>
          <label>
            제목
            <input
              required
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              placeholder="문의 제목"
              maxLength={160}
            />
          </label>
          <label>
            내용
            <textarea
              required
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="문의 내용을 입력해 주세요."
              maxLength={3000}
            />
          </label>
          {/* 사람에게는 보이지 않는 칸입니다. 읽어 주는 기계도 건너뛰도록
              aria-hidden 과 tabIndex 를 함께 둡니다. 숨기는 방법은 이미 있는
              `.sr-only` 를 그대로 씁니다 — 감사 스크립트가 건너뛰는 이름이라
              "잘린 글" 로 잘못 잡히지 않습니다. */}
          <div className="sr-only contact-trap" aria-hidden="true">
            <label>
              이 칸은 비워 두세요
              <input
                value={website}
                onChange={(event) => setWebsite(event.target.value)}
                tabIndex={-1}
                autoComplete="off"
              />
            </label>
          </div>
          <button className="button" type="submit" disabled={state === "sending"}>
            {state === "sending" ? "보내는 중…" : "보내기"} <Send size={16} />
          </button>
          {state === "failed" && (
            <div className="save-notice danger contact-failed">
              <p>
                <b>문의를 보내지 못했습니다.</b> 적으신 내용은 그대로 있습니다. 다시 눌러 보시고,
                계속 안 되면 아래로 직접 보내 주세요.
              </p>
              <div className="inline-actions">
                <a className="button small" href={mailto}>메일 앱으로 보내기</a>
                <button className="button secondary small" type="button" onClick={copyAddress}>
                  {copied ? <><Check size={14} /> 주소 복사됨</> : <><Copy size={14} /> {recipient} 복사</>}
                </button>
              </div>
            </div>
          )}
        </form>
      )}
    </div>
  );
}
