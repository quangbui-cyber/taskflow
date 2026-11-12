import type { Prisma, PrismaClient } from "@prisma/client";
import { vnDateKey } from "./dates";
import { parsePipelineMode } from "./pipelineMode";
import { isTierConfigured, parseCadenceWeeks, parsePotentialScale, parseTierMatrix } from "./settingsSchema";
import { parsePersonaDepth, personaDepthConfigured } from "./personaDepth";
import { CRM_ACCESS_SETTING_KEY, parseCrmAccessUsers } from "../features";

export type PrepilotItemKey =
  | "TIER_CADENCE" | "POTENTIAL_SCALE" | "TIER_MATRIX" | "PILOT_TEAM" | "TEAM_MANAGERS" | "DATA_STEWARD"
  | "PLANNED_CUTOVER" | "REASONS_LOST" | "REASONS_CANCELLED" | "REASONS_DECLINED" | "PERSONA_DEPTH" | "ACCESS_LIST";
export type PrepilotSection = "TIER" | "ACCESS" | "SOURCE" | "REASONS" | "PERSONA" | "ACCESS_LIST";
export type PrepilotStatus = "CONFIGURED" | "NOT_CONFIGURED" | "NOT_APPLICABLE";

export const PREPILOT_STATUS_LABELS: Record<PrepilotStatus, string> = {
  CONFIGURED: "Đã cấu hình",
  NOT_CONFIGURED: "Chưa cấu hình",
  NOT_APPLICABLE: "Không áp dụng",
};

export type PrepilotItem = { key: PrepilotItemKey; section: PrepilotSection; label: string; status: PrepilotStatus; detail: string };
export type PrepilotInput = {
  cadenceWeeksRaw: unknown;
  potentialScaleRaw: unknown;
  tierMatrixRaw: unknown;
  personaDepthRaw?: unknown;
  pipelineModeRaw: unknown;
  teams: { id: string; name: string; activeManagerCount: number }[];
  activeStewardCount: number;
  /** crm54: active non-Admin users in access.users. Missing means not loaded and reads as an empty list. */
  crmAccessUserCount?: number;
  reasons: { group: string; active: boolean; requiresNote: boolean }[];
  today: string;
};

function configured(value: boolean): PrepilotStatus {
  return value ? "CONFIGURED" : "NOT_CONFIGURED";
}

function displayDate(date: string): string {
  return date.split("-").reverse().join("/");
}

function cutoverItem(mode: ReturnType<typeof parsePipelineMode>, selected: ReturnType<typeof parsePipelineMode>, today: string): PrepilotItem {
  const item = { key: "PLANNED_CUTOVER", section: "SOURCE", label: "Ngày chuyển thống nhất dự kiến" } as const;
  if (selected?.mode !== "PROJECT_OFFICIAL" || selected.pilotTeamIds.length === 0) {
    return { ...item, status: "NOT_APPLICABLE", detail: "Chỉ áp dụng khi pilot chạy nhánh dự phòng" };
  }
  const date = mode?.plannedCutoverDate;
  if (!date) return { ...item, status: "NOT_CONFIGURED", detail: "Chưa đặt ngày" };
  if (date < today) return { ...item, status: "NOT_CONFIGURED", detail: `Ngày đã qua: ${displayDate(date)}` };
  return { ...item, status: "CONFIGURED", detail: displayDate(date) };
}

const NON_BLOCKING: readonly PrepilotItemKey[] = ["ACCESS_LIST"];

