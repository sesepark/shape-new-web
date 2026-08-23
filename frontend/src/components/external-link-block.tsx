import { ExternalLink, Play } from "lucide-react";
import type { LinkPreview } from "@/lib/types";

const providerLabel: Record<string, string> = { youtube: "YouTube", instagram: "Instagram", vimeo: "Vimeo" };

function OpenOriginal({ url, label = "원문 보러가기" }: { url: string; label?: string }) {
  return (
    <a className="external-open" href={url} target="_blank" rel="noreferrer">
      {label} <ExternalLink size={15} />
    </a>
  );
}

export function ExternalLinkBlock({ url, preview }: { url: string; preview?: LinkPreview }) {
  if (preview?.status === "embed" && preview.embed) {
    const { provider, src, ratio } = preview.embed;
    return (
      <section className="external-embed" aria-label={`${providerLabel[provider] ?? "외부"} 콘텐츠`}>
        <div className="external-embed-frame" style={{ aspectRatio: ratio }}>
          <iframe
            src={src}
            title={`${providerLabel[provider] ?? "외부"} 콘텐츠`}
            loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
        </div>
        <div className="external-embed-foot">
          <span><Play size={14} /> {providerLabel[provider] ?? "외부 콘텐츠"}</span>
          <OpenOriginal url={url} label="원본에서 보기" />
        </div>
      </section>
    );
  }

  if (preview?.status === "card") {
    return (
      <section className="external-card" aria-label="원문 미리보기">
        <a href={url} target="_blank" rel="noreferrer">
          {preview.image ? (
            // The thumbnail comes from whichever publisher was linked, so it is
            // served straight from their CDN rather than through next/image.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview.image} alt="" loading="lazy" referrerPolicy="no-referrer" />
          ) : (
            <div className="external-card-blank" aria-hidden="true">LINK</div>
          )}
          <div>
            <small>{preview.siteName}</small>
            <strong>{preview.title}</strong>
            {preview.description && <p>{preview.description}</p>}
          </div>
        </a>
        <div className="external-embed-foot">
          <span>기사 미리보기</span>
          <OpenOriginal url={url} />
        </div>
      </section>
    );
  }

  return (
    <a className="external-preview public" href={url} target="_blank" rel="noreferrer">
      <small>EXTERNAL LINK</small>
      <strong>{url}</strong>
      <span>링크 열기 <ExternalLink size={16} /></span>
    </a>
  );
}
