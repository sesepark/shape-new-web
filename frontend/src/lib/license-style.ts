/**
 * 라이선스 카드의 겉모습을 이름에서 정합니다.
 *
 * 예전에는 어떤 교육이든 같은 배지 아이콘 하나였습니다. 라이선스가 여덟 종이
 * 되면서 마이페이지에 똑같이 생긴 카드가 여러 장 쌓였습니다. 무엇에 대한
 * 카드인지 한눈에 갈리도록 아이콘 종류와 강조색, 짧은 코드를 이름에서 정합니다.
 *
 * 운영진이 관리자 페이지에서 어떤 이름으로든 라이선스를 만들 수 있으므로,
 * 목록에 없는 이름은 맨 아래 기본값으로 떨어집니다. 새 장비 종류가 생기면
 * 여기에 한 줄 더하면 됩니다.
 *
 * **순서가 중요합니다.** 위에서부터 먼저 걸리는 것을 씁니다. 로봇 손은 "Hand"
 * 로, 로봇 팔은 "팔"·"암" 으로 잡는데, 손 규칙이 팔 규칙보다 위에 있어야
 * "Tesollo Hand" 가 팔로 분류되지 않습니다.
 */
export type LicenseKind = "HMN" | "HND" | "CMP" | "SNS" | "ARM" | "SFT" | "GEN";

export type LicenseStyle = {
  /** 카드 오른쪽 위에 찍히는 짧은 코드. */
  kind: LicenseKind;
  /** 카드 아래에 적히는 갈래 이름. */
  track: string;
  /** 아이콘과 반사광에 쓰는 강조색. CSS 에서 rgb() 안에 그대로 들어갑니다. */
  accent: string;
};

const RULES: { match: RegExp; style: LicenseStyle }[] = [
  { match: /AI Worker|휴머노이드|Sapiens|G1/i, style: { kind: "HMN", track: "HUMANOID PLATFORM", accent: "58, 132, 255" } },
  { match: /손|Hand|그리퍼|Gripper|Tesollo|LEAP/i, style: { kind: "HND", track: "DEXTEROUS HAND", accent: "168, 106, 255" } },
  { match: /GPU|워크스테이션|서버|컴퓨팅|Workstation/i, style: { kind: "CMP", track: "COMPUTE RESOURCE", accent: "255, 168, 44" } },
  { match: /카메라|센서|Camera|Sensor|RealSense/i, style: { kind: "SNS", track: "SENSOR & DATA", accent: "42, 199, 138" } },
  { match: /팔|암|OMY|SO-ARM|LeRobot|Manipulator/i, style: { kind: "ARM", track: "MANIPULATOR", accent: "0, 191, 205" } },
  { match: /안전|Safety/i, style: { kind: "SFT", track: "SAFETY TRAINING", accent: "232, 78, 110" } },
];

const FALLBACK: LicenseStyle = { kind: "GEN", track: "EQUIPMENT TRAINING", accent: "108, 122, 148" };

export function licenseStyle(name: string): LicenseStyle {
  return RULES.find(({ match }) => match.test(name))?.style ?? FALLBACK;
}
