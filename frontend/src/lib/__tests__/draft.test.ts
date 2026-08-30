import { describe, expect, it } from "vitest";
import { draftAge } from "@/lib/draft";

/**
 * `draftAge` 는 **보는 사람의 시계**를 따릅니다. 예약 시각(301동 109호의 시각,
 * 그래서 서울로 못 박음)과 달리 "내가 마지막으로 친 때" 라서, 해외에 있는
 * 부원에게는 그 사람의 시각으로 보이는 편이 맞습니다.
 *
 * 그래서 시험도 특정 시간대를 박아 두지 않고, 같은 `Intl` 로 기대값을 만들어
 * **갈림길만** 확인합니다. 그러지 않으면 기계의 시간대에 따라 통과와 실패를
 * 오갑니다(CI 는 UTC 입니다).
 */
const clock = new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const day = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric" });

describe("draftAge", () => {
  const now = Date.now();

  it("방금 쓴 것은 '방금' 이다", () => {
    expect(draftAge(now - 5_000, now)).toBe("방금");
    expect(draftAge(now - 59_000, now)).toBe("방금");
  });

  it("한 시간 안이면 몇 분 전인지 적는다", () => {
    expect(draftAge(now - 60_000, now)).toBe("1분 전");
    expect(draftAge(now - 42 * 60_000, now)).toBe("42분 전");
  });

  it("같은 날이면 시각만 적는다", () => {
    // 그 시간대의 정오를 잡으면 두 시간을 빼도 날이 넘어가지 않는다.
    const noon = new Date(now); noon.setHours(12, 0, 0, 0);
    const earlier = noon.getTime() - 3 * 3_600_000;
    expect(draftAge(earlier, noon.getTime())).toBe(clock.format(earlier));
  });

  it("다른 날이면 날짜를 함께 적는다", () => {
    // 날짜가 없으면 "09:05" 가 오늘인지 지난주인지 알 수 없다.
    const noon = new Date(now); noon.setHours(12, 0, 0, 0);
    const yesterday = noon.getTime() - 24 * 3_600_000;
    const label = draftAge(yesterday, noon.getTime());
    expect(label).toBe(`${day.format(yesterday)} ${clock.format(yesterday)}`);
    expect(label).toContain("월");
  });
});
