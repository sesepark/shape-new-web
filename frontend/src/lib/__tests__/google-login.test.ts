/**
 * 로그인 state 검사.
 *
 * 이 검사가 느슨하면 남이 만든 로그인 요청이 부원 브라우저에서 완성됩니다(로그인
 * CSRF). 반대로 너무 빡빡하면 로그인이 통째로 막힙니다. 두 방향을 다 못 박아 둡니다.
 *
 * 브라우저 흉내는 여기서 직접 냅니다. jsdom 을 들이면 배포할 때마다 설치하는 짐이
 * 늘어나는데, 확인해야 할 것은 저장소 세 곳의 조합뿐이라 그만한 값을 치를 이유가
 * 없습니다.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stateMatches } from "@/lib/google-login";

const KEY = "shape-oauth-state";

function fakeStorage(blocked = false) {
  const box = new Map<string, string>();
  return {
    getItem: (key: string) => { if (blocked) throw new Error("blocked"); return box.get(key) ?? null; },
    setItem: (key: string, value: string) => { if (blocked) throw new Error("blocked"); box.set(key, value); },
    removeItem: (key: string) => { if (blocked) throw new Error("blocked"); box.delete(key); },
  };
}

type World = { sessionStorage: unknown; localStorage: unknown; document: unknown };
const world = globalThis as unknown as World;

function setUp({ session = null as string | null, local = null as string | null, cookie = null as string | null, blocked = false } = {}) {
  world.sessionStorage = fakeStorage(blocked);
  world.localStorage = fakeStorage(blocked);
  if (session) (world.sessionStorage as Storage).setItem(KEY, session);
  if (local) (world.localStorage as Storage).setItem(KEY, local);
  let jar = cookie ? `${KEY}=${cookie}` : "";
  world.document = {
    get cookie() { if (blocked) throw new Error("blocked"); return jar; },
    set cookie(value: string) { if (blocked) throw new Error("blocked"); jar = value.startsWith(`${KEY}=;`) ? "" : value; },
  };
}

beforeEach(() => setUp());
afterEach(() => { delete (world as Partial<World>).sessionStorage; delete (world as Partial<World>).localStorage; delete (world as Partial<World>).document; });

describe("stateMatches", () => {
  it("적어 둔 값과 같으면 통과한다", () => {
    setUp({ session: "abc", local: "abc", cookie: "abc" });
    expect(stateMatches("abc")).toBe(true);
  });

  it("적어 둔 값이 있는데 다르면 막는다", () => {
    setUp({ session: "abc", local: "abc", cookie: "abc" });
    expect(stateMatches("zzz")).toBe(false);
  });

  it("아무 데도 적혀 있지 않으면 막는다 — 여기서 시작한 로그인이 아니다", () => {
    setUp();
    expect(stateMatches("남이-만든-값")).toBe(false);
  });

  it("탭이 갈려 sessionStorage 만 비어도 다른 곳에 남아 있으면 통과한다", () => {
    setUp({ local: "abc" });
    expect(stateMatches("abc")).toBe(true);
  });

  it("저장 공간이 갈려 쿠키에만 남아 있어도 통과한다", () => {
    setUp({ cookie: "abc" });
    expect(stateMatches("abc")).toBe(true);
  });

  it("세 곳 모두 읽지 못하면 통과시킨다 — 저장이 통째로 막힌 브라우저", () => {
    setUp({ blocked: true });
    expect(stateMatches("무엇이든")).toBe(true);
  });
});
