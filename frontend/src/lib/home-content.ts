/**
 * 홈 화면의 글귀와 목록.
 *
 * 예전에는 이 값들이 `src/app/page.tsx` 안에 상수로 박혀 있어서, 문구 한 줄을
 * 고치려 해도 코드를 고치고 배포해야 했습니다. 이제는 고정 페이지
 * `content_pages/home` 의 `content_json` 에 담고, 관리자 › 홈 화면에서 고칩니다.
 *
 * 저장된 값이 없거나 일부만 있어도 화면이 비지 않도록, 읽을 때 항상 아래 기본값과
 * 겹쳐 씁니다(`mergeHome`). 그래서 새 항목을 코드에 추가해도 옛 저장본이 그대로
 * 살아 있고, 관리자가 한 칸을 지워도 홈이 무너지지 않습니다.
 *
 * **화면에서 고칠 수 없는 것은 여기 넣지 않습니다.** 3D 로봇 무대, 스크롤 애니메이션,
 * 칸 배치 같은 것은 코드와 CSS 가 정합니다. 홈의 '일정' 칸은 로드맵을 그대로
 * 가져오므로 관리자 › 로드맵에서 고칩니다.
 */

export interface HomeStage {
  number: string;
  label: string;
  title: string;
  body: string;
  href: string;
}

export interface HomeField {
  title: string;
  topics: string;
}

export interface HomeFact {
  value: string;
  unit: string;
  label: string;
  note: string;
}

export interface HomeWeekSlot {
  day: string;
  track: string;
  who: string;
  when: string;
}

export interface HomeContest {
  name: string;
  when: string;
  where: string;
}

export interface HomeContent {
  hero: {
    /** 제목 위를 도는 글자띠. */
    wordmark: string;
    /** 큰 제목의 첫 줄과, 기울여 쓰는 둘째 줄. */
    titleTop: string;
    titleAccent: string;
    /** 줄바꿈은 그대로 화면의 줄바꿈이 됩니다. */
    tagline: string;
    ctaLabel: string;
    ctaHref: string;
    scrollLabel: string;
  };
  intro: {
    eyebrow: string;
    heading: string;
    slogan: string;
    body: string;
    fields: HomeField[];
    ctaLabel: string;
    ctaHref: string;
  };
  stages: HomeStage[];
  numbers: {
    eyebrow: string;
    heading: string;
    facts: HomeFact[];
    week: HomeWeekSlot[];
    footnote: string;
  };
  next: {
    eyebrow: string;
    heading: string;
    platformsHeading: string;
    platforms: string[];
    platformsNote: string;
    platformsCtaLabel: string;
    platformsCtaHref: string;
    contests: HomeContest[];
    timelineCtaLabel: string;
  };
}

