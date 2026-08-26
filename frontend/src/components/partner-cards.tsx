"use client";

import Image from "next/image";
import type { PointerEvent } from "react";
import { partners } from "@/lib/partners";

/**
 * 마우스를 따라 얕게 기우는 정도(도).
 *
 * 라이선스 카드(`components/license-card.tsx`)는 같은 방식으로 ±10~12도까지
 * 기울지만, 그쪽은 홀로그램 카드 자체가 볼거리입니다. 여기는 글을 읽는 카드라
 * 그만큼 기울면 문장이 따라 흔들려 읽기 어려워집니다. 손을 얹었다는 것만
 * 알아챌 만큼만 둡니다.
 */
const TILT = 4;

function track(event: PointerEvent<HTMLElement>) {
  // 손가락에는 '따라올 커서'가 없습니다. 탭하면 한 번 기울었다가 떼어도
  // onPointerLeave 가 오지 않아 그대로 굳습니다. 마우스류만 받습니다.
  if (event.pointerType !== "mouse") return;
  const card = event.currentTarget;
  const rect = card.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width;
  const y = (event.clientY - rect.top) / rect.height;
  card.style.setProperty("--rx", `${(y - 0.5) * -TILT}deg`);
  card.style.setProperty("--ry", `${(x - 0.5) * TILT}deg`);
  card.style.setProperty("--px", `${x * 100}%`);
  card.style.setProperty("--py", `${y * 100}%`);
  card.style.setProperty("--glow", "1");
}

function rest(event: PointerEvent<HTMLElement>) {
  const card = event.currentTarget;
  card.style.setProperty("--rx", "0deg");
  card.style.setProperty("--ry", "0deg");
  card.style.setProperty("--glow", "0");
}

/**
 * 협력기관 카드 목록.
 *
 * 카드를 눌러 갈 곳이 없으므로 `<a>` 가 아니라 `<article>` 입니다. 눌리는 것처럼
 * 보이는데 아무 일도 일어나지 않으면, 특히 화면 낭독기를 쓰는 사람에게 링크가
 * 고장 난 것으로 읽힙니다.
 *
 * 스크롤에 맞춰 하나씩 떠오르는 것은 `components/scroll-reveal.tsx` 가 맡습니다
 * (`PageShell` 이 이미 감싸 두었고, 그쪽 선택자 목록에 `.partner-card` 를
 * 넣어 두었습니다). 여기서 따로 관찰자를 만들지 않습니다.
 *
 * ## 껍데기가 두 겹인 이유
 *
 * 떠오르는 애니메이션과 기우는 애니메이션이 **둘 다 `transform` 을 씁니다.** 한
 * 요소에 얹으면 나중에 적힌 규칙이 앞의 것을 통째로 지워, 카드가 아예 안 떠오르거나
 * 기울지 않습니다. 그래서 바깥 `.partner-card` 는 떠오르기(ScrollReveal 이 잡는
 * 자리)만, 안쪽 `.partner-card-inner` 는 기울기만 맡습니다. 커서 위치를 담는 CSS
 * 변수는 바깥에 적어도 안쪽으로 그대로 물려 내려갑니다.
 */
export function PartnerCards() {
  return (
    <div className="partner-grid">
      {partners.map((partner) => (
        <article
          className="partner-card"
          data-mark={partner.logo ? "on" : "off"}
          key={`${partner.owner ?? ""}${partner.name}`}
          onPointerMove={track}
          onPointerLeave={rest}
        >
          <div className="partner-card-inner">
            <div className="partner-mark">
              {partner.logo ? (
                <Image
                  src={partner.logo}
                  alt={`${partner.owner ? `${partner.owner} ` : ""}${partner.name} 마크`}
                  width={partner.logoWidth ?? 320}
                  height={partner.logoHeight ?? 320}
                  // 기관 로고는 SVG 로 오는 경우가 많은데, Next 의 이미지 최적화는
                  // SVG 를 기본으로 거절합니다(400). 벡터라 줄일 것도 없으므로
                  // public 폴더의 파일을 그대로 내보냅니다. 비트맵 로고는 평소대로
                  // 최적화를 거칩니다.
                  unoptimized={partner.logo.toLowerCase().endsWith(".svg")}
                />
              ) : (
                // 마크가 없는 기관은 채워 넣는 그림 없이 이름을 크게 씁니다. 이 칸의
                // 높이는 마크가 있는 카드와 같게 두어 격자가 들쭉날쭉해지지 않게
                // 합니다(site-polish.css 의 .partner-mark).
                //
                // 마크가 있든 없든 기관 이름은 언제나 같은 `h3` 입니다. 자리만
                // 옮겨 다닐 뿐이라, 화면 낭독기로 훑을 때 어떤 카드는 제목이 있고
                // 어떤 카드는 없는 일이 생기지 않습니다.
                <div className="partner-wordmark">
                  {partner.owner && <small>{partner.owner}</small>}
                  <h3>{partner.name}</h3>
                </div>
              )}
            </div>
            <div className="partner-copy">
              {partner.logo && (
                <>
                  {partner.owner && <small>{partner.owner}</small>}
                  <h3>{partner.name}</h3>
                </>
              )}
              <p>{partner.description}</p>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
