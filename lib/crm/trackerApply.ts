import type { Prisma, PrismaClient } from "@prisma/client";
import { clientNameError, clientNameKey, normalizeClientName } from "../clientCatalog";
import { crmCan, type CrmActor } from "./policy";
import { parseTrackerDate, TRACKER_COLUMN_MAP } from "./trackerImport";

type Json = Record<string, unknown>;
type Actor = CrmActor & { name?: string };
export type ResolveImportInput = { rowId: string; action: "MATCH" | "CREATE_NEW" | "EDIT" | "SKIP"; matchedClientId?: string; proposedPatch?: Record<string, unknown> };
const DENIED = "Bạn không có quyền rà dữ liệu nhập.";
const INVALID = "Dữ liệu ánh xạ chưa hợp lệ. Kiểm tra tên khách, PIC và thời gian.";
const object = (v: unknown): Json => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Json : {};
const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
const id = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 64;
const date = (v: unknown): Date | null => {
  if (typeof v !== "string" && !(v instanceof Date)) return null;
  const d = new Date(v); return Number.isFinite(d.getTime()) ? d : null;
};
function periodParts(v: unknown) {
  const p = object(v);
  if (p.kind === "DATE") {
    const d = date(p.date);
    return d ? { year: new Date(d.getTime() + 7 * 3600000).getUTCFullYear(), month: new Date(d.getTime() + 7 * 3600000).getUTCMonth() + 1, quarter: null } : null;
  }
  if (!Number.isInteger(p.year) || Number(p.year) < 1900 || Number(p.year) > 2200) return null;
  if (p.kind === "MONTH" && Number.isInteger(p.month) && Number(p.month) >= 1 && Number(p.month) <= 12) return { year: Number(p.year), month: Number(p.month), quarter: null };
  if (p.kind === "QUARTER" && Number.isInteger(p.quarter) && Number(p.quarter) >= 1 && Number(p.quarter) <= 4) return { year: Number(p.year), month: null, quarter: Number(p.quarter) };
  return null;
}
const headerKey = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").trim().replace(/\s+/g, " ").toLowerCase();
export function trackerRawField(raw: unknown, field: keyof typeof TRACKER_COLUMN_MAP.BRIEF): string | null {
  const aliases = TRACKER_COLUMN_MAP.BRIEF[field].map(headerKey);
  const entry = Object.entries(object(raw)).find(([key]) => aliases.includes(headerKey(key)));
  return typeof entry?.[1] === "string" ? entry[1] : null;
}
function rawDate(raw: unknown, field: "briefDate" | "lastTouchDate") {
  const value = trackerRawField(raw, field);
  const parsed = parseTrackerDate(value);
  return parsed?.kind === "DATE" ? parsed.date : null;
}
function sheetKind(sheet: string) {
  const key = headerKey(sheet);
  return ["brief", "lost log", "deal lost log"].includes(key) ? "OPPORTUNITY" : ["prospect", "cskh"].includes(key) ? "TOUCH" : null;
}
async function validateProposed(tx: Prisma.TransactionClient, p: Json, sheet: string) {
  if (typeof p.clientName !== "string" || clientNameError(p.clientName) || !id(p.picAccountId)) return false;
  const pic = await tx.account.findUnique({ where: { id: p.picAccountId }, select: { user: { select: { isActive: true, deletedAt: true } } } });
  if (!pic || (pic.user && (!pic.user.isActive || pic.user.deletedAt))) return false;
  if (p.matchedClientId && (!id(p.matchedClientId) || !await tx.client.findUnique({ where: { id: p.matchedClientId }, select: { id: true } }))) return false;
  if (p.period != null && !periodParts(p.period)) return false;
  for (const key of ["briefReceivedAt", "occurredAt"]) if (p[key] != null && !date(p[key])) return false;
  if (sheetKind(sheet) === "OPPORTUNITY") {
    if (!periodParts(p.period) || !id(p.programTypeCode)) return false;
    if (!await tx.programType.findFirst({ where: { code: p.programTypeCode, active: true }, select: { code: true } })) return false;
  }
  if (p.reasonId != null && (!id(p.reasonId) || !await tx.crmReason.findFirst({ where: { id: p.reasonId, active: true }, select: { id: true } }))) return false;
  return sheetKind(sheet) !== null;
}

