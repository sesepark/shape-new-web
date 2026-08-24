"""Turn an external article or video link into something the site can show.

Most publishers send `X-Frame-Options: DENY`, so their pages cannot be placed in
an iframe. Video and social platforms publish dedicated embed URLs instead. This
module therefore does two things: recognise the platforms that can be embedded,
and for everything else read the Open Graph tags once so the article can be
shown as a preview card.
"""

import ipaddress
import re
import socket
from html.parser import HTMLParser
from urllib.parse import parse_qs, urlparse

import httpx

TIMEOUT = 5.0
MAX_BYTES = 512_000
USER_AGENT = "Mozilla/5.0 (compatible; SHAPEBot/1.0; +https://www.snu-shape.com)"

YOUTUBE_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "www.youtu.be"}
INSTAGRAM_HOSTS = {"instagram.com", "www.instagram.com"}
VIMEO_HOSTS = {"vimeo.com", "www.vimeo.com", "player.vimeo.com"}
YOUTUBE_ID = re.compile(r"^[\w-]{11}$")
INSTAGRAM_PATH = re.compile(r"^/(p|reel|tv)/([\w-]+)")


def embed_for(url: str) -> dict | None:
    """The iframe source for a platform that publishes one, otherwise None."""
    parsed = urlparse(url)
    host, path = parsed.netloc.lower(), parsed.path
    if host in YOUTUBE_HOSTS:
        video = parse_qs(parsed.query).get("v", [""])[0]
        if not video:
            video = path.rsplit("/", 1)[-1] if path.startswith(("/shorts/", "/embed/", "/live/")) or host.endswith("youtu.be") else ""
        if YOUTUBE_ID.match(video):
            return {"provider": "youtube", "src": f"https://www.youtube.com/embed/{video}", "ratio": "16 / 9"}
    if host in INSTAGRAM_HOSTS:
        match = INSTAGRAM_PATH.match(path)
        if match:
            return {"provider": "instagram", "src": f"https://www.instagram.com/{match.group(1)}/{match.group(2)}/embed", "ratio": "4 / 5"}
    if host in VIMEO_HOSTS:
        video = path.strip("/").split("/")[-1]
        if video.isdigit():
            return {"provider": "vimeo", "src": f"https://player.vimeo.com/video/{video}", "ratio": "16 / 9"}
    return None


def routable(host: str) -> bool:
    """Refuse loopback and private addresses so an admin URL cannot probe Render."""
    try:
        infos = socket.getaddrinfo(host, None)
    except OSError:
        return False
    for info in infos:
        address = ipaddress.ip_address(info[4][0])
        if address.is_private or address.is_loopback or address.is_link_local or address.is_reserved or address.is_multicast:
            return False
    return bool(infos)


class MetaReader(HTMLParser):
    """Collect the Open Graph and fallback tags, then stop at </head>."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.meta: dict[str, str] = {}
        self.title = ""
        self._in_title = False
        # 언론사 상당수가 발행일을 meta 가 아니라 JSON-LD 안에만 둔다.
        # 머리에 있는 ld+json 조각을 모아 두었다가 날짜만 뽑는다.
        self.json_ld: list[str] = []
        self._in_json_ld = False
        self.done = False

    def handle_starttag(self, tag, attrs):
        if self.done:
            return
        values = dict(attrs)
        if tag == "title":
            self._in_title = True
        elif tag == "script" and values.get("type", "").lower() == "application/ld+json":
            self._in_json_ld = True
            self.json_ld.append("")
        elif tag == "meta":
            key = (values.get("property") or values.get("name") or "").lower()
            content = values.get("content")
            if key and content and key not in self.meta:
                self.meta[key] = content.strip()

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False
        elif tag == "script":
            self._in_json_ld = False
        elif tag == "head":
            self.done = True

    def handle_data(self, data):
        if self._in_title and not self.title:
            self.title = data.strip()
        elif self._in_json_ld and self.json_ld:
            self.json_ld[-1] += data


# 언론사·플랫폼이 발행일을 담는 자리. 앞쪽이 더 믿을 만하다.
PUBLISHED_KEYS = (
    "article:published_time",
    "article:published",
    "og:article:published_time",
    "datepublished",
    "date",
    "dc.date.issued",
    "pubdate",
)
ISO_DATE = re.compile(r"\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?")


def read_published(reader: "MetaReader") -> str:
    """원문이 언제 나갔는지. 못 찾으면 빈 문자열.

    언론보도를 올릴 때 발행일을 손으로 옮겨 적으면 틀리기 쉬우므로, 원문에서
    읽어 관리자 화면의 날짜 칸에 채워 준다. meta 태그를 먼저 보고, 없으면
    JSON-LD 안의 `datePublished` 를 본다. 국내 언론사 상당수가 후자만 둔다.
    """
    for key in PUBLISHED_KEYS:
        raw = reader.meta.get(key)
        if raw and (found := ISO_DATE.search(raw)):
            return found.group(0)
    for block in reader.json_ld:
        match = re.search(r'"datePublished"\s*:\s*"([^"]+)"', block)
        if match and (found := ISO_DATE.search(match.group(1))):
            return found.group(0)
    return ""


def read_metadata(html: str, url: str) -> dict:
    reader = MetaReader()
    reader.feed(html)
    meta = reader.meta
    site = meta.get("og:site_name") or urlparse(url).netloc.removeprefix("www.")
    return {
        "title": meta.get("og:title") or meta.get("twitter:title") or reader.title or url,
        "description": meta.get("og:description") or meta.get("twitter:description") or meta.get("description") or "",
        "image": meta.get("og:image") or meta.get("twitter:image") or "",
        "siteName": site,
        "publishedAt": read_published(reader),
    }


async def build(url: str | None) -> dict:
    """Everything the article page needs to render the link, fetched once."""
    if not url:
        return {}
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return {"status": "invalid", "url": url}
    embed = embed_for(url)
    if not routable(parsed.hostname or ""):
        return {"status": "embed", "url": url, "embed": embed} if embed else {"status": "unreachable", "url": url}
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=True, max_redirects=4, headers={"User-Agent": USER_AGENT, "Accept-Language": "ko,en;q=0.8"}) as client:
            async with client.stream("GET", url) as response:
                response.raise_for_status()
                if "html" not in response.headers.get("content-type", ""):
                    return {"status": "embed", "url": url, "embed": embed} if embed else {"status": "unsupported", "url": url}
                body = b""
                async for chunk in response.aiter_bytes():
                    body += chunk
                    if len(body) >= MAX_BYTES:
                        break
                html = body.decode(response.encoding or "utf-8", errors="replace")
    except (httpx.HTTPError, UnicodeDecodeError):
        # 영상·인스타그램은 페이지를 못 읽어도 화면 안에서 재생할 수 있다.
        return {"status": "embed", "url": url, "embed": embed} if embed else {"status": "unreachable", "url": url}
    meta = read_metadata(html, url)
    if embed:
        # 재생은 embed 가 맡고, 발행일만 페이지에서 가져와 날짜 칸을 채운다.
        return {"status": "embed", "url": url, "embed": embed, "publishedAt": meta["publishedAt"]}
    return {"status": "card", "url": url, **meta}
