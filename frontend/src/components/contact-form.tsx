"use client";

import { Mail, Send } from "lucide-react";
import { FormEvent, useState } from "react";
import { ShapeSymbol } from "@/components/shape-symbol";

const recipient = "contact@example.com";

export function ContactForm() {
  const [name, setName] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    const body = [
      `보낸 사람: ${name || "미입력"}`,
      `회신 이메일: ${replyTo || "미입력"}`,
      "",
      message,
    ].join("\n");
    window.location.href = `mailto:${recipient}?subject=${encodeURIComponent(subject || "SHAPE 문의")}&body=${encodeURIComponent(body)}`;
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
        <button className="button" type="submit">
          보내기 <Send size={16} />
        </button>
      </form>
    </div>
  );
}
