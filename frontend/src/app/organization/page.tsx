import { defaultOrganization, OrganizationChart, type OrganizationData } from "@/components/organization-chart";
import { PageShell } from "@/components/page-shell";
import { api } from "@/lib/api";
import type { ShapeMember } from "@/lib/members";

export const metadata = { title: "조직도", description: "SHAPE의 운영과 프로젝트를 하나의 조직도에서 소개합니다." };
export default async function OrganizationPage() {
  const page = await api.page("organization").catch(() => null);
  const memberPage = await api.page("members").catch(() => null);
  const candidate = page?.contentJson as Partial<OrganizationData> | undefined;
  const data: OrganizationData = candidate?.operationTeams ? { ...defaultOrganization, ...candidate } : defaultOrganization;
  const members = Array.isArray(memberPage?.contentJson?.members) ? memberPage.contentJson.members as ShapeMember[] : [];
  const memberNames = Object.fromEntries(members.map((member) => [member.id, member.name]));
  return <PageShell eyebrow="SNU PHYSICAL AI" title="SHAPE" contentTitle="조직도"><OrganizationChart data={data} memberNames={memberNames} /></PageShell>;
}
