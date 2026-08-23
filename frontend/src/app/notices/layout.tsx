/**
 * 게시판은 로그인한 회원만 보는 화면이라 페이지 본문이 클라이언트 컴포넌트입니다.
 * 그런 페이지도 브라우저 탭 제목은 있어야 하므로 메타데이터만 레이아웃에서 붙입니다.
 */
export const metadata = {
  title: { default: "게시판", template: "%s | SHAPE" },
  description: "SHAPE 승인 회원이 이용하는 내부 게시판입니다.",
  robots: { index: false, follow: false },
};

export default function NoticesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
