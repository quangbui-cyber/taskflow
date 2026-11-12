import type { Prisma, PrismaClient } from "@prisma/client";
import { OPEN_TASK_STATUS_FILTER } from "../types";
import { vnDateKey, vnDayStart } from "./dates";
import { crmCan, type CrmActor, type CrmOwnerResource } from "./policy";
import { resolveCrmView } from "./viewPreference";
import { daysInStage, formatExpectedTiming } from "./opportunityFormat";

type Db = PrismaClient | Prisma.TransactionClient;
export const OPPORTUNITY_PAGE_SIZE = 50;
export type OpportunityListView = "OPEN" | "CARE" | "BRIEF" | "BIDDING" | "CLOSED";
export type OpportunityListParams = { view: OpportunityListView; picAccountId: string | null; teamId: string | null; programTypeCode: string | null; page: number };
export function parseOpportunityListParams(raw: Record<string, string | string[] | undefined>): OpportunityListParams {
  const value = (key: string) => typeof raw[key] === "string" ? raw[key].trim() : "";
  const view = value("view");
  const page = value("page");
  return {
    view: (["OPEN", "CARE", "BRIEF", "BIDDING", "CLOSED"] as const).find(v => v === view) ?? "OPEN",
    picAccountId: value("pic").slice(0, 64) || null,
    teamId: value("team").slice(0, 64) || null,
    programTypeCode: value("program").slice(0, 64) || null,
    page: /^\d+$/.test(page) ? Math.max(1, Math.min(100, Number(page))) : 1,
  };
}
type BaseRow = { id: string; name: string; clientId: string; clientName: string; buyingUnitName: string | null; picName: string | null };
export type OpenOpportunityRow = BaseRow & {
  programTypeCode: string; programTypeLabel: string; stage: string; timingLabel: string;
  budgetMin: number | null; budgetMax: number | null;
  nextStep: { title: string; dueDate: Date | null; overdue: boolean } | null; daysInStage: number;
};
export type ClosedOpportunityRow = BaseRow & {
  outcome: string; reasonLabel: string | null; outcomeNote: string | null; legacyStatus: string | null;
  closedAt: Date | null; contractValue: number | null; projectId: string | null;
};
export type OpportunityListData = { view: OpportunityListView; total: number; hasMore: boolean; openRows?: OpenOpportunityRow[]; closedRows?: ClosedOpportunityRow[] };
const nextTask = {
  where: { status: OPEN_TASK_STATUS_FILTER },
  orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }, { id: "asc" }],
  take: 1,
  select: { title: true, dueDate: true },
} satisfies Prisma.TaskFindManyArgs;
const rowSelect = {
  id: true, name: true, clientId: true, client: { select: { name: true } }, buyingUnit: { select: { name: true } },
  picAccount: { select: { name: true } }, programTypeCode: true, programType: { select: { label: true } },
  stage: true, expectedYear: true, expectedMonth: true, expectedQuarter: true, budgetMin: true, budgetMax: true,
  outcome: true, outcomeNote: true, outcomeReason: { select: { label: true } }, legacyStatus: true, closedAt: true,
  contractValue: true, project: { select: { id: true } }, createdAt: true,
  opportunityStageEvents: { orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: 1, select: { occurredAt: true } },
  taskOpportunity: nextTask,
} satisfies Prisma.OpportunitySelect;

/** PIC, team and program filters shared by the list and the crm51 board. */
function opportunityFilterWhere(params: Pick<OpportunityListParams, "picAccountId" | "teamId" | "programTypeCode">): Prisma.OpportunityWhereInput {
  const conditions: Prisma.OpportunityWhereInput[] = [];
  if (params.picAccountId) conditions.push({ picAccountId: params.picAccountId });
  if (params.programTypeCode) conditions.push({ programTypeCode: params.programTypeCode });
  if (params.teamId) conditions.push({ OR: [
    { responsibleTeamId: params.teamId },
    { responsibleTeamId: null, picAccount: { teamId: params.teamId } },
    { responsibleTeamId: null, picAccountId: null, client: { OR: [
      { responsibleTeamId: params.teamId },
      { responsibleTeamId: null, picAccount: { teamId: params.teamId } },
    ] } },
  ] });
  return { AND: conditions };
}

