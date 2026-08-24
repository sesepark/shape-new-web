import { ExternalLink } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageShell } from "@/components/page-shell";
import { api, listOrEmpty } from "@/lib/api";

export const metadata = { title: "관련 링크" };

export default async function LinksPage() {
  const links = await listOrEmpty(api.links());
  return (
    <PageShell eyebrow="QUICK ACCESS" title="바로가기" contentTitle="관련 링크">
      {links.length === 0 ? (
        <EmptyState
          title="등록된 링크가 없습니다"
          description="운영진이 Drive, Notion, GitHub 등의 링크를 등록할 수 있습니다."
        />
      ) : (
        <div className="grid three">
          {links.map((item) => (
            <a
              className="card"
              href={item.url}
              target="_blank"
              rel="noreferrer"
              key={item.id}
            >
              <span className="meta">SHAPE LINK</span>
              <h3>{item.title}</h3>
              <p>{item.description}</p>
              <span className="card-action">
                새 창에서 열기 <ExternalLink size={14} />
              </span>
            </a>
          ))}
        </div>
      )}
    </PageShell>
  );
}
