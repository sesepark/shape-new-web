"use client";

import Link from "next/link";
import { useState, type ComponentProps, type FocusEvent, type MouseEvent } from "react";

/**
 * 마우스를 올렸을 때만 미리 받아 오는 링크.
 *
 * Next.js 는 화면에 들어온 `<Link>` 를 모두 미리 받아 둡니다. 머리글과 전체
 * 메뉴에 사이트의 거의 모든 주소가 들어 있어서, 그대로 두면 한 쪽을 열 때마다
 * 마흔 건 넘는 요청이 나갑니다. 무료 요금제에서 가장 먼저 차는 것이 전송량이
 * 아니라 요청 수라, 이 낭비가 곧 한도입니다.
 *
 * 대신 마우스를 올리거나 키보드 초점이 닿은 링크만 받아 옵니다. 누를 가능성이
 * 있는 것만 준비하므로 체감 속도는 그대로이고, 손가락으로 쓰는 화면에서는
 * 눌렀을 때 받아 오는데 공개 페이지가 전부 정적이라 충분히 빠릅니다.
 *
 * Next.js 문서가 안내하는 방식 그대로입니다.
 */
export function HoverPrefetchLink({ children, onMouseEnter, onFocus, ...props }: ComponentProps<typeof Link>) {
  const [warm, setWarm] = useState(false);
  return (
    <Link
      {...props}
      prefetch={warm ? null : false}
      onMouseEnter={(event: MouseEvent<HTMLAnchorElement>) => {
        setWarm(true);
        onMouseEnter?.(event);
      }}
      onFocus={(event: FocusEvent<HTMLAnchorElement>) => {
        setWarm(true);
        onFocus?.(event);
      }}
    >
      {children}
    </Link>
  );
}