export async function loadOpportunityList(db: Db, params: OpportunityListParams, now: Date): Promise<OpportunityListData> {
  const conditions: Prisma.OpportunityWhereInput[] = [{ outcome: params.view === "CLOSED" ? { not: null } : null }, opportunityFilterWhere(params)];
  if (!["OPEN", "CLOSED"].includes(params.view)) conditions.push({ stage: params.view });
  const where: Prisma.OpportunityWhereInput = { AND: conditions };
  const skip = (params.page - 1) * OPPORTUNITY_PAGE_SIZE;
  const today = vnDayStart(now);
  if (params.view === "CLOSED") {
    const [total, rows] = await Promise.all([
      db.opportunity.count({ where }),
      db.opportunity.findMany({ where, select: rowSelect, orderBy: [{ closedAt: { sort: "desc", nulls: "last" } }, { name: "asc" }, { id: "asc" }], skip, take: OPPORTUNITY_PAGE_SIZE + 1 }),
    ]);
    return { view: params.view, total, hasMore: rows.length > OPPORTUNITY_PAGE_SIZE, closedRows: rows.slice(0, OPPORTUNITY_PAGE_SIZE).map(row => ({
      id: row.id, name: row.name, clientId: row.clientId, clientName: row.client.name, buyingUnitName: row.buyingUnit?.name ?? null,
      picName: row.picAccount?.name ?? null, outcome: row.outcome!, reasonLabel: row.outcomeReason?.label ?? null,
      outcomeNote: row.outcomeNote, legacyStatus: row.legacyStatus, closedAt: row.closedAt,
      contractValue: row.outcome === "WON" && row.contractValue !== null ? Number(row.contractValue) : null,
      projectId: row.project?.id ?? null,
    })) };
  }
  // Prisma cannot order parents by the earliest filtered child dueDate. Sort only
  // the compact keys globally, then hydrate at most 51 rows (never sort one page).
  const keys = await db.opportunity.findMany({ where, select: { id: true, name: true, taskOpportunity: { ...nextTask, select: { dueDate: true } } } });
  keys.sort((a, b) => Number(!!a.taskOpportunity.length) - Number(!!b.taskOpportunity.length)
    || (a.taskOpportunity[0]?.dueDate?.getTime() ?? Infinity) - (b.taskOpportunity[0]?.dueDate?.getTime() ?? Infinity)
    || a.name.localeCompare(b.name, "vi") || a.id.localeCompare(b.id));
  const ids = keys.slice(skip, skip + OPPORTUNITY_PAGE_SIZE + 1).map(row => row.id);
  const rows = ids.length ? await db.opportunity.findMany({ where: { AND: [where, { id: { in: ids } }] }, select: rowSelect, take: OPPORTUNITY_PAGE_SIZE + 1 }) : [];
  const byId = new Map(rows.map(row => [row.id, row]));
  return { view: params.view, total: keys.length, hasMore: skip + OPPORTUNITY_PAGE_SIZE < keys.length, openRows: ids.slice(0, OPPORTUNITY_PAGE_SIZE).flatMap(id => {
    const row = byId.get(id);
    if (!row) return [];
    const task = row.taskOpportunity[0];
    return [{ id: row.id, name: row.name, clientId: row.clientId, clientName: row.client.name, buyingUnitName: row.buyingUnit?.name ?? null,
      picName: row.picAccount?.name ?? null, programTypeCode: row.programTypeCode, programTypeLabel: row.programType.label,
      stage: row.stage, timingLabel: formatExpectedTiming(row), budgetMin: row.budgetMin === null ? null : Number(row.budgetMin),
      budgetMax: row.budgetMax === null ? null : Number(row.budgetMax),
      nextStep: task ? { title: task.title, dueDate: task.dueDate, overdue: !!task.dueDate && task.dueDate < today } : null,
      daysInStage: daysInStage(row.opportunityStageEvents[0]?.occurredAt ?? row.createdAt, now),
    }];
  }) };
}

export async function loadOpportunityFilterOptions(db: Db) {
  const [pics, teams, programTypes] = await Promise.all([
    db.account.findMany({ select: { id: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }] }),
    db.salesTeam.findMany({ select: { id: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }] }),
    db.programType.findMany({ where: { OR: [{ active: true }, { opportunities: { some: {} } }] }, select: { code: true, label: true }, orderBy: [{ order: "asc" }, { code: "asc" }] }),
  ]);
  return { pics, teams, programTypes };
}

// ---- crm51: Cơ hội dạng bảng kéo thả và dòng thời gian (sketch 006 screen 4) ----
const LIST_STAGE_VIEWS = ["OPEN", "CARE", "BRIEF", "BIDDING", "CLOSED"];
/** `view` is a mode (board, timeline, list) or a legacy list stage (OPEN, CARE, ... CLOSED) that implies the list. */
export function resolveOpportunityMode(raw: Record<string, string | string[] | undefined>, cookie: string | undefined, userId: string): "board" | "timeline" | "list" {
  if (typeof raw.view === "string" && LIST_STAGE_VIEWS.includes(raw.view)) return "list";
  return resolveCrmView("opportunities", raw.view, cookie, userId);
}

