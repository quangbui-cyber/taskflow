import type { ProjectCategory } from "./types";

export type ProjectResponsibility = {
  responsibleTeamId: string | null;
  responsibleGroupId: string | null;
};

export type ResponsibilityOptions = {
  teams: { id: string; name: string }[];
  groups: { id: string; name: string }[];
};

type NamedGroup = { id: string; name: string };

export function projectResponsibilityGroup(project: {
  category: ProjectCategory;
  account: { team: NamedGroup } | null;
  responsibleTeam: NamedGroup | null;
  responsibleGroup: NamedGroup | null;
}): NamedGroup {
  if (project.category === "CLIENT") {
    const team = project.account?.team;
    return team
      ? { id: `team:${team.id}`, name: team.name }
      : { id: "needs-account", name: "Cần gán Account" };
  }
  if (project.responsibleGroup) {
    return { id: `group:${project.responsibleGroup.id}`, name: project.responsibleGroup.name };
  }
  if (project.responsibleTeam) {
    return { id: `team:${project.responsibleTeam.id}`, name: project.responsibleTeam.name };
  }
  return { id: "unassigned", name: "Chưa gán Team" };
}

export function responsibilityValue(project: ProjectResponsibility) {
  if (project.responsibleGroupId) return `group:${project.responsibleGroupId}`;
  if (project.responsibleTeamId) return `team:${project.responsibleTeamId}`;
  return "";
}

/** Missing fields preserve the assignment; an explicit empty value clears it. */
export function readProjectResponsibility(
  formData: FormData,
  existing?: ProjectResponsibility,
  category: ProjectCategory = "INTERNAL",
): ProjectResponsibility | { error: string } {
  // Customer grouping always comes from Account; never trust a submitted group.
  if (category === "CLIENT") {
    return { responsibleTeamId: null, responsibleGroupId: null };
  }
  const raw = formData.get("responsibility");
  if (raw === null) {
    return {
      responsibleTeamId: existing?.responsibleTeamId ?? null,
      responsibleGroupId: existing?.responsibleGroupId ?? null,
    };
  }
  if (typeof raw !== "string") return { error: "Team/phòng ban không hợp lệ." };
  if (!raw) return { responsibleTeamId: null, responsibleGroupId: null };
  const match = /^(team|group):([^:\s]+)$/.exec(raw);
  if (!match) return { error: "Team/phòng ban không hợp lệ." };
  return {
    responsibleTeamId: match[1] === "team" ? match[2] : null,
    responsibleGroupId: match[1] === "group" ? match[2] : null,
  };
}
