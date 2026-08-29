/** 관리자 창구를 흉내 낸 자료. 글과 사람이 쌓인 뒤를 기준으로 넉넉히 만든다. */
const ID = (p, i) => `${p}-0000-0000-0000-${String(i).padStart(12, "0")}`;
const 긴이름 = ["김하늘빛나리", "남궁민수", "박서준", "Alexander Christopher", "Anna", "선우재덕", "이", "황보름다운"];
const 긴제목 = [
  "2026학년도 1학기 SHAPE-UP 프로젝트 최종 발표회 및 데모데이 운영 안내",
  "짧은 공지",
  "RoboCup@Home Education Challenge 2027 국내 예선 참가팀 모집과 사전 교육 일정 공유",
  "장비 예약 규정 개정 안내",
];
const 긴본문 = "<p>" + "동아리방 장비 운용 규정이 바뀌었습니다. ".repeat(12) + "</p>";
const iso = (d) => new Date(Date.now() - d * 86400000).toISOString();

const users = Array.from({ length: 34 }, (_, i) => ({
  id: ID("user", i),
  name: 긴이름[i % 긴이름.length] + (i > 7 ? String(i) : ""),
  email: i % 3 === 0 ? `very.long.email.address.for.layout.testing.${i}@snu.ac.kr` : `m${i}@snu.ac.kr`,
  imageUrl: null,
  status: ["ACTIVE", "PENDING", "REJECTED", "ACTIVE"][i % 4],
  isOwner: i === 0,
  createdAt: iso(i * 3),
  permissions: i % 5 === 0 ? ["content:manage", "equipment:manage", "reservations:manage", "news:manage", "notices:manage", "roadmap:manage", "links:manage"] : i % 3 === 0 ? ["content:manage"] : [],
  licenseIds: i % 2 === 0 ? [ID("lic", 0), ID("lic", 1)] : [],
}));

const licenses = [
  { id: ID("lic", 0), name: "AI Worker 운용 교육 수료", description: "양팔 로봇 원격 조종과 데이터 수집 과정을 모두 마친 사람에게 줍니다.", isActive: true },
  { id: ID("lic", 1), name: "SO-ARM 101 운용 교육 수료", description: null, isActive: true },
  { id: ID("lic", 2), name: "OMY 매니퓰레이터 안전 교육 및 조작 정책 실험 과정 수료", description: "긴 이름이 들어갔을 때를 봅니다.", isActive: false },
];

const equipment = ["AI Worker", "OMY", "LeRobot SO-ARM 101", "Unitree G1 휴머노이드", "Tesollo Robot Hand", "GPU 워크스테이션"].map((name, i) => ({
  id: ID("eq", i), name, category: i % 2 ? "로봇 팔 · 조작 정책 실험" : "양팔 로봇 · Teleoperation",
  description: "양팔 조작과 원격 조종(teleoperation) 데이터 수집을 위한 Physical AI 플랫폼입니다. ".repeat(2),
  imageUrl: null, status: ["ACTIVE", "MAINTENANCE", "RETIRED"][i % 3],
  reservationUnitMinutes: 60, sortOrder: i, requiredLicenseIds: i % 2 ? [ID("lic", 0)] : [],
  units: Array.from({ length: (i % 3) + 1 }, (_, u) => ({ id: ID(`unit${i}`, u), equipmentId: ID("eq", i), label: `${name} ${u + 1}호기`, status: "ACTIVE" })),
}));

/**
 * 예약 목 자료.
 *
 * 예전에는 모든 행이 같은 호기였고 `endsAt` 이 `startsAt` 보다 **앞서** 있었다.
 * 그래서 겹침 묶음도, 시간 표시도 실제와 다른 것을 그려 보고 있었다.
 *
 * 지금은 호기를 흩고, 그중 한 호기(`unit0-0`)에 **일부러 세 건을 겹쳐** 둔다.
 * 그러지 않으면 관리자 화면의 겹침 묶음이 한 번도 그려지지 않아, 좁은 화면에서
 * 깨지는지 알 수 없다.
 */
const 예약단위 = [ID("unit0", 0), ID("unit1", 0), ID("unit2", 0), ID("unit3", 0)];
const 목적 = ["CONTEST", "SHAPE_UP", "EDUCATION", "OTHER"];
const 시급도 = ["HIGH", "NORMAL", "LOW"];
/** 앞으로 다가올 시각. 하루 뒤부터 시작해 겹치도록 두 시간씩 잡는다. */
const 앞으로 = (hours) => new Date(Date.now() + hours * 3600000).toISOString();

