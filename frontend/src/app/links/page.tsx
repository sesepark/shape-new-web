import { LinkCards } from "@/components/link-cards";
import { PageShell } from "@/components/page-shell";
import { api, listOrEmpty } from "@/lib/api";

export const metadata = { title: "관련 링크" };

export default async function LinksPage() {
  // 쿠키 없이 부르므로 여기서 오는 것은 전체 공개 링크뿐입니다. 부원·운영진
  // 전용 링크는 로그인한 사람의 브라우저가 다시 물어 채웁니다(LinkCards).
  const links = await listOrEmpty(api.links());
  return (
    <PageShell eyebrow="QUICK ACCESS" title="바로가기" contentTitle="관련 링크">
      <LinkCards initial={links} />
    </PageShell>
  );
}