export function evaluatePrepilot(input: PrepilotInput): { items: PrepilotItem[]; ready: boolean; missing: PrepilotItemKey[] } {
  const cadence = parseCadenceWeeks(input.cadenceWeeksRaw);
  const scale = parsePotentialScale(input.potentialScaleRaw) ?? [];
  const matrix = isTierConfigured(parseTierMatrix(input.tierMatrixRaw), scale);
  const personaDepth = parsePersonaDepth(input.personaDepthRaw);
  const personaReady = !!personaDepth && personaDepthConfigured(personaDepth);
  const raw = input.pipelineModeRaw;
  const pipeline = parsePipelineMode(raw);
  // A bad date must not hide the cutover requirement when the stored mode and teams are otherwise valid.
  const selected = pipeline ?? (raw && typeof raw === "object" && !Array.isArray(raw)
    ? parsePipelineMode({ ...raw, plannedCutoverDate: null }) : null);
  const pilotIds = new Set(selected?.pilotTeamIds ?? []);
  const pilotTeams = input.teams.filter(({ id }) => pilotIds.has(id));
  const validPilot = pilotIds.size > 0 && pilotTeams.length === pilotIds.size;
  const invalidOfficialMode = !pipeline && selected?.mode === "OPPORTUNITY_OFFICIAL";
  const targetTeams = pilotIds.size ? pilotTeams : input.teams;
  const missingManagers = targetTeams.filter((team) => team.activeManagerCount < 1);
  const reasonGroups = [
    ["LOST", "Thua cạnh tranh"],
    ["CANCELLED", "Khách hủy"],
    ["DECLINED", "CS không tham gia"],
  ] as const;

  const items: PrepilotItem[] = [
    { key: "TIER_CADENCE", section: "TIER", label: "Chu kỳ nhắc theo hạng", status: configured(!!cadence),
      detail: cadence ? `S ${cadence.S} · A ${cadence.A} · B ${cadence.B} · C ${cadence.C} · Chưa xếp hạng ${cadence.UNRATED} tuần` : "Thiếu chu kỳ hợp lệ" },
    { key: "POTENTIAL_SCALE", section: "TIER", label: "Thang tiềm năng", status: configured(scale.length > 0),
      detail: scale.length ? `${scale.length} mức` : "Chưa có mức nào" },
    { key: "TIER_MATRIX", section: "TIER", label: "Bảng ghép hạng", status: configured(matrix),
      detail: matrix ? "Đủ ô" : "Thiếu ô" },
    { key: "PERSONA_DEPTH", section: "PERSONA", label: "Độ sâu persona theo hạng", status: configured(personaReady),
      detail: personaReady ? "Đã thiết lập đủ 5 hạng" : "Còn hạng chưa thiết lập" },
    { key: "PILOT_TEAM", section: "SOURCE", label: "Team pilot", status: configured(validPilot && !invalidOfficialMode),
      detail: !pilotIds.size ? "Chưa chọn team pilot" : !validPilot ? "Team không còn tồn tại"
        : invalidOfficialMode ? "Cấu hình nguồn báo cáo không hợp lệ" : pilotTeams.map(({ name }) => name).join(", ") },
    { key: "TEAM_MANAGERS", section: "ACCESS", label: "AD/AM theo team", status: configured(missingManagers.length === 0),
      detail: missingManagers.length ? `Thiếu AD/AM: ${missingManagers.map(({ name }) => name).join(", ")}` : `${targetTeams.length} team có AD/AM` },
    { key: "DATA_STEWARD", section: "ACCESS", label: "Người giữ chất lượng dữ liệu", status: configured(input.activeStewardCount > 0),
      detail: input.activeStewardCount ? `${input.activeStewardCount} người đang hoạt động` : "Chưa có người giữ chất lượng dữ liệu" },
    { key: "ACCESS_LIST", section: "ACCESS_LIST", label: "Người dùng CRM", status: configured((input.crmAccessUserCount ?? 0) > 0),
      detail: input.crmAccessUserCount ? `${input.crmAccessUserCount} người ngoài Admin` : "Chỉ Admin" },
    cutoverItem(pipeline, selected, input.today),
    ...reasonGroups.map(([group, name]): PrepilotItem => {
      const active = input.reasons.filter((reason) => reason.group === group && reason.active);
      const hasNotePath = active.some((reason) => reason.requiresNote);
      return {
        key: `REASONS_${group}`, section: "REASONS", label: `Lý do ${name}`, status: configured(hasNotePath),
        detail: hasNotePath ? `${active.length} lý do đang dùng` : active.length ? "Thiếu lý do yêu cầu ghi chú" : "Chưa có lý do đang dùng",
      };
    }),
  ];
  // crm54: an empty access list is a warning only; it never blocks readiness.
  const missing = items.filter(({ status, key }) => status === "NOT_CONFIGURED" && !NON_BLOCKING.includes(key)).map(({ key }) => key);
  return { items, missing, ready: missing.length === 0 };
}

export function prepilotSectionFlags({ items }: ReturnType<typeof evaluatePrepilot>): Record<PrepilotSection, boolean> {
  const flags = { TIER: false, ACCESS: false, SOURCE: false, REASONS: false, PERSONA: false, ACCESS_LIST: false };
  for (const { status, section } of items) if (status === "NOT_CONFIGURED") flags[section] = true;
  return flags;
}

const keys = ["tier.cadenceWeeks", "tier.potentialScale", "tier.matrix", "pipeline.mode", "persona.depth", CRM_ACCESS_SETTING_KEY];

export async function loadPrepilotInput(db: PrismaClient | Prisma.TransactionClient, now: Date): Promise<PrepilotInput> {
  const activeUser = { isActive: true, deletedAt: null } as const;
  const [rows, teams, activeStewardCount, reasons] = await Promise.all([
    db.crmSetting.findMany({ where: { key: { in: keys } }, select: { key: true, value: true } }),
    db.salesTeam.findMany({
      select: { id: true, name: true, _count: { select: { crmManagedTeam: { where: { user: activeUser } } } } },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    }),
    db.user.count({ where: { ...activeUser, isCrmDataSteward: true } }),
    db.crmReason.findMany({ select: { group: true, active: true, requiresNote: true } }),
  ]);
  const raw = new Map(rows.map(({ key, value }) => [key, value]));
  const accessIds = parseCrmAccessUsers(raw.get(CRM_ACCESS_SETTING_KEY)) ?? [];
  const crmAccessUserCount = accessIds.length ? await db.user.count({ where: { ...activeUser, id: { in: accessIds }, role: { not: "ADMIN" } } }) : 0;
  return {
    cadenceWeeksRaw: raw.get("tier.cadenceWeeks") ?? null,
    potentialScaleRaw: raw.get("tier.potentialScale") ?? null,
    tierMatrixRaw: raw.get("tier.matrix") ?? null,
    personaDepthRaw: raw.get("persona.depth") ?? null,
    pipelineModeRaw: raw.get("pipeline.mode") ?? null,
    teams: teams.map(({ id, name, _count }) => ({ id, name, activeManagerCount: _count.crmManagedTeam })),
    activeStewardCount, crmAccessUserCount, reasons, today: vnDateKey(now),
  };
}
