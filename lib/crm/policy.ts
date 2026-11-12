export type CrmActor = { id: string; role: string; accountId: string | null; managedTeamIds: string[]; isDataSteward: boolean };
export type CrmOwnerResource = { kind: "CLIENT"; picUserId: string | null; teamId: string | null } | { kind: "OPPORTUNITY"; picUserId: string | null; teamId: string | null; closed: boolean };
export type CrmResource = CrmOwnerResource | { kind: "TASK"; owner: CrmOwnerResource; assigneeId: string | null; creatorId: string };
export type CrmAction = "VIEW" | "EDIT" | "CHANGE_PIC_OR_TEAM" | "ASSIGN" | "LOG_TOUCHPOINT" | "EDIT_TASK" | "SCORE_POTENTIAL" | "CLOSE_OPPORTUNITY" | "CONFIRM_IMPORTED_CLIENT" | "REVIEW_IMPORT" | "MERGE_CLIENT" | "CONFIGURE" | "ARCHIVE_CLIENT";

export function isTeamManager(actor: CrmActor, teamId: string | null): boolean {
  return teamId !== null && actor.managedTeamIds.includes(teamId);
}

export function crmCan(actor: CrmActor, action: CrmAction, resource?: CrmResource): boolean {
  if (!actor.id) return false;
  if (action === "VIEW") return true;
  const owner = resource?.kind === "TASK" ? resource.owner : resource;
  if (owner?.kind === "OPPORTUNITY" && owner.closed) return false;
  if (actor.role === "ADMIN") return true;
  if (action === "CONFIGURE") return false;
  if (action === "REVIEW_IMPORT" || action === "MERGE_CLIENT") return actor.isDataSteward;
  if (!owner) return false;
  const pic = owner.picUserId === actor.id;
  const manager = isTeamManager(actor, owner.teamId);
  if (action === "CONFIRM_IMPORTED_CLIENT") return pic;
  if (action === "CHANGE_PIC_OR_TEAM" || action === "SCORE_POTENTIAL" || action === "ARCHIVE_CLIENT") return manager;
  if (action === "EDIT_TASK" || action === "LOG_TOUCHPOINT") {
    return pic || manager || (resource?.kind === "TASK" && resource.assigneeId === actor.id);
  }
  return pic || manager;
}

/** crm53: every playbook section, Payment included, follows EDIT on the client (PIC, team AD/AM, Admin). */
export function crmCanEditPlaybook(actor: CrmActor, resource: CrmOwnerResource): boolean {
  return crmCan(actor, "EDIT", resource);
}
/** crm53: client feedback after a Project is recorded by whoever may EDIT the client or is a member/owner of that Project. */
export function crmCanRateProject(actor: CrmActor, resource: CrmOwnerResource, isProjectMember: boolean): boolean {
  return !!actor.id && (isProjectMember || crmCan(actor, "EDIT", resource));
}
