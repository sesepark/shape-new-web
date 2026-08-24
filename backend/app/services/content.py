import bleach
from bleach.css_sanitizer import CSSSanitizer

# 편집기가 실제로 만들어 내는 태그는 모두 통과시켜야 합니다. 예전에는 형광펜
# (<mark>), 수평선, 코드 블록이 저장하는 순간 조용히 사라졌습니다.
ALLOWED_TAGS = [
    "p", "br", "strong", "b", "em", "i", "u", "s", "mark", "span",
    "h1", "h2", "h3", "ul", "ol", "li", "blockquote", "hr",
    "code", "pre", "a", "img",
]
ALLOWED_ATTRIBUTES = {
    "a": ["href", "target", "rel"],
    "img": ["src", "alt"],
    "span": ["style"],
    "mark": ["style", "data-color"],
    # 문단이나 사진을 사이에 끼워 번호 목록을 이어 쓰면 편집기가 <ol start="4">
    # 로 내보낸다. 이 값을 지우면 저장하는 순간 번호가 1 부터 다시 시작한다.
    "ol": ["start"],
}
ALLOWED_CSS = CSSSanitizer(allowed_css_properties=["color", "background-color", "font-size", "font-weight", "text-decoration"])


def sanitize_html(value: str) -> str:
    return bleach.clean(value, tags=ALLOWED_TAGS, attributes=ALLOWED_ATTRIBUTES, css_sanitizer=ALLOWED_CSS, protocols=["http", "https"], strip=True)