export const DEFAULT_HOME: HomeContent = {
  hero: {
    wordmark: "SNU Humanoid And Physical Embodied AI",
    titleTop: "SHAPE",
    titleAccent: "the real world.",
    tagline: "AI가 현실을 이해하고 움직이는 순간을\n함께 연구하고 만들어 갑니다.",
    ctaLabel: "SHAPE 알아보기",
    ctaHref: "/about",
    scrollLabel: "SCROLL TO EXPLORE",
  },
  intro: {
    eyebrow: "WHAT WE SHAPE",
    heading: "우리는 화면 밖의\nAI를 만듭니다.",
    slogan: "Fostering Talent,\nShaping Physical AI",
    body: "SHAPE는 Physical AI 인재 양성을 목적으로 하는 서울대학교 동아리입니다. 오랫동안 대학원과 기업의 영역이었던 휴머노이드 연구를 학부 단계에서 진행하기 위해 2026년 4월 기계공학부에서 시작했습니다. 지금 아는 것이 적어도 상관없습니다.",
    // 참고 자료의 「분야 설명」 여섯 갈래입니다. "화면 밖의 AI" 라는 말만으로는
    // 무엇을 하는지 알 수 없어서, 실제로 다루는 주제를 이 자리에서 보여 줍니다.
    fields: [
      { title: "인식과 상태 추정", topics: "Computer Vision · 3D Perception · SLAM · 촉각과 힘 센싱" },
      { title: "로봇 학습과 범용 모델", topics: "VLA · 모방학습 · 강화학습 · Sim2Real · World Model" },
      { title: "추론과 행동 계획", topics: "Task Planning · Motion Planning · 실패 감지와 복구" },
      { title: "조작", topics: "Dexterous · 변형체 조작 · Contact-rich · Compliant Control" },
      { title: "휴머노이드와 제어", topics: "전신 제어 · Loco-manipulation · 보행과 균형 · 모션 리타게팅" },
      { title: "사람 · 데이터 · 하드웨어", topics: "HRI · 텔레오퍼레이션 · 데이터 파이프라인 · 하드웨어 제작" },
    ],
    ctaLabel: "동아리 소개 보기",
    ctaHref: "/about",
  },
  // 인재 양성의 세 단계. 2기 운영 계획서 1-2 절의 정의를 그대로 옮겼습니다.
  stages: [
    {
      number: "01",
      label: "EDUCATION",
      title: "교육",
      body: "초심자가 로봇 학습의 전 과정을 다룰 수 있는 기초 역량을 확보합니다. 준회원은 한 학기 교육 트랙을 이수하면 정회원이 됩니다.",
      href: "/roadmap/education",
    },
    {
      number: "02",
      label: "RESEARCH",
      title: "연구",
      body: "직접 정한 문제를 실물 로봇과 자체 취득 데이터로 해결하는 경험을 쌓습니다. 정회원 전원이 SHAPE-UP 팀 프로젝트에 참여합니다.",
      href: "/roadmap/shape-up",
    },
    {
      number: "03",
      label: "VERIFICATION",
      title: "검증",
      body: "대회 출전과 결과물 공개를 통해 외부 기준에서 역량을 확인합니다. 마트 챌린지와 RoboCup@Home을 하나의 프로젝트로 준비합니다.",
      href: "/roadmap/competition",
    },
  ],
  numbers: {
    eyebrow: "BY THE NUMBERS",
    heading: "한 학기를 이렇게\n굴리고 있습니다.",
    facts: [
      { value: "2026", unit: "년 4월", label: "창립", note: "서울대학교 기계공학부 소속" },
      { value: "70", unit: "명", label: "2기 부원", note: "정회원 30 · 준회원 40" },
      { value: "3", unit: "트랙", label: "정기 활동", note: "SHAPE-UP · 대회 · 교육" },
      { value: "5", unit: "종", label: "운용 플랫폼", note: "휴머노이드부터 매니퓰레이터까지" },
    ],
    week: [
      { day: "화", track: "SHAPE-UP", who: "정회원", when: "격주 19:00~22:00" },
      { day: "수", track: "대회", who: "대회팀", when: "매주 19:00~" },
      { day: "목", track: "교육", who: "준회원", when: "매주 19:00~22:00" },
    ],
    footnote: "지도교수 임종우 · 활동 공간 서울대학교 301동 109호 · 2기 마무리는 2027년 1월 30일 Demo Day입니다.",
  },
  next: {
    eyebrow: "WHAT’S NEXT",
    heading: "지금 만들고 있는 것.",
    platformsHeading: "지난 학기 운용한 플랫폼",
    platforms: ["Unitree G1", "AI Worker", "AI Sapiens", "OMY", "SO-ARM 101"],
    platformsNote: "휴머노이드부터 매니퓰레이터까지 실물 위에서 직접 다뤘습니다.",
    platformsCtaLabel: "보유 장비 보기",
    platformsCtaHref: "/equipment",
    contests: [
      { name: "마트 환경 기반 휴머노이드 로봇 챌린지", when: "본선 2026년 11월 13~14일", where: "대구 EXCO" },
      { name: "RoboCup@Home", when: "1차 지원 2026년 11월 · 본선 2027년 6월", where: "독일 뉘른베르크" },
    ],
    timelineCtaLabel: "전체 로드맵 보기",
  },
};

type Bag = Record<string, unknown>;

/** 문자열 칸은 값이 실제로 들어 있을 때만 씁니다. 빈 칸은 기본값으로 돌아갑니다. */
function pickText(stored: unknown, fallback: string): string {
  return typeof stored === "string" && stored.trim() ? stored : fallback;
}

/** 목록은 비어 있지 않을 때만 씁니다. 지워서 화면이 빈 칸이 되는 일을 막습니다. */
function pickList<T>(stored: unknown, fallback: T[], shape: (row: Bag, index: number) => T): T[] {
  if (!Array.isArray(stored) || stored.length === 0) return fallback;
  return stored.map((row, index) => shape((row ?? {}) as Bag, index));
}

/**
 * 저장된 값을 기본값 위에 겹칩니다.
 *
 * 저장본이 없거나(처음 열었을 때), 일부 칸만 있거나, 값이 이상한 자료형이어도
 * 홈이 그려져야 합니다. 공개 화면이 서버에서 그려지므로 여기서 한 번 실수하면
 * 홈 전체가 500 이 됩니다.
 */
