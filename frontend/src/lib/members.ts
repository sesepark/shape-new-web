export interface ShapeMember {
  id: string;
  name: string;
  team: "Management" | "Manipulation" | "Navigation" | "Reasoning";
  role: string;
  affiliation: string;
  imageUrl?: string;
  membership?: "준회원" | "정회원" | "알럼" | "멤버";
  /** 연결된 로그인 계정. 사진과 소개말은 본인이 마이페이지에서 관리합니다. */
  userId?: string;
}

const legacyPhoto = (name: string, extension = "jpeg") =>
  `https://www.snu-shape.com/figs/${encodeURIComponent(name)}.${extension}`;

export const defaultMembers: ShapeMember[] = [
  {
    id: "member-moon",
    name: "조나윤",
    team: "Management",
    role: "회장",
    affiliation: "서울대학교",
    imageUrl: legacyPhoto("조나윤"),
    membership: "정회원",
  },
  {
    id: "member-park",
    name: "오유하",
    team: "Management",
    role: "부회장",
    affiliation: "서울대학교",
    imageUrl: legacyPhoto("오유하", "png"),
    membership: "정회원",
  },
  {
    id: "member-choi",
    name: "류이든",
    team: "Manipulation",
    role: "팀장",
    affiliation: "서울대학교",
    imageUrl: legacyPhoto("류이든"),
    membership: "정회원",
  },
  {
    id: "member-shin",
    name: "전한별",
    team: "Manipulation",
    role: "팀원",
    affiliation: "서울대학교",
    imageUrl: legacyPhoto("전한별"),
    membership: "준회원",
  },
  {
    id: "member-kim",
    name: "강채아",
    team: "Navigation",
    role: "팀장",
    affiliation: "서울대학교",
    imageUrl: legacyPhoto("강채아"),
    membership: "정회원",
  },
  {
    id: "member-kang",
    name: "이도현",
    team: "Navigation",
    role: "팀원",
    affiliation: "서울대학교",
    imageUrl: legacyPhoto("이도현"),
    membership: "준회원",
  },
  {
    id: "member-yang",
    name: "이예솔",
    team: "Reasoning",
    role: "팀원",
    affiliation: "서울대학교",
    imageUrl: legacyPhoto("이예솔", "png"),
    membership: "알럼",
  },
  {
    id: "member-lee",
    name: "조초아",
    team: "Reasoning",
    role: "팀원",
    affiliation: "서울대학교",
    imageUrl: legacyPhoto("조초아"),
    membership: "알럼",
  },
];


/** 두 글자 성씨. 이만큼은 알아야 "남궁민수"에서 "민수"를 뽑을 수 있습니다. */
const COMPOUND_SURNAMES = ["남궁", "황보", "제갈", "사공", "선우", "서문", "독고", "동방", "사마", "강전"];
const HANGUL_ONLY = /^[가-힣]+$/;

/**
 * 사진이 없는 부원 카드에 넣을 이름. 성을 떼고 이름만 남깁니다.
 * "강채아" 에서 "김" 만 보여 주면 누구인지 알 수 없기 때문입니다.
 */
export function givenName(fullName: string): string {
  const name = fullName.trim();
  if (!name) return "";
  // 한글이 아니면(예: Anna) 그대로 첫 낱말을 씁니다.
  if (!HANGUL_ONLY.test(name)) return name.split(/\s+/)[0];
  if (name.length >= 4 && COMPOUND_SURNAMES.includes(name.slice(0, 2))) return name.slice(2);
  return name.length > 1 ? name.slice(1) : name;
}