export type BoardColumnKey = "CARE" | "BRIEF" | "BIDDING" | "WON" | "ENDED";
export const BOARD_COLUMNS: { key: BoardColumnKey; label: string }[] = [
  { key: "CARE", label: "Chăm sóc" }, { key: "BRIEF", label: "Nhận Brief" }, { key: "BIDDING", label: "Bidding" }, { key: "WON", label: "Thắng" }, { key: "ENDED", label: "Kết thúc khác" },
];
export type BoardCard = {
  id: string; name: string; clientId: string; clientName: string; programTypeLabel: string; timingLabel: string;
  stage: string; outcome: string | null; column: BoardColumnKey; version: number;
  budgetMin: number | null; budgetMax: number | null; contractValue: number | null; projectId: string | null; reasonLabel: string | null;
  nextStep: { title: string; dueDate: Date | null; overdue: boolean } | null; proposalDueAt: Date | null; competitors: string[];
  pic: { accountId: string; name: string; userId: string | null } | null;
  expected: { year: number; month: number | null; quarter: number | null };
  dialog: { briefSummary: string | null; winStrategy: string | null; proposalDueAt: string | null; proposalPlannedAt: string | null; openBidPrepTaskCount: number; preview: { tasks: number; files: number; meetings: number } };
  rights: { canAdvance: boolean; canClose: boolean };
};
export type DropIntent = { kind: "NONE" } | { kind: "BRIEF" | "BIDDING" | "RESULT" | "END" } | { kind: "ERROR"; message: string };
const COLUMN_ORDER: BoardColumnKey[] = ["CARE", "BRIEF", "BIDDING", "WON", "ENDED"];
/**
 * Dropping never changes data: it only names the existing dialog to open. The server action behind that
 * dialog still checks stage rules, permission and version (canAdvance / canClose).
 */
export function boardDropIntent(card: Pick<BoardCard, "column" | "outcome" | "rights">, to: BoardColumnKey): DropIntent {
  if (card.column === to) return { kind: "NONE" };
  if (card.outcome !== null) return { kind: "ERROR", message: "Cơ hội đã kết thúc, không chuyển được." };
  if (COLUMN_ORDER.indexOf(to) < COLUMN_ORDER.indexOf(card.column)) return { kind: "ERROR", message: "Không chuyển ngược giai đoạn." };
  const denied = { kind: "ERROR" as const, message: "Bạn không có quyền sửa mục này. Liên hệ PIC hoặc AD/AM của team." };
  if (to === "BRIEF") return card.column === "CARE" ? card.rights.canAdvance ? { kind: "BRIEF" } : denied : { kind: "ERROR", message: "Không chuyển ngược giai đoạn." };
  if (to === "BIDDING") return card.column === "BRIEF" ? card.rights.canAdvance ? { kind: "BIDDING" } : denied : { kind: "ERROR", message: "Chuyển lần lượt: nhận Brief trước khi Bidding." };
  if (to === "WON") return card.column === "BIDDING" ? card.rights.canClose ? { kind: "RESULT" } : denied : { kind: "ERROR", message: "Chỉ ghi Thắng khi Cơ hội đang Bidding." };
  return card.rights.canClose ? { kind: card.column === "BIDDING" ? "RESULT" : "END" } : denied;
}
/** Column total as a range: each card adds its min (or max) to the low end and its max (or min) to the high end. */
export function budgetSpan(cards: Pick<BoardCard, "budgetMin" | "budgetMax">[]): { min: number; max: number } | null {
  const priced = cards.filter(c => c.budgetMin !== null || c.budgetMax !== null);
  if (!priced.length) return null;
  return { min: priced.reduce((s, c) => s + (c.budgetMin ?? c.budgetMax ?? 0), 0), max: priced.reduce((s, c) => s + (c.budgetMax ?? c.budgetMin ?? 0), 0) };
}
/** Timeline buckets by organization month, then quarter-only, then year-only, chronologically. */
export function timelineBuckets<T extends { expected: BoardCard["expected"] }>(cards: T[]): { key: string; label: string; cards: T[] }[] {
  const buckets = new Map<string, { key: string; label: string; sort: number; cards: T[] }>();
  for (const card of cards) {
    const { year, month, quarter } = card.expected;
    const entry = month ? { key: `${year}-M${month}`, label: `T${month}/${year}`, sort: year * 1000 + month * 10 }
      : quarter ? { key: `${year}-Q${quarter}`, label: `Quý ${quarter}/${year}`, sort: year * 1000 + ((quarter - 1) * 3 + 1) * 10 + 5 }
      : { key: `${year}`, label: `Năm ${year}, chưa rõ tháng`, sort: year * 1000 + 999 };
    const bucket = buckets.get(entry.key) ?? { ...entry, cards: [] };
    bucket.cards.push(card); buckets.set(entry.key, bucket);
  }
  return [...buckets.values()].sort((a, b) => a.sort - b.sort).map(({ key, label, cards: list }) => ({ key, label, cards: list }));
}

