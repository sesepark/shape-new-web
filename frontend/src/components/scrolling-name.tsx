"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 자리에 다 들어가지 않는 이름을 그 자리 안에서 가로로 흘려 보여 줍니다.
 *
 * 이름은 구글 계정에 적힌 값을 그대로 쓰기 때문에 길이를 우리가 정할 수
 * 없습니다. 실제로 "김○○/ 학생/ 바이오시스템·소재학부" 처럼 소속까지 적어 둔
 * 분이 있었고, 그 이름이 머리글의 이름 캡슐 안에서 세 줄로 접히면서 머리글
 * 전체가 무너졌습니다(로그아웃 글자까지 세로로 쌓였습니다).
 *
 * 캡슐을 늘리거나 글씨를 줄이는 대신, 자리 크기는 그대로 두고 넘치는 이름만
 * 움직이게 합니다. **넘치지 않는 이름은 아무 일도 일어나지 않으므로** 대부분의
 * 사람에게는 지금과 똑같이 보이고, 목록에 이름표가 여러 개 놓여도 평소에는
 * 아무것도 움직이지 않습니다.
 *
 * 흐르는 속도는 이름 길이에 비례해 정합니다 — 길이에 상관없이 같은 시간을 주면
 * 긴 이름일수록 빨라져서 읽을 수 없습니다.
 *
 * 폭은 쓰는 쪽에서 `--name-max` 로 정합니다(기본 150px). 자세한 스타일은
 * `globals.css` 의 `.scrolling-name` 을 보세요.
 */

// 한 바퀴 돌 때 앞뒤 사본 사이에 두는 빈칸. CSS 의 .scrolling-name-track gap 과
// 같은 값이어야 이어 붙인 자리가 티 나지 않습니다.
const NAME_GAP_PX = 28;
const NAME_SCROLL_PX_PER_SECOND = 26;

export function ScrollingName({ name, className }: { name: string; className?: string }) {
  const box = useRef<HTMLSpanElement>(null);
  // 한 바퀴에 옮길 거리(px). 0 이면 자리 안에 다 들어가는 이름이라 멈춰 있습니다.
  const [shift, setShift] = useState(0);

  const measure = useCallback(() => {
    const element = box.current;
    const first = element?.firstElementChild?.firstElementChild as HTMLElement | null;
    if (!element || !first) return;
    // 사본과의 빈칸은 track 의 gap 이라 first 의 폭에 섞이지 않습니다. 그래서
    // 흐르는 중에 다시 재도 같은 값이 나옵니다.
    const overflow = first.scrollWidth - element.clientWidth;
    setShift(overflow > 1 ? first.scrollWidth + NAME_GAP_PX : 0);
  }, []);

  useEffect(() => {
    measure();
    // 글꼴이 늦게 오면 글자 폭이 달라집니다. 그때 한 번 더 잽니다.
    document.fonts?.ready.then(measure).catch(() => {});
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure, name]);

  const scrolling = shift > 0;
  return (
    <span
      className={`scrolling-name${scrolling ? " is-scrolling" : ""}${className ? ` ${className}` : ""}`}
      ref={box}
      title={name}
      style={
        scrolling
          ? ({
              "--name-shift": `${shift}px`,
              "--name-duration": `${(shift / NAME_SCROLL_PX_PER_SECOND).toFixed(1)}s`,
            } as React.CSSProperties)
          : undefined
      }
    >
      <span className="scrolling-name-track">
        <span>{name}</span>
        {scrolling && <span aria-hidden="true">{name}</span>}
      </span>
    </span>
  );
}
