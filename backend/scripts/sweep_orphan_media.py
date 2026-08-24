"""아무도 가리키지 않는 Cloudinary 파일을 찾아 지웁니다.

서버가 한 시간에 한 번 알아서 돌지만(`app/services/media_sweep.py`), 무료 요금제라
조용한 시간에는 서버가 잠들어 있어 며칠씩 안 돌 수도 있습니다. 한 번에 정리하고
싶거나 무엇이 지워질지 눈으로 확인하고 싶을 때 이 스크립트를 씁니다.

    python scripts/sweep_orphan_media.py            # 무엇이 지워질지만 보여 줍니다
    python scripts/sweep_orphan_media.py --apply    # 실제로 지웁니다
    python scripts/sweep_orphan_media.py --grace 0  # 방금 올라온 것까지 포함합니다

예약 사진(`shape/reservation/`)은 활동 기록이라 대상에서 빠집니다. 올라온 지
하루가 안 된 파일도 기본으로 빠집니다 — 사진은 저장 버튼보다 먼저 올라가므로,
아직 저장하지 않은 것과 고아를 구별할 수 없기 때문입니다.
"""

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import SessionLocal  # noqa: E402
from app.services.media_sweep import sweep  # noqa: E402


async def main(apply: bool, grace: int | None) -> None:
    async with SessionLocal() as db:
        orphans, removed = await sweep(db, apply=apply, grace_hours=grace)

    if not orphans:
        print("아무도 안 쓰는 파일이 없습니다.")
        return

    by_folder: dict[str, list[dict]] = {}
    for item in orphans:
        by_folder.setdefault("/".join(item["public_id"].split("/")[:2]), []).append(item)
    for folder, rows in sorted(by_folder.items(), key=lambda pair: -sum(row["bytes"] for row in pair[1])):
        print(f"\n  {folder}  {len(rows)}개 · {sum(row['bytes'] for row in rows) / 1024:.0f}KB")
        for row in sorted(rows, key=lambda row: -row["bytes"]):
            print(f"    {row['public_id'].split('/')[-1]:24s} {row['bytes'] / 1024:7.0f}KB  {row['created_at'][:10]}")

    total = sum(item["bytes"] for item in orphans) / 1024
    if apply:
        print(f"\n{len(orphans)}개 중 {removed}개를 지웠습니다 ({total:.0f}KB).")
    else:
        print(f"\n지울 수 있는 파일 {len(orphans)}개 · {total:.0f}KB · 실제로 지우려면 --apply 를 붙이세요.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--apply", action="store_true", help="실제로 지웁니다")
    parser.add_argument("--grace", type=int, default=None, help="올라온 지 이 시간이 안 된 파일은 건드리지 않습니다 (기본 24)")
    arguments = parser.parse_args()
    asyncio.run(main(arguments.apply, arguments.grace))