export async function resolveImportRow(db: PrismaClient, actor: Actor, input: ResolveImportInput): Promise<{ ok: true } | { error: string }> {
  if (!crmCan(actor, "REVIEW_IMPORT")) return { error: DENIED };
  if (!input || !id(input.rowId) || !["MATCH", "CREATE_NEW", "EDIT", "SKIP"].includes(input.action)) return { error: INVALID };
  const ref = await db.trackerImportRow.findUnique({ where: { id: input.rowId }, select: { runId: true } });
  if (!ref) return { error: "Không tìm thấy dòng nhập." };
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "TrackerImportRun" WHERE id = ${ref.runId} FOR UPDATE`;
    const row = await tx.trackerImportRow.findUniqueOrThrow({ where: { id: input.rowId } });
    const proposed = { ...object(row.proposed) };
    if (proposed.applied) return { error: "Dòng này đã được nhập." };
    if (input.action === "MATCH") {
      if (!id(input.matchedClientId) || !await tx.client.findUnique({ where: { id: input.matchedClientId }, select: { id: true } })) return { error: "Chọn khách hàng hiện có." };
      proposed.matchedClientId = input.matchedClientId;
      proposed.clientResolution = "MATCH";
    } else if (input.action === "CREATE_NEW") {
      proposed.matchedClientId = null;
      proposed.clientResolution = "CREATE_NEW";
    } else if (input.action === "EDIT") {
      const patch = object(input.proposedPatch);
      for (const key of ["clientName", "programTypeCode", "picAccountId", "period", "reasonId", "briefReceivedAt", "occurredAt"] as const) {
        if (Object.hasOwn(patch, key)) proposed[key] = patch[key];
      }
    }
    if (input.action !== "SKIP" && !await validateProposed(tx, proposed, row.sheet)) return { error: INVALID };
    await tx.trackerImportRow.update({ where: { id: row.id }, data: { proposed: json(proposed), matchedClientId: typeof proposed.matchedClientId === "string" ? proposed.matchedClientId : null, status: input.action === "SKIP" ? "SKIPPED" : "CONFIRMED", resolvedById: actor.id, resolvedAt: new Date() } });
    return { ok: true as const };
  });
}

// One run lock covers row application and cross-row grouping. Every row commits independently.
export async function applyImportRun(db: PrismaClient, actor: Actor, runId: string): Promise<{ ok: true; applied: number; errors: { rowId: string; error: string }[]; summary: Record<string, number> } | { error: string }> {
  if (!crmCan(actor, "REVIEW_IMPORT")) return { error: DENIED };
  if (!id(runId)) return { error: INVALID };
  if (!await db.trackerImportRun.findUnique({ where: { id: runId }, select: { id: true } })) return { error: "Không tìm thấy lượt nhập." };
  const rows = await db.trackerImportRow.findMany({ where: { runId, status: { in: ["OK", "CONFIRMED"] } }, select: { id: true }, orderBy: [{ sheet: "asc" }, { rowNumber: "asc" }] });
  const errors: { rowId: string; error: string }[] = [];
  let applied = 0;
  for (const ref of rows) {
    try {
      const changed = await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "TrackerImportRun" WHERE id = ${runId} FOR UPDATE`;
        const row = await tx.trackerImportRow.findUniqueOrThrow({ where: { id: ref.id } });
        const p = { ...object(row.proposed) };
        if (p.applied || !["OK", "CONFIRMED"].includes(row.status)) return false;
        if (!await validateProposed(tx, p, row.sheet)) throw new Error(INVALID);
        const name = normalizeClientName(p.clientName as string);
        const nameKey = clientNameKey(name);
        // Serializes normalized client creation even across different runs.
        await tx.$queryRaw`SELECT 1::int AS locked FROM pg_advisory_xact_lock(hashtext(${nameKey}))`;
        const pic = await tx.account.findUniqueOrThrow({ where: { id: p.picAccountId as string }, select: { teamId: true } });
        let clientId = typeof p.matchedClientId === "string" ? p.matchedClientId : null;
        if (!clientId) {
          const candidates = await tx.client.findMany({ select: { id: true, name: true } });
          const matches = candidates.filter((c) => clientNameKey(c.name) === nameKey);
          if (matches.length > 1 || (matches.length && p.clientResolution === "CREATE_NEW")) throw new Error("Tên khách đã tồn tại. Ghép khách hoặc sửa tên trước khi tạo mới.");
          clientId = matches[0]?.id ?? (await tx.client.create({ data: { name, picAccountId: p.picAccountId as string, responsibleTeamId: pic.teamId, importStatus: "PENDING_PIC_CONFIRM" } })).id;
        }
        const client = await tx.client.findUniqueOrThrow({ where: { id: clientId }, select: { picAccountId: true, responsibleTeamId: true } });
        await tx.client.update({ where: { id: clientId }, data: { importStatus: "PENDING_PIC_CONFIRM", importConfirmedAt: null, picAccountId: client.picAccountId ?? p.picAccountId as string, responsibleTeamId: client.responsibleTeamId ?? pic.teamId, version: { increment: 1 } } });
        const marker: { clientId: string; opportunityId?: string; touchpointId?: string } = { clientId };
        if (sheetKind(row.sheet) === "OPPORTUNITY") {
          const period = periodParts(p.period)!;
          // Canonical key follows reviewed values and actual matched identity, never a stale parser key.
          const key = JSON.stringify([clientId, p.programTypeCode, period.year]);
          const siblings = await tx.trackerImportRow.findMany({ where: { runId }, select: { proposed: true } });
          const previous = siblings.map((r) => object(r.proposed)).find((r) => r.appliedOpportunityKey === key && id(object(r.applied).opportunityId));
          const brief = date(p.briefReceivedAt) ?? rawDate(row.raw, "briefDate");
          if (!brief && trackerRawField(row.raw, "briefDate")?.trim()) throw new Error("Ngày Brief chưa rõ. Sửa dữ liệu trước khi nhập.");
          const rawOutcome = trackerRawField(row.raw, "outcome") ?? (typeof p.legacyOutcome === "string" ? p.legacyOutcome : null);
          const outcome = typeof p.outcome === "string" ? p.outcome : null;
          const allowed = ["WON", "LOST_COMPETITIVE", "CUSTOMER_CANCELLED", "CS_DECLINED", "LEGACY_UNCLASSIFIED"];
          const importedOutcome = outcome && allowed.includes(outcome) ? outcome : "LEGACY_UNCLASSIFIED";
          const legacyStatus = importedOutcome === "LEGACY_UNCLASSIFIED" ? rawOutcome : null;
          let opportunityId = previous ? object(previous.applied).opportunityId as string : null;
          if (opportunityId) {
            await tx.$queryRaw`SELECT id FROM "Opportunity" WHERE id = ${opportunityId} FOR UPDATE`;
            const existing = await tx.opportunity.findUniqueOrThrow({ where: { id: opportunityId } });
            await tx.opportunity.update({ where: { id: opportunityId }, data: {
              version: { increment: 1 },
              ...(brief ? { stage: "BIDDING", briefReceivedAt: existing.briefReceivedAt ?? brief } : {}),
              ...(outcome ? { outcome: importedOutcome, legacyStatus, outcomeReasonId: typeof p.reasonId === "string" ? p.reasonId : null } : {}),
            } });
          } else {
            const opportunity = await tx.opportunity.create({ data: { clientId, name: `${name} · ${p.programTypeCode} · ${period.year}`, programTypeCode: p.programTypeCode as string, expectedYear: period.year, expectedMonth: period.month, expectedQuarter: period.quarter, stage: brief ? "BIDDING" : "CARE", briefReceivedAt: brief, source: "OTHER", demandSignal: "Nhập từ tracker", picAccountId: p.picAccountId as string, responsibleTeamId: pic.teamId, outcome: importedOutcome, legacyStatus, outcomeReasonId: typeof p.reasonId === "string" ? p.reasonId : null, createdById: actor.id } });
            opportunityId = opportunity.id;
            await tx.opportunityStageEvent.create({ data: { opportunityId, toStage: opportunity.stage, outcome: opportunity.outcome, actorId: actor.id, actorName: actor.name ?? "Người rà dữ liệu", note: "Nhập từ tracker" } });
          }
          marker.opportunityId = opportunityId;
          p.appliedOpportunityKey = key;
        } else {
          const touch = object(p.touch);
          const occurredAt = date(p.occurredAt) ?? date(touch.date) ?? rawDate(row.raw, "lastTouchDate");
          if (occurredAt) {
            const level = Number.isInteger(touch.level) && Number(touch.level) >= 1 && Number(touch.level) <= 4 ? Number(touch.level) : null;
            const created = await tx.touchpoint.create({ data: { clientId, kind: "OTHER", occurredAt, outcomeLevel: level, sourceType: "IMPORT", sourceId: row.id, status: level ? "CONFIRMED" : "DRAFT", authorId: actor.id, confirmedById: level ? actor.id : null, confirmedAt: level ? new Date() : null, notes: trackerRawField(row.raw, "note") } });
            marker.touchpointId = created.id;
          } else if (trackerRawField(row.raw, "lastTouchDate")?.trim()) throw new Error("Ngày điểm chạm chưa rõ. Sửa dữ liệu trước khi nhập.");
        }
        p.applied = marker;
        await tx.trackerImportRow.update({ where: { id: row.id }, data: { proposed: json(p), matchedClientId: clientId } });
        return true;
      }, { timeout: 15000 });
      if (changed) applied++;
    } catch (error) {
      errors.push({ rowId: ref.id, error: error instanceof Error && [INVALID, "Tên khách đã tồn tại. Ghép khách hoặc sửa tên trước khi tạo mới.", "Ngày điểm chạm chưa rõ. Sửa dữ liệu trước khi nhập.", "Ngày Brief chưa rõ. Sửa dữ liệu trước khi nhập."].includes(error.message) ? error.message : "Không nhập được dòng này. Vui lòng kiểm tra lại." });
    }
  }
  const summary = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "TrackerImportRun" WHERE id = ${runId} FOR UPDATE`;
    const all = await tx.trackerImportRow.findMany({ where: { runId }, select: { status: true, proposed: true } });
    const counts: Record<string, number> = { total: all.length, applied: 0 };
    for (const row of all) { counts[row.status] = (counts[row.status] ?? 0) + 1; if (object(row.proposed).applied) counts.applied++; }
    await tx.trackerImportRun.update({ where: { id: runId }, data: { mode: counts.applied ? "APPLIED" : "DRY_RUN", summary: counts } });
    return counts;
  });
  return { ok: true as const, applied, errors, summary };
}
