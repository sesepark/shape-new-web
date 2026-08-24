export interface ShapeMember {
  id: string;
  name: string;
  /**
   * 기술 팀 배정. 아직 팀이 정해지지 않은 신입은 "미배정" 으로 둡니다.
   * 팀을 임의로 찍어 넣는 것보다 정해지지 않았다고 적는 편이 정확합니다.
   */
  team: "Management" | "Manipulation" | "Navigation" | "Reasoning" | "미배정";
  role: string;
  affiliation: string;
  imageUrl?: string;
  membership?: "준회원" | "정회원" | "알럼" | "멤버";
  /** 연결된 로그인 계정. 사진과 소개말은 본인이 마이페이지에서 관리합니다. */
  userId?: string;
}

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
