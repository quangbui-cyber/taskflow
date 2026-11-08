export type PipelineModeSetting = { mode: "PROJECT_OFFICIAL" | "OPPORTUNITY_OFFICIAL"; pilotTeamIds: string[]; plannedCutoverDate: string | null };
export function parsePipelineMode(value: unknown): PipelineModeSetting | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (v.mode !== "PROJECT_OFFICIAL" && v.mode !== "OPPORTUNITY_OFFICIAL") return null;
  if (!Array.isArray(v.pilotTeamIds) || v.pilotTeamIds.some((id) => typeof id !== "string" || !id.trim() || id.length > 64)) return null;
  if (v.plannedCutoverDate !== null) {
    if (typeof v.plannedCutoverDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v.plannedCutoverDate)) return null;
    const date = new Date(`${v.plannedCutoverDate}T00:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== v.plannedCutoverDate) return null;
  }
  return { mode: v.mode, pilotTeamIds: [...new Set(v.pilotTeamIds as string[])], plannedCutoverDate: v.plannedCutoverDate as string | null };
}
export function isPilotTeam(setting: PipelineModeSetting, teamId: string | null): boolean { return teamId !== null && setting.pilotTeamIds.includes(teamId); }
export function officialPipelineSource(setting: PipelineModeSetting): "PROJECT" | "OPPORTUNITY" { return setting.mode === "PROJECT_OFFICIAL" ? "PROJECT" : "OPPORTUNITY"; }
export function excludeFromLegacyReport(setting: PipelineModeSetting, project: { sourceOpportunityTeamId: string | null }): boolean { return setting.mode === "PROJECT_OFFICIAL" && isPilotTeam(setting, project.sourceOpportunityTeamId); }
export function canCreateClientProjectDirectly(setting: PipelineModeSetting, input: { actorTeamId: string | null; isPurchaseOrderImport: boolean }): boolean { return input.isPurchaseOrderImport || (setting.mode === "PROJECT_OFFICIAL" && !isPilotTeam(setting, input.actorTeamId)); }
export function pipelineReportLabels(setting: PipelineModeSetting): { pipelineSubtitle: string; legacyBadge: string | null } {
  return setting.mode === "PROJECT_OFFICIAL" && setting.pilotTeamIds.length ? { pipelineSubtitle: "Báo cáo pilot · Nguồn: Cơ hội của team pilot", legacyBadge: "Chưa gồm deal của team pilot" } : { pipelineSubtitle: "Nguồn: Cơ hội", legacyBadge: null };
}
