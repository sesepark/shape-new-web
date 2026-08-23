import type {
  EquipmentItem,
  NewsDetail,
  RelatedLink,
  RoadmapItem,
} from "@/lib/types";

export const mockEquipment: EquipmentItem[] = [
  {
    id: "mock-ai-worker",
    name: "AI Worker",
    category: "양팔 로봇 · Teleoperation",
    description:
      "양팔 조작과 원격 조종(teleop) 데이터 수집 실험을 위한 Physical AI 플랫폼입니다. 세부 사양과 운용 조건은 운영진 확인 후 안내합니다.",
    status: "ACTIVE",
    requiredLicenses: ["로봇 안전 교육"],
    availableUnits: 1,
    reservationUnitMinutes: 60,
    openHour: 9,
    closeHour: 22,
  },
  {
    id: "mock-omy",
    name: "OMY ×2",
    category: "로봇 팔",
    description:
      "조작 정책 실험과 교육용 데이터 수집에 사용하는 소형 로봇 팔입니다. 두 대를 연동한 실험 구성이 가능합니다.",
    status: "ACTIVE",
    requiredLicenses: ["로봇 팔 기초 교육"],
    availableUnits: 2,
    reservationUnitMinutes: 60,
    openHour: 9,
    closeHour: 22,
  },
  {
    id: "mock-humanoid",
    name: "휴머노이드 플랫폼",
    category: "G1 · K1 도입 논의 중",
    description:
      "전신 제어, 보행, 조작 연구를 위한 휴머노이드 플랫폼입니다. 기종과 도입 일정은 현재 논의 중입니다.",
    status: "INACTIVE",
    requiredLicenses: [],
    availableUnits: 0,
    reservationUnitMinutes: 60,
    openHour: 9,
    closeHour: 22,
  },
  {
    id: "mock-robot-hand",
    name: "로봇 손",
    category: "Dexterous Hand",
    description:
      "정교한 파지와 손가락 조작 정책 연구를 위한 다관절 로봇 손 플랫폼입니다.",
    status: "ACTIVE",
    requiredLicenses: ["로봇 안전 교육"],
    availableUnits: 1,
    reservationUnitMinutes: 60,
    openHour: 9,
    closeHour: 22,
  },
  {
    id: "mock-gpu",
    name: "RTX PRO 6000 ×2",
    category: "GPU · 시뮬레이션·학습",
    description:
      "로봇 시뮬레이션, 정책 학습, 비전 모델 실험을 위한 고성능 GPU 워크스테이션 자원입니다.",
    status: "ACTIVE",
    requiredLicenses: ["컴퓨팅 자원 이용 안내"],
    availableUnits: 2,
    reservationUnitMinutes: 60,
    openHour: 0,
    closeHour: 24,
  },
  {
    id: "mock-lerobot",
    name: "LeRobot SO-ARM101",
    category: "교육팀 장비",
    description:
      "모방학습의 데이터 수집부터 정책 학습·평가까지 실습하는 교육용 로봇 팔입니다.",
    status: "ACTIVE",
    requiredLicenses: ["LeRobot 기초 교육"],
    availableUnits: 1,
    reservationUnitMinutes: 60,
    openHour: 9,
    closeHour: 22,
  },
  {
    id: "mock-realsense",
    name: "Intel RealSense Camera ×6",
    category: "Depth Camera",
    description:
      "RGB-D 인지, 3D 재구성, 로봇 비전 데이터 수집에 사용하는 Intel 깊이 카메라입니다.",
    status: "ACTIVE",
    requiredLicenses: [],
    availableUnits: 6,
    reservationUnitMinutes: 60,
    openHour: 9,
    closeHour: 22,
  },
];

export const mockNews: NewsDetail[] = [
  {
    id: "mock-physical-ai-kickoff",
    title: "SHAPE 2026 Physical AI Kickoff",
    summary:
      "새 학기 첫 정기 세션에서 Physical AI 프로젝트 주제와 운영 계획을 공유했습니다.",
    category: "활동",
    publishedAt: "2026-08-18T09:00:00+09:00",
    contentHtml:
      "<h2>Physical AI를 함께 구현합니다</h2><p>SHAPE는 로봇의 인지·추론·행동을 연결하는 Physical AI 프로젝트를 시작합니다. 이번 세션에서는 팀별 관심 주제를 나누고 장비 이용 안내를 진행했습니다.</p><p>다음 모임에서는 센서 데이터와 로봇 제어 실습을 이어갑니다.</p>",
  },
  {
    id: "mock-shape-up",
    title: "SHAPE-UP 첫 번째 빌드 위크 안내",
    summary:
      "아이디어를 실제 데모로 이어 가는 4주 집중 제작 프로그램을 시작합니다.",
    category: "SHAPE-UP",
    publishedAt: "2026-08-12T09:00:00+09:00",
    contentHtml:
      "<h2>4주간의 집중 제작</h2><p>문제 정의부터 하드웨어·소프트웨어 통합, 데모데이까지 한 흐름으로 경험합니다.</p>",
    externalUrl: "https://github.com/",
    contentJson: { linkPreview: true },
  },
  {
    id: "mock-lab-safety",
    title: "공용 장비 안전 교육 신청",
    summary:
      "3D 프린터와 레이저 커터 이용을 위한 필수 안전 교육 일정을 공지합니다.",
    category: "공지",
    publishedAt: "2026-08-04T09:00:00+09:00",
    contentHtml:
      "<h2>장비 사용 전 확인해 주세요</h2><p>모든 장비 예약은 안전 교육 이수 후 가능합니다. 교육 이수 기록은 관리자 페이지에서 관리됩니다.</p>",
  },
];

export const mockRoadmap: RoadmapItem[] = [
  {
    id: "mock-roadmap-1",
    title: "SHAPE-UP Build Week",
    category: "SHAPE-UP",
    startsAt: "2026-09-07T10:00:00+09:00",
    endsAt: "2026-09-28T18:00:00+09:00",
    description: "문제 정의부터 데모 제작까지 진행하는 집중 프로젝트.",
  },
  {
    id: "mock-roadmap-2",
    title: "SNU 로봇 경진대회 준비",
    category: "대회",
    startsAt: "2026-10-05T10:00:00+09:00",
    endsAt: "2026-11-14T18:00:00+09:00",
    description: "팀 빌딩과 주행·인지 파트의 반복 검증을 진행합니다.",
  },
  {
    id: "mock-roadmap-3",
    title: "ROS 2 · Vision 기초 교육",
    category: "교육",
    startsAt: "2026-09-15T19:00:00+09:00",
    endsAt: "2026-10-27T21:00:00+09:00",
    description: "로봇 소프트웨어와 비전 파이프라인을 함께 익힙니다.",
  },
];

export const mockLinks: RelatedLink[] = [
  {
    id: "mock-link-github",
    title: "SHAPE GitHub",
    description: "프로젝트 소스와 협업 문서를 확인합니다.",
    url: "https://github.com/",
  },
  {
    id: "mock-link-notion",
    title: "SHAPE Notion",
    description: "주간 기록과 온보딩 자료를 확인합니다.",
    url: "https://www.notion.so/",
  },
];
