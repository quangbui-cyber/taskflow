import { PROJECT_STATUSES, type ProjectCategory } from "../types";
import { canCreateClientProjectDirectly, isPilotTeam, type PipelineModeSetting } from "./pipelineMode";

export type ProjectCreationContext = { crmOn: boolean; setting: PipelineModeSetting; actorTeamId: string | null };
export const PROJECT_FROM_OPPORTUNITY_ERROR = "Dự án khách hàng được tạo khi Cơ hội thắng. Hãy mở Cơ hội trong khu vực Khách hàng.";
export const PILOT_TEAM_PROJECT_ERROR = "Team pilot ghi deal ở Cơ hội. Hãy mở Cơ hội trong khu vực Khách hàng.";
export const STATUS_TRACKED_IN_OPPORTUNITY_ERROR = "Bidding và Fail của deal khách được theo dõi ở Cơ hội.";

export function projectCreationMode(ctx: ProjectCreationContext): "LEGACY" | "RESTRICTED" {
  return ctx.crmOn && (ctx.setting.mode === "OPPORTUNITY_OFFICIAL" || isPilotTeam(ctx.setting, ctx.actorTeamId))
    ? "RESTRICTED" : "LEGACY";
}

export function checkProjectCreation(ctx: ProjectCreationContext, input: {
  category: ProjectCategory; accountTeamId: string | null; isPurchaseOrderImport: boolean;
}): { ok: true; initialStatus: "ON_PROCESS" | "BIDDING" } | { error: string } {
  if (input.category === "INTERNAL" || input.isPurchaseOrderImport) return { ok: true, initialStatus: "ON_PROCESS" };
  if (ctx.crmOn) {
    if (!canCreateClientProjectDirectly(ctx.setting, { actorTeamId: ctx.actorTeamId, isPurchaseOrderImport: false })) {
      return { error: ctx.setting.mode === "OPPORTUNITY_OFFICIAL" ? PROJECT_FROM_OPPORTUNITY_ERROR : PILOT_TEAM_PROJECT_ERROR };
    }
    // CLIENT Project responsibility comes from its Account, never responsibleTeamId.
    if (isPilotTeam(ctx.setting, input.accountTeamId)) return { error: PILOT_TEAM_PROJECT_ERROR };
  }
  return { ok: true, initialStatus: "BIDDING" };
}

export function checkProjectCategoryChange(ctx: ProjectCreationContext, input: {
  from: ProjectCategory; to: ProjectCategory; accountTeamId: string | null;
}): { ok: true } | { error: string } {
  if (input.from === "INTERNAL" && input.to === "CLIENT") {
    const result = checkProjectCreation(ctx, { category: "CLIENT", accountTeamId: input.accountTeamId, isPurchaseOrderImport: false });
    if ("error" in result) return result;
  }
  return { ok: true };
}

export function checkProjectStatusChange(ctx: ProjectCreationContext, input: {
  from: string; to: string; hasSourceOpportunity: boolean;
}): { ok: true } | { error: string } {
  if (!ctx.crmOn || input.from === input.to) return { ok: true };
  const official = ctx.setting.mode === "OPPORTUNITY_OFFICIAL";
  if ((input.to === "BIDDING" && (official || input.hasSourceOpportunity)) ||
      (input.to === "FAIL" && (input.hasSourceOpportunity || (official && input.from !== "BIDDING")))) {
    return { error: STATUS_TRACKED_IN_OPPORTUNITY_ERROR };
  }
  return { ok: true };
}

export function visibleProjectStatusKeys(ctx: ProjectCreationContext, input: {
  current: string; hasSourceOpportunity: boolean; statusCounts: { BIDDING: number; FAIL: number };
}): string[] {
  return PROJECT_STATUSES.filter(({ key }) => {
    if (key === input.current) return true;
    if (ctx.crmOn && (ctx.setting.mode === "OPPORTUNITY_OFFICIAL" || input.hasSourceOpportunity) &&
        (key === "BIDDING" || key === "FAIL") && input.statusCounts[key] === 0) return false;
    return !("error" in checkProjectStatusChange(ctx, { from: input.current, to: key, hasSourceOpportunity: input.hasSourceOpportunity }));
  }).map(({ key }) => key);
}