const boardSelect = {
  id: true, name: true, clientId: true, client: { select: { name: true, responsibleTeamId: true, picAccount: { select: { teamId: true } } } },
  programType: { select: { label: true } }, stage: true, outcome: true, version: true, expectedYear: true, expectedMonth: true, expectedQuarter: true,
  budgetMin: true, budgetMax: true, contractValue: true, project: { select: { id: true } }, outcomeReason: { select: { label: true } },
  proposalDueAt: true, proposalPlannedAt: true, briefSummary: true, winStrategy: true, responsibleTeamId: true,
  picAccount: { select: { id: true, name: true, userId: true, teamId: true } },
  opportunityCompetitors: { select: { competitor: { select: { name: true } } }, orderBy: { competitor: { name: "asc" } } },
  taskOpportunity: nextTask,
  _count: { select: { taskOpportunity: true, projectFileOpportunity: true, meetingOpportunity: true } },
} satisfies Prisma.OpportunitySelect;
export const BOARD_LIMIT = 300;
/** Open Opportunities plus those closed in the chosen period, with the counts the stage dialogs need (no N+1). */
export async function loadOpportunityBoard(db: Db, actor: CrmActor, params: Pick<OpportunityListParams, "picAccountId" | "teamId" | "programTypeCode">, period: { start: Date; end: Date }, now: Date) {
  const where = opportunityFilterWhere(params);
  const [rows, openTaskCounts] = await Promise.all([
    db.opportunity.findMany({ where: { AND: [where, { OR: [{ outcome: null }, { outcome: { not: null }, closedAt: { gte: period.start, lt: period.end } }] }] }, select: boardSelect, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], take: BOARD_LIMIT + 1 }),
    db.task.groupBy({ by: ["opportunityId"], where: { opportunity: { AND: [where, { outcome: null }] }, status: OPEN_TASK_STATUS_FILTER }, _count: { _all: true } }),
  ]);
  const openTasks = new Map(openTaskCounts.map(r => [r.opportunityId, r._count._all]));
  const today = vnDayStart(now);
  const iso = (d: Date | null) => d ? vnDateKey(d) : null;
  const cards: BoardCard[] = rows.slice(0, BOARD_LIMIT).map(row => {
    const resource: CrmOwnerResource = { kind: "OPPORTUNITY", picUserId: row.picAccount?.userId ?? null, teamId: row.responsibleTeamId ?? row.picAccount?.teamId ?? row.client.responsibleTeamId ?? row.client.picAccount?.teamId ?? null, closed: row.outcome !== null };
    const task = row.taskOpportunity[0];
    return {
      id: row.id, name: row.name, clientId: row.clientId, clientName: row.client.name, programTypeLabel: row.programType.label, timingLabel: formatExpectedTiming(row),
      stage: row.stage, outcome: row.outcome, column: row.outcome === null ? row.stage as BoardColumnKey : row.outcome === "WON" ? "WON" : "ENDED", version: row.version,
      budgetMin: row.budgetMin === null ? null : Number(row.budgetMin), budgetMax: row.budgetMax === null ? null : Number(row.budgetMax),
      contractValue: row.contractValue === null ? null : Number(row.contractValue), projectId: row.project?.id ?? null, reasonLabel: row.outcomeReason?.label ?? null,
      nextStep: task ? { title: task.title, dueDate: task.dueDate, overdue: !!task.dueDate && task.dueDate < today } : null, proposalDueAt: row.proposalDueAt,
      competitors: row.opportunityCompetitors.map(c => c.competitor.name),
      pic: row.picAccount ? { accountId: row.picAccount.id, name: row.picAccount.name, userId: row.picAccount.userId } : null,
      expected: { year: row.expectedYear, month: row.expectedMonth, quarter: row.expectedQuarter },
      dialog: { briefSummary: row.briefSummary, winStrategy: row.winStrategy, proposalDueAt: iso(row.proposalDueAt), proposalPlannedAt: iso(row.proposalPlannedAt), openBidPrepTaskCount: openTasks.get(row.id) ?? 0, preview: { tasks: row._count.taskOpportunity, files: row._count.projectFileOpportunity, meetings: row._count.meetingOpportunity } },
      rights: { canAdvance: crmCan(actor, "EDIT", resource), canClose: crmCan(actor, "CLOSE_OPPORTUNITY", resource) },
    };
  });
  return { cards, truncated: rows.length > BOARD_LIMIT };
}
export type OpportunityBoardData = Awaited<ReturnType<typeof loadOpportunityBoard>>;
