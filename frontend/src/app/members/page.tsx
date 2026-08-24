import { MemberDirectory } from "@/components/member-directory";
import { PageShell } from "@/components/page-shell";
import { api, listOrEmpty } from "@/lib/api";
import type { ShapeMember } from "@/lib/members";

export const metadata = {
  title: "부원",
  description:
    "서울대학교 Physical AI 동아리 SHAPE의 운영진과 프로젝트 팀 부원을 소개합니다.",
};

export default async function MembersPage() {
  const [page, profiles] = await Promise.all([
    api.page("members").catch(() => null),
    listOrEmpty(api.memberProfiles()),
  ]);
  const stored = page?.contentJson?.members;
  const members = Array.isArray(stored) ? (stored as ShapeMember[]) : [];
  return (
    <PageShell eyebrow="PEOPLE OF SHAPE" title="SHAPE" contentTitle="부원">
      <div className="member-intro">
        <p className="lead">
          서로 다른 전공과 경험을 연결해 로봇의 인지·추론·행동을 함께
          구현합니다.
        </p>
        <strong>{members.length.toString().padStart(2, "0")}</strong>
        <span>현재 공개된 부원 카드</span>
      </div>
      <MemberDirectory members={members} profiles={profiles} />
    </PageShell>
  );
}
