"use client";

export type OrganizationTeam = { name: string; role: string; work: string[]; memberIds?: string[] };
export type OrganizationData = {
  advisor: string;
  leadership: string;
  operationTeams: OrganizationTeam[];
  projectTeams?: OrganizationTeam[];
};

export const defaultOrganization: OrganizationData = {
  advisor: "지도교수",
  leadership: "회장단",
  operationTeams: [
    {
      name: "운영팀",
      role: "회장단 · 운영진",
      work: [
        "연간 활동 및 예산 운영",
        "회원·라이선스 관리",
        "대내외 행정과 안전 관리",
      ],
    },
    {
      name: "교육팀",
      role: "커리큘럼 리드 · 멘토",
      work: [
        "신입 부원 온보딩",
        "로보틱스·Physical AI 교육",
        "실습 자료와 세미나 운영",
      ],
    },
    {
      name: "연구팀",
      role: "프로젝트 리드 · 연구원",
      work: [
        "휴머노이드 연구 프로젝트",
        "데이터·모델·제어 실험",
        "연구 기록과 결과물 관리",
      ],
    },
    {
      name: "대외협력팀",
      role: "파트너십 · 미디어",
      work: ["대회와 외부 협력", "뉴스·성과 아카이빙", "전시·데모·홍보 운영"],
    },
  ],
  projectTeams: [
    {
      name: "Humanoid Control",
      role: "제어 프로젝트",
      work: ["보행 및 전신 제어", "시뮬레이션-실물 전이", "하드웨어 통합"],
    },
    {
      name: "Robot Learning",
      role: "학습 프로젝트",
      work: ["모방·강화학습", "데이터 수집 파이프라인", "정책 평가"],
    },
    {
      name: "SHAPE-UP",
      role: "통합 프로젝트",
      work: ["학기별 팀 프로젝트", "중간·최종 데모", "결과 공유와 후속 연구"],
    },
  ],
};

export function OrganizationChart({
  data = defaultOrganization,
  memberNames = {},
}: {
  data?: OrganizationData;
  memberNames?: Record<string, string>;
}) {
  const list = [...data.operationTeams, ...(data.projectTeams ?? [])];
  return (
    <div className="organization">
      <div className="org-tree" aria-label="SHAPE 조직 구조">
        <div className="org-root">
          <span>SNU Physical AI Club</span>
          <strong>SHAPE</strong>
        </div>
        <div className="org-line" />
        <div className="org-lead">
          <span>Faculty Advisor</span>
          <strong>{data.advisor}</strong>
        </div>
        <div className="org-line" />
        <div className="org-lead blue">
          <span>Executive Board</span>
          <strong>{data.leadership}</strong>
        </div>
        <div className="org-branches">
          {list.map((team) => (
            <article key={team.name}>
              <small>{team.role}</small>
              <h3>{team.name}</h3>
              {team.memberIds?.length ? <div className="org-member-tags">{team.memberIds.map((memberId) => <a href={`/members#member-${memberId}`} key={memberId}>@{memberNames[memberId] ?? memberId}</a>)}</div> : null}
              {team.work.map((item) => (
                <p key={item}>{item}</p>
              ))}
            </article>
          ))}
        </div>
      </div>
      <div className="organization-table">
        <div className="organization-row head">
          <span>조직</span>
          <span>구성</span>
          <span>담당 업무</span>
        </div>
        {list.map((team) => (
          <div className="organization-row" key={team.name}>
            <strong>{team.name}</strong>
            <span>{team.role}</span>
            <div>
              {team.memberIds?.length ? <p className="org-member-links">{team.memberIds.map((memberId) => <a href={`/members#member-${memberId}`} key={memberId}>{memberNames[memberId] ?? "부원"} 프로필</a>)}</p> : null}
              <ul>
              {team.work.map((item) => (
                <li key={item}>{item}</li>
              ))}
              </ul>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
