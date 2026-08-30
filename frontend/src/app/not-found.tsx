import Link from "next/link";
import { PageShell } from "@/components/page-shell";

// `metadata` 를 두지 않습니다. Next 16 문서상 `not-found.js` 에서 지원되는 것은
// `global-not-found.js` 쪽이고, 404 로 나가는 쪽에는 Next 가 `noindex` 를 스스로
// 붙여 줍니다. 지원되지 않는 것을 적어 두면 조용히 무시되어 읽는 사람을 속입니다.

/**
 * 주소를 잘못 찾아온 사람에게 보여 주는 쪽.
 *
 * 이 파일이 없으면 Next 가 자기 기본 화면을 그립니다 — 한국어 사이트 한가운데
 * **"404 | This page could not be found."** 영문 한 줄이 뜨고, 돌아갈 링크가
 * 하나도 없습니다.
 *
 * 실제로 밟히는 길입니다. 지운 소식 글의 옛 주소가 카톡·인스타에 남아 있고,
 * 검색 결과에도 한동안 남습니다.
 */
export default function NotFound() {
  return (
    <PageShell eyebrow="PAGE NOT FOUND" title="SHAPE" contentTitle="쪽을 찾을 수 없습니다">
      <div className="empty-state">
        <h2>주소가 바뀌었거나 지워진 쪽입니다</h2>
        <p>
          링크를 다른 곳에서 받아 오셨다면 그 사이에 글이 내려갔을 수 있습니다.
          아래에서 찾으시는 곳으로 가 주세요.
        </p>
        <div className="notfound-links">
          <Link className="button" href="/">홈으로</Link>
          <Link className="button secondary" href="/news">소식</Link>
          <Link className="button secondary" href="/equipment">장비 예약</Link>
          <Link className="button secondary" href="/contact">문의하기</Link>
        </div>
      </div>
    </PageShell>
  );
}
