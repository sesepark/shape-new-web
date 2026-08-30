"use client";

/**
 * 뿌리 레이아웃 자체가 무너졌을 때만 뜨는 마지막 화면.
 *
 * 이 쪽은 레이아웃을 대신하므로 `<html>` 과 `<body>` 를 스스로 그려야 하고,
 * **전역 스타일이 닿지 않습니다.** 그래서 글자 모양을 인라인으로 적습니다.
 * 클라이언트 컴포넌트라 `metadata` 를 쓸 수 없어 제목은 React 의 `<title>` 로
 * 답니다(Next 16 문서에 적힌 방법입니다).
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="ko">
      <body style={{ margin: 0, minHeight: "100svh", display: "grid", placeItems: "center", padding: 24, background: "#fff", color: "#20242b", fontFamily: '"Apple SD Gothic Neo","Noto Sans KR",Arial,sans-serif' }}>
        <title>문제가 생겼습니다 | SHAPE</title>
        <div style={{ maxWidth: 420, textAlign: "center" }}>
          <p style={{ margin: "0 0 12px", color: "#2855f3", fontWeight: 900, fontSize: 13, letterSpacing: ".08em" }}>SHAPE</p>
          <h1 style={{ margin: "0 0 12px", fontSize: 24, letterSpacing: "-.04em" }}>문제가 생겼습니다</h1>
          <p style={{ margin: "0 0 24px", lineHeight: 1.7, color: "#5b6270" }}>
            사이트를 여는 중에 오류가 났습니다. 다시 시도해 주세요.
            {error.digest && <><br />오류 번호: {error.digest}</>}
          </p>
          <button
            type="button"
            onClick={() => retry()}
            style={{ padding: "12px 24px", minHeight: 44, border: 0, borderRadius: 999, background: "#111", color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer" }}
          >
            다시 시도
          </button>
        </div>
      </body>
    </html>
  );
}