const reservations = Array.from({ length: 28 }, (_, i) => {
  // 앞의 세 건은 같은 호기·같은 시간대를 두고 다툰다(3중 겹침).
  const 다툼 = i < 3;
  const unitId = 다툼 ? 예약단위[0] : 예약단위[i % 예약단위.length];
  const 시작 = 다툼 ? 24 + i : 24 + i * 3;
  return {
    id: ID("rsv", i), equipmentUnitId: unitId, userId: ID("user", i % 34),
    startsAt: 앞으로(시작), endsAt: 앞으로(시작 + 2),
    note: i % 3 === 0
      ? "금요일이 대회 제출 마감이라 이번 주 안에 데이터 수집을 마쳐야 합니다. 리더-팔로워 구성으로 집기 동작 200회를 반복하고, 실패 사례를 따로 기록해 다음 주 정기 미팅에서 공유할 예정입니다."
      : i % 3 === 1 ? "정기 교육 실습" : "",
    purposeCategory: 목적[i % 목적.length],
    urgency: 시급도[i % 시급도.length],
    status: 다툼 ? "PENDING" : ["PENDING", "APPROVED", "REJECTED", "CANCELLED", "EXPIRED"][i % 5],
    rejectionReason: i % 5 === 2 ? "같은 시간에 대회 준비 일정이 잡혀 있습니다." : null,
    beforePhotoUrl: null, afterPhotoUrl: null,
    autoDecidedAt: i % 4 === 1 ? iso(1) : null,
    recurrenceGroupId: i % 7 === 0 ? ID("grp", 0) : null,
    conflictsWith: 다툼 ? [0, 1, 2].filter((n) => n !== i).map((n) => ID("rsv", n)) : [],
    priority: 다툼 ? [70, 35, 15][i] : 20,
    priorityReasons: 다툼 ? ["매우 시급 +40", "대회 +30"] : ["보통 +20"],
    equipmentName: equipment[i % equipment.length].name, unitLabel: `${equipment[i % equipment.length].name} 1호기`,
    companions: i % 5 === 0 ? ["남궁민수", "황보름다운", "Alexander Christopher"] : [],
    userName: 긴이름[i % 긴이름.length], userEmail: `very.long.email.address.${i}@snu.ac.kr`, createdAt: iso(i),
  };
});

/** 정기 예약 묶음과 사용 통계. 새 관리자 탭이 빈 화면으로만 검사되지 않게 한다. */
const recurringGroups = [
  {
    groupId: ID("grp", 0), equipmentName: "AI Worker", unitLabel: "AI Worker 1호기",
    weekdays: [1, 2, 3], startTime: "18:00", endTime: "20:00",
    firstDate: iso(30).slice(0, 10), lastDate: iso(-60).slice(0, 10), total: 24, upcoming: 16,
  },
];

const usageStats = {
  fromDate: iso(30).slice(0, 10), untilDate: iso(0).slice(0, 10), days: 30,
  totalCount: 42, totalHours: 118.5,
  equipment: equipment.slice(0, 5).map((item, i) => ({
    key: item.id, label: item.name, count: 12 - i * 2, hours: 40 - i * 7, utilisation: 18.5 - i * 3,
  })),
  purposes: 목적.map((key, i) => ({ key, label: ["대회", "SHAPE-UP", "교육", "기타"][i], count: 16 - i * 4, hours: 44 - i * 10, utilisation: null })),
  urgencies: 시급도.map((key, i) => ({ key, label: ["매우 시급", "보통", "낮음"][i], count: 18 - i * 6, hours: 40 - i * 12, utilisation: null })),
  decisions: [
    { key: "auto", label: "자동 확정", count: 26, hours: 0, utilisation: null },
    { key: "staff", label: "운영진 승인", count: 11, hours: 0, utilisation: null },
    { key: "EXPIRED", label: "만료", count: 3, hours: 0, utilisation: null },
    { key: "REJECTED", label: "반려", count: 2, hours: 0, utilisation: null },
  ],
  people: 긴이름.slice(0, 6).map((name, i) => ({ key: ID("user", i), label: name, count: 9 - i, hours: 22 - i * 3, utilisation: null })),
  heatmap: Array.from({ length: 7 }, (_, weekday) =>
    Array.from({ length: 24 }, (_, hour) => (hour >= 18 && hour <= 21 && weekday < 4 ? (weekday + hour) % 6 : hour % 3 === 0 ? 1 : 0))),
};

const news = Array.from({ length: 22 }, (_, i) => ({
  id: ID("news", i), title: 긴제목[i % 긴제목.length], summary: "요약문이 길어졌을 때 목록에서 어떻게 되는지 봅니다. ".repeat(2),
  body: 긴본문, category: i % 2 ? "언론보도" : "활동", publishedAt: iso(i * 5).slice(0, 10),
  coverImage: null, externalUrl: i % 2 ? "https://news.snu.ac.kr/very/long/path/to/article/2026/robotics-institute" : "",
  published: true, linkPreview: null,
}));

const notices = Array.from({ length: 18 }, (_, i) => ({
  id: ID("ntc", i), title: 긴제목[i % 긴제목.length], body: 긴본문, category: ["공지", "자료", "질문"][i % 3],
  pinned: i < 2, published: true, createdAt: iso(i * 2), publishedAt: iso(i * 2).slice(0, 10), summary: "", externalUrl: "", coverImage: null,
}));