export function mergeHome(stored: unknown): HomeContent {
  const source = (stored ?? {}) as Bag;
  const hero = (source.hero ?? {}) as Bag;
  const intro = (source.intro ?? {}) as Bag;
  const numbers = (source.numbers ?? {}) as Bag;
  const next = (source.next ?? {}) as Bag;
  const base = DEFAULT_HOME;

  return {
    hero: {
      wordmark: pickText(hero.wordmark, base.hero.wordmark),
      titleTop: pickText(hero.titleTop, base.hero.titleTop),
      titleAccent: pickText(hero.titleAccent, base.hero.titleAccent),
      tagline: pickText(hero.tagline, base.hero.tagline),
      ctaLabel: pickText(hero.ctaLabel, base.hero.ctaLabel),
      ctaHref: pickText(hero.ctaHref, base.hero.ctaHref),
      scrollLabel: pickText(hero.scrollLabel, base.hero.scrollLabel),
    },
    intro: {
      eyebrow: pickText(intro.eyebrow, base.intro.eyebrow),
      heading: pickText(intro.heading, base.intro.heading),
      slogan: pickText(intro.slogan, base.intro.slogan),
      body: pickText(intro.body, base.intro.body),
      fields: pickList(intro.fields, base.intro.fields, (row, index) => ({
        title: pickText(row.title, base.intro.fields[index]?.title ?? ""),
        topics: pickText(row.topics, base.intro.fields[index]?.topics ?? ""),
      })),
      ctaLabel: pickText(intro.ctaLabel, base.intro.ctaLabel),
      ctaHref: pickText(intro.ctaHref, base.intro.ctaHref),
    },
    stages: pickList(source.stages, base.stages, (row, index) => ({
      number: pickText(row.number, base.stages[index]?.number ?? String(index + 1).padStart(2, "0")),
      label: pickText(row.label, base.stages[index]?.label ?? ""),
      title: pickText(row.title, base.stages[index]?.title ?? ""),
      body: pickText(row.body, base.stages[index]?.body ?? ""),
      href: pickText(row.href, base.stages[index]?.href ?? "/roadmap"),
    })),
    numbers: {
      eyebrow: pickText(numbers.eyebrow, base.numbers.eyebrow),
      heading: pickText(numbers.heading, base.numbers.heading),
      facts: pickList(numbers.facts, base.numbers.facts, (row, index) => ({
        value: pickText(row.value, base.numbers.facts[index]?.value ?? ""),
        unit: pickText(row.unit, base.numbers.facts[index]?.unit ?? ""),
        label: pickText(row.label, base.numbers.facts[index]?.label ?? ""),
        note: pickText(row.note, base.numbers.facts[index]?.note ?? ""),
      })),
      week: pickList(numbers.week, base.numbers.week, (row, index) => ({
        day: pickText(row.day, base.numbers.week[index]?.day ?? ""),
        track: pickText(row.track, base.numbers.week[index]?.track ?? ""),
        who: pickText(row.who, base.numbers.week[index]?.who ?? ""),
        when: pickText(row.when, base.numbers.week[index]?.when ?? ""),
      })),
      footnote: pickText(numbers.footnote, base.numbers.footnote),
    },
    next: {
      eyebrow: pickText(next.eyebrow, base.next.eyebrow),
      heading: pickText(next.heading, base.next.heading),
      platformsHeading: pickText(next.platformsHeading, base.next.platformsHeading),
      platforms: pickList(next.platforms, base.next.platforms, (row) =>
        typeof row === "string" ? row : String((row as Bag)?.name ?? ""),
      ).filter(Boolean),
      platformsNote: pickText(next.platformsNote, base.next.platformsNote),
      platformsCtaLabel: pickText(next.platformsCtaLabel, base.next.platformsCtaLabel),
      platformsCtaHref: pickText(next.platformsCtaHref, base.next.platformsCtaHref),
      contests: pickList(next.contests, base.next.contests, (row, index) => ({
        name: pickText(row.name, base.next.contests[index]?.name ?? ""),
        when: pickText(row.when, base.next.contests[index]?.when ?? ""),
        where: pickText(row.where, base.next.contests[index]?.where ?? ""),
      })),
      timelineCtaLabel: pickText(next.timelineCtaLabel, base.next.timelineCtaLabel),
    },
  };
}

/**
 * 줄바꿈이 들어간 글귀를 화면의 줄바꿈으로 옮길 때 씁니다.
 * 관리자가 Enter 로 나눈 줄이 그대로 <br> 이 됩니다.
 */
export function lines(value: string): string[] {
  return value.split("\n");
}
