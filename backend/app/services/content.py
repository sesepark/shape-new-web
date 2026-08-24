import re

import bleach
from bleach.css_sanitizer import CSSSanitizer

# 편집기가 실제로 만들어 내는 태그는 모두 통과시켜야 합니다. 예전에는 형광펜
# (<mark>), 수평선, 코드 블록이 저장하는 순간 조용히 사라졌습니다.
ALLOWED_TAGS = [
    "p", "br", "strong", "b", "em", "i", "u", "s", "mark", "span", "sub", "sup",
    "h1", "h2", "h3", "ul", "ol", "li", "blockquote", "hr",
    "code", "pre", "a", "img",
    # 표. 편집기가 네 조각(표·줄·머리칸·칸)을 그대로 내보냅니다.
    "table", "thead", "tbody", "tr", "th", "td", "colgroup", "col",
    # 수식 한 덩이. 안에는 LaTeX 원문만 들어 있고, 그리는 일은 화면이 합니다.
    "div",
]
ALLOWED_ATTRIBUTES = {
    "a": ["href", "target", "rel"],
    # 정렬과 줄 간격은 style 로 나갑니다. 아래 ALLOWED_CSS 가 값을 다시 거릅니다.
    "p": ["style"],
    "h1": ["style"],
    "h2": ["style"],
    "h3": ["style"],
    # 표는 칸 합치기와 열 너비를 함께 저장해야 모양이 유지됩니다.
    "table": ["style"],
    "th": ["colspan", "rowspan", "colwidth", "style"],
    "td": ["colspan", "rowspan", "colwidth", "style"],
    "col": ["style"],
    # 수식은 원문을 담는 칸 하나뿐입니다. class 는 화면에서 찾을 때 씁니다.
    "div": ["data-math", "class"],
    # 본문 사진은 화면에 들어올 때 받습니다. 긴 글에서 아래쪽 사진까지 미리
    # 받으면 데이터만 쓰고 아무도 보지 않는 경우가 많습니다.
    "img": ["src", "alt", "loading", "decoding"],
    "span": ["style"],
    "mark": ["style", "data-color"],
    # 문단이나 사진을 사이에 끼워 번호 목록을 이어 쓰면 편집기가 <ol start="4">
    # 로 내보낸다. 이 값을 지우면 저장하는 순간 번호가 1 부터 다시 시작한다.
    "ol": ["start"],
}
ALLOWED_CSS = CSSSanitizer(allowed_css_properties=[
    "color", "background-color", "font-size", "font-weight", "text-decoration",
    # 글쓰기 도구의 정렬·줄 간격·표 열 너비.
    "text-align", "line-height", "width", "min-width",
])


# Cloudinary 주소에서 원본이 그대로 나가는 자리를 찾습니다.
# .../image/upload/v1787.../shape/news/파일.jpg  ← 변환 지시가 없는 주소
CLOUDINARY_UPLOAD = re.compile(r"(https://res\.cloudinary\.com/[^/\s\"\']+/image/upload/)([^\s\"\']+)")
# 이미 c_limit,w_1400 같은 지시가 붙어 있으면 건드리지 않습니다.
ALREADY_TRANSFORMED = re.compile(r"^[a-z]{1,2}_[^/]*/")
# 본문 사진에 걸 지시. f_auto 는 브라우저가 받는 형식(WebP/AVIF)을 고르고,
# q_auto 는 눈에 띄지 않는 선까지 압축하며, c_limit,w_1400 은 원본이 더 크면
# 가로 1400px 로 줄입니다. 원본은 그대로 두고 전달본만 바뀝니다.
BODY_IMAGE_TRANSFORM = "f_auto,q_auto,c_limit,w_1400/"


def deliver_smaller(html: str) -> str:
    """본문에 박힌 Cloudinary 사진을 줄여서 내보내도록 주소를 고칩니다.

    편집기는 업로드가 끝나면 받은 주소를 그대로 <img src> 에 넣습니다. 그 주소는
    원본이라, 휴대폰으로 찍은 3MB 짜리 사진이 글을 여는 사람마다 그대로 나갑니다.
    실제로 올라와 있는 소식 5장의 원본 합계가 8.5MB 였고, 같은 사진을 변환해서
    보내면 0.46MB 였습니다(95% 절감). 무료 티어에서 먼저 차는 것이 전송량이므로
    이 차이가 그대로 요금제 수명이 됩니다.

    표지 사진은 화면 쪽에서 이미 같은 방식으로 줄여 보내고 있고, 본문만 빠져
    있었습니다. 여기서 한 번 고쳐 두면 저장하는 모든 글에 적용됩니다.
    """

    def fix(match: re.Match[str]) -> str:
        head, tail = match.group(1), match.group(2)
        if ALREADY_TRANSFORMED.match(tail):
            return match.group(0)
        return f"{head}{BODY_IMAGE_TRANSFORM}{tail}"

    return CLOUDINARY_UPLOAD.sub(fix, html)


def lazy_images(html: str) -> str:
    """본문 사진을 화면에 들어올 때 받도록 표시합니다."""
    return re.sub(r"<img (?![^>]*\bloading=)", '<img loading="lazy" decoding="async" ', html)


def sanitize_html(value: str) -> str:
    cleaned = bleach.clean(value, tags=ALLOWED_TAGS, attributes=ALLOWED_ATTRIBUTES, css_sanitizer=ALLOWED_CSS, protocols=["http", "https"], strip=True)
    return lazy_images(deliver_smaller(cleaned))