const roadmap = Array.from({ length: 26 }, (_, i) => ({
  id: ID("rm", i), title: 긴제목[i % 긴제목.length].slice(0, 34), category: ["SHAPE-UP", "대회", "교육", "기타"][i % 4],
  startsAt: iso(-i * 4), endsAt: i % 3 ? undefined : iso(-i * 4 - 2),
  description: "정기 미팅에서 진행 상황을 점검하고 다음 2주 계획을 확정합니다. ".repeat(2),
  isPublished: true, memberIds: [ID("user", i % 34), ID("user", (i + 1) % 34)],
}));

const links = Array.from({ length: 12 }, (_, i) => ({
  id: ID("lnk", i), title: ["서울대학교 로보틱스연구소", "LeRobot 공식 문서와 예제 저장소 모음", "ROS 2 Humble 문서"][i % 3],
  description: "동아리 활동에 자주 쓰는 바깥 자료입니다. ".repeat(2),
  url: "https://example.snu.ac.kr/very/long/path/that/keeps/going/for/a/while/index.html",
  category: ["연구", "도구", "학습"][i % 3], sortOrder: i, imageUrl: null,
}));

const audit = {
  items: Array.from({ length: 50 }, (_, i) => ({
    id: ID("aud", i), createdAt: iso(i / 6), actorId: ID("user", i % 8), actorName: 긴이름[i % 긴이름.length],
    actorEmail: `very.long.email.address.${i}@snu.ac.kr`,
    action: ["create", "update", "delete", "decision", "permissions", "order"][i % 6],
    area: ["소식", "장비 예약", "부원", "로드맵", "회원 및 권한"][i % 5],
    target: 긴제목[i % 긴제목.length],
    detail: "제목을 고치고 공개 여부를 바꿨습니다. 바뀐 값이 길어지면 이 줄이 어떻게 되는지 봅니다.",
    method: "POST", path: "/api/v1/admin/news/0835550b-969e-47de-aa71-91c102ff0efe",
  })),
  actors: 긴이름.map((n, i) => ({ id: ID("user", i), name: n })),
  areas: ["소식", "장비 예약", "부원", "로드맵", "회원 및 권한"],
};

const cycle = (kind) => ({ kind, label: kind === "calendar" ? "매월 1일 초기화" : "최근 30일", resets: iso(-9), start: iso(21), end: iso(-9), daysElapsed: 21, daysTotal: 30, daysLeft: 9, note: "이번 달 기준입니다." });
const metric = (key, label, used, limit, unit, level) => ({ key, label, used, limit, unit, ratio: limit ? used / limit : null, projected: limit ? used * 1.4 : null, projectedRatio: limit ? (used * 1.4) / limit : null, monthly: used, monthlyRatio: limit ? used / limit : null, exhaustsOn: level === "crit" ? iso(-4) : null, exhaustsInDays: level === "crit" ? 4 : null, exhaustsBeforeReset: level === "crit", basis: "calendar", level, hint: level === "crit" ? "이대로면 달이 끝나기 전에 한도를 넘습니다. 사진 최적화 횟수를 줄이세요." : null });
const usage = {
  collectedAt: new Date().toISOString(), cached: false, problems: { Cloudinary: "권한이 없는 열쇠라 일부 값을 읽지 못했습니다." },
  services: [
    { service: "Vercel", role: "프런트엔드 호스팅", plan: "Hobby", cycle: cycle("calendar"), metrics: [metric("edge", "Edge 요청", 412031, 1000000, "회", "ok"), metric("img", "이미지 최적화 변환", 4620, 5000, "회", "crit"), metric("cpu", "Active CPU", 3.2, 4, "시간", "warn")] },
    { service: "Render", role: "백엔드", plan: "Free", cycle: cycle("calendar"), metrics: [metric("hours", "인스턴스 가동 시간", 640, 750, "시간", "warn")] },
    { service: "Neon", role: "PostgreSQL", plan: "Free", cycle: cycle("rolling"), metrics: [metric("compute", "Compute 시간", 41, 191, "시간", "ok"), metric("storage", "저장 용량", 0.34, 0.5, "GB", "warn")] },
    { service: "Cloudinary", role: "사진 저장", plan: "Free", cycle: cycle("calendar"), unavailable: "이 열쇠로는 사용량을 읽을 수 없습니다.", metrics: [metric("credits", "크레딧", 12, 25, "개", "ok")] },
  ],
};

export const mock = {
  "/admin/users": users, "/admin/directory": users.map(({ id, name, email, imageUrl, status }) => ({ id, name, email, imageUrl, status })),
  "/admin/licenses": licenses, "/admin/equipment": equipment, "/admin/reservations": reservations,
  "/admin/reservations/recurring": recurringGroups, "/admin/reservations/stats": usageStats,
  "/admin/news": news, "/admin/notices": notices, "/admin/roadmap": roadmap, "/admin/links": links,
  "/admin/audit": audit, "/admin/usage": usage,
};
