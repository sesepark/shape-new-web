"""부원 카드에서 '팀' 항목을 지웁니다.

부원을 Reasoning·Navigation 같은 기술 팀으로 나누던 구분을 쓰지 않기로 했습니다.
카드는 JSON 으로 저장되어 있어 화면에서 안 보이게 하는 것만으로는 값이 남습니다.
남은 값은 나중에 다시 새어 나오므로 여기서 실제로 지웁니다.

    python scripts/drop_member_team.py          # 무엇이 바뀌는지만 봅니다
    python scripts/drop_member_team.py --apply  # 실제로 저장합니다
"""

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select  # noqa: E402

from app.database import SessionLocal  # noqa: E402
from app.models import ContentPage  # noqa: E402


async def main(apply: bool) -> None:
    async with SessionLocal() as db:
        page = await db.scalar(select(ContentPage).where(ContentPage.slug == "members"))
        if not page:
            print("부원 페이지가 없습니다.")
            return
        cards = page.content_json.get("members", [])
        having = [card for card in cards if "team" in card]
        print(f"부원 카드 {len(cards)}장 중 팀이 적힌 카드 {len(having)}장")
        if apply and having:
            # JSON 칸은 제자리에서 고치면 저장되지 않는다. 새 목록으로 갈아 끼운다.
            page.content_json = {
                **page.content_json,
                "members": [{key: value for key, value in card.items() if key != "team"} for card in cards],
            }
            await db.commit()
            print("지웠습니다.")
        elif having:
            print("실제로 저장하려면 --apply 를 붙이세요.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="실제로 저장합니다")
    asyncio.run(main(parser.parse_args().apply))
