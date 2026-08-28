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

const reservations = Array.from({ length: 28 }, (_, i) => ({
  id: ID("rsv", i), equipmentUnitId: ID("unit0", 0), userId: ID("user", i % 34),
  startsAt: iso(-(i % 14) + 7), endsAt: iso(-(i % 14) + 6.9),
  purpose: i % 3 === 0 ? "SHAPE-UP 3팀 모방학습 데이터 수집. 리더-팔로워 구성으로 집기 동작 200회를 반복하고, 실패 사례를 따로 기록해 다음 주 정기 미팅에서 공유할 예정입니다." : "정기 교육 실습",
  status: ["PENDING", "APPROVED", "REJECTED", "CANCELLED"][i % 4],
  rejectionReason: i % 4 === 2 ? "같은 시간에 대회 준비 일정이 잡혀 있습니다." : null,
  beforePhotoUrl: null, afterPhotoUrl: null,
  equipmentName: equipment[i % equipment.length].name, unitLabel: `${equipment[i % equipment.length].name} 1호기`,
  companions: i % 5 === 0 ? ["남궁민수", "황보름다운", "Alexander Christopher"] : [],
  userName: 긴이름[i % 긴이름.length], userEmail: `very.long.email.address.${i}@snu.ac.kr`, createdAt: iso(i),
}));

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
  "/admin/news": news, "/admin/notices": notices, "/admin/roadmap": roadmap, "/admin/links": links,
  "/admin/audit": audit, "/admin/usage": usage,
};
