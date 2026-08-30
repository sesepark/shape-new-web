"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * 쪽을 그리다 예기치 못한 오류가 났을 때 대신 뜨는 화면.
 *
 * 이 파일이 없으면 Next 의 기본 오류 화면이 뜹니다 — 개발 중에는 자세한 내용이
 * 나오지만 운영에서는 영문 한 줄만 남고 돌아갈 곳이 없습니다.
 *
 * 오류 경계는 반드시 클라이언트 컴포넌트여야 합니다. 되살리는 함수 이름이
 * Next 16 에서 `reset` 이 아니라 **`retry`** 입니다
 * (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md`).
 */
export default function RouteError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    // 따로 보내는 곳은 두지 않습니다. Vercel 이 서버 쪽 오류를 이미 모으고,
    // 외부 수집 서비스를 붙이면 무료 티어 밖의 비용이 생깁니다.
    console.error(error);
  }, [error]);
  return (
    <main>
      <section className="page-content" id="content">
        <h1 className="content-title">화면을 그리지 못했습니다</h1>
        <div className="empty-state">
          <h2>잠시 뒤에 다시 시도해 주세요</h2>
          <p>
            일시적인 문제일 수 있습니다. 다시 눌러도 같으면 운영진에게 알려 주세요.
            {error.digest && <><br /><small className="field-hint">오류 번호: {error.digest}</small></>}
          </p>
          <div className="notfound-links">
            <button className="button" type="button" onClick={() => retry()}>다시 시도</button>
            <Link className="button secondary" href="/">홈으로</Link>
            <Link className="button secondary" href="/contact">문의하기</Link>
          </div>
        </div>
      </section>
    </main>
  );
}
