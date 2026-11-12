import type { Prisma, PrismaClient } from "@prisma/client";
import { clientNameKey } from "../clientCatalog";
import { crmCan, type CrmActor } from "./policy";
import { PLAYBOOK_FIELDS, playbookHistoryValue } from "./clientHub";

export function clientDuplicateKey(name: string): string {
  const key = name.normalize("NFKC").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, " ").trim()
    .replace(/\b(?:cong ty|co phan|cty|tnhh|mtv|cp|jsc|co|ltd|llc|inc|corp|corporation|company)\b/g, " ")
    .replace(/\s+/g, " ").trim();
  return key || clientNameKey(name);
}

type DuplicateClient = { id: string; name: string; createdAt: Date };
export function findDuplicateClientPairs<T extends DuplicateClient>(clients: T[]) {
  const groups = new Map<string, T[]>();
  for (const client of clients) {
    const key = clientDuplicateKey(client.name);
    const group = groups.get(key) ?? []; group.push(client); groups.set(key, group);
  }
  const pairs: { key: string; a: T; b: T }[] = [];
  for (const [key, group] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    group.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) pairs.push({ key, a: group[i], b: group[j] });
  }
  return pairs;
}

type Db = PrismaClient | Prisma.TransactionClient;
export type MergeClientSide = { id: string; name: string; version: number; projectCount: number; opportunityCount: number; openTaskCount: number; touchpointCount: number };
export type DuplicateClientPair = { key: string; a: MergeClientSide; b: MergeClientSide; suggestedTargetId: string };

export async function listDuplicateClientPairs(db: Db): Promise<DuplicateClientPair[]> {
  const [clients, tasks] = await Promise.all([
    db.client.findMany({ select: { id: true, name: true, version: true, createdAt: true, clientAliases: { select: { key: true } }, _count: { select: { projects: true, clientOpportunities: true, clientTouchpoints: true } } } }),
    db.task.groupBy({ by: ["clientId"], where: { clientId: { not: null }, status: { notIn: ["DONE", "CANCELLED"] } }, _count: { _all: true } }),
  ]);
  const openTasks = new Map(tasks.map((row) => [row.clientId, row._count._all]));
  const side = (c: typeof clients[number]): MergeClientSide => ({ id: c.id, name: c.name, version: c.version, projectCount: c._count.projects, opportunityCount: c._count.clientOpportunities, openTaskCount: openTasks.get(c.id) ?? 0, touchpointCount: c._count.clientTouchpoints });
  // crm50: tax codes are unique in the database, so two clients can never share one; an alias key that equals
  // another client's name or alias key is reported before plain name-key duplicates.
  const byId = new Map(clients.map((c) => [c.id, c]));
  const found = new Map<string, { key: string; a: typeof clients[number]; b: typeof clients[number] }>();
  const add = (key: string, x: typeof clients[number], y: typeof clients[number]) => {
    if (x.id === y.id) return;
    const [a, b] = [x, y].sort((p, q) => p.name.localeCompare(q.name) || p.id.localeCompare(q.id));
    const id = a.id + "|" + b.id;
    if (!found.has(id)) found.set(id, { key, a, b });
  };
  type Member = { client: typeof clients[number]; viaAlias: boolean };
  const groupBy = (keyOf: (c: typeof clients[number]) => { key: string; viaAlias: boolean }[]) => {
    const groups = new Map<string, Member[]>();
    for (const c of clients) for (const { key, viaAlias } of keyOf(c)) groups.set(key, [...(groups.get(key) ?? []), { client: c, viaAlias }]);
    for (const [k, group] of [...groups].sort(([x], [y]) => x.localeCompare(y))) for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
      if (group[i].viaAlias || group[j].viaAlias) add(k, group[i].client, group[j].client);
    }
  };
  groupBy((c) => [{ key: "alias:" + clientDuplicateKey(c.name), viaAlias: false }, ...c.clientAliases.map((a) => ({ key: "alias:" + a.key, viaAlias: true }))]);
  for (const pair of findDuplicateClientPairs(clients)) add(pair.key, byId.get(pair.a.id)!, byId.get(pair.b.id)!);
  return [...found.values()].map(({ key, a, b }) => {
    const delta = a._count.projects + a._count.clientOpportunities - b._count.projects - b._count.clientOpportunities;
    const target = delta > 0 ? a : delta < 0 ? b : a.createdAt <= b.createdAt ? a : b;
    return { key, a: side(a), b: side(b), suggestedTargetId: target.id };
  });
}

export async function clientHasCrmData(db: Db, clientId: string): Promise<boolean> {
  const client = await db.client.findUnique({ where: { id: clientId }, select: {
    picAccountId: true, _count: { select: { clientOpportunities: true, clientExpectedEvents: true, clientTouchpoints: true, clientBuyingUnits: true, taskClient: true, projectFileClient: true, meetingClient: true, clientPotentialScores: true, clientCadences: true, trackerMatchedClient: true } },
  } });
  return !!client && (client.picAccountId !== null || Object.values(client._count).some((count) => count > 0));
}

export type MergeClientsInput = { sourceClientId: string; targetClientId: string; expectedSourceVersion: number; expectedTargetVersion: number };
export type MergeMovedCounts = { projects: number; opportunities: number; expectedEvents: number; buyingUnitsMoved: number; buyingUnitsMerged: number; touchpoints: number; touchpointCollisions: number; tasks: number; files: number; meetings: number; potentialScores: number; cadenceMoved: number; cadenceDropped: number; trackerRows: number; notifications: number; driveFoldersRekeyed: boolean;
  aliasesMoved: number; aliasesDropped: number; sourceNameAlias: boolean; tagsMoved: number; competitorsMoved: number; competitorsMerged: number; childClients: number; fieldChanges: number;
  /** crm53: playbook fields filled from the source because the target was empty, and section "updated by" rows moved. */
  playbookFields?: number; playbookSections?: number };
type MergeResult = { ok: true; movedCounts: MergeMovedCounts; sourceClientName: string; targetClientName: string } | { error: string };
const STALE = "Dữ liệu vừa được người khác cập nhật. Tải lại trang để xem bản mới.";

class MergeHierarchyError extends Error {}
const HIERARCHY_TOO_DEEP = "Gộp khách sẽ làm tập đoàn quá 3 cấp. Đổi công ty mẹ trước khi gộp.";
export async function mergeClients(db: PrismaClient, actor: CrmActor & { name: string }, input: MergeClientsInput): Promise<MergeResult> {
  if (!crmCan(actor, "MERGE_CLIENT")) return { error: "Bạn không có quyền sửa mục này. Liên hệ PIC hoặc AD/AM của team." };
  if (!input || ![input.sourceClientId, input.targetClientId].every((id) => typeof id === "string" && id.trim().length > 0 && id.length <= 128) || ![input.expectedSourceVersion, input.expectedTargetVersion].every((v) => Number.isSafeInteger(v) && v >= 0)) return { error: "Thông tin gộp khách không hợp lệ." };
  if (input.sourceClientId === input.targetClientId) return { error: "Chọn hai khách khác nhau." };
  try { return await db.$transaction(async (tx): Promise<MergeResult> => {
    const ids = [input.sourceClientId, input.targetClientId].sort();
    // Same order as updateClientIdentity: hierarchy lock, then client rows.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('crm:client-hierarchy'))`;
    for (const id of ids) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
    await tx.$queryRaw`SELECT id, version FROM "Client" WHERE id IN (${ids[0]}, ${ids[1]}) ORDER BY id FOR UPDATE`;
    const [source, target] = await Promise.all([tx.client.findUnique({ where: { id: input.sourceClientId } }), tx.client.findUnique({ where: { id: input.targetClientId } })]);
    if (!source || !target) return { error: "Không tìm thấy khách." };
    if (source.version !== input.expectedSourceVersion || target.version !== input.expectedTargetVersion) return { error: STALE };
    if (source.taxCode && target.taxCode && source.taxCode !== target.taxCode) return { error: "Hai khách có mã số thuế khác nhau, không gộp được." };
    const counts: MergeMovedCounts = { projects: 0, opportunities: 0, expectedEvents: 0, buyingUnitsMoved: 0, buyingUnitsMerged: 0, touchpoints: 0, touchpointCollisions: 0, tasks: 0, files: 0, meetings: 0, potentialScores: 0, cadenceMoved: 0, cadenceDropped: 0, trackerRows: 0, notifications: 0, driveFoldersRekeyed: false, aliasesMoved: 0, aliasesDropped: 0, sourceNameAlias: false, tagsMoved: 0, competitorsMoved: 0, competitorsMerged: 0, childClients: 0, fieldChanges: 0, playbookFields: 0, playbookSections: 0 };
    const units = await tx.buyingUnit.findMany({ where: { clientId: { in: ids } } });
    const targetUnits = new Map(units.filter((u) => u.clientId === target.id).map((u) => [u.name, u.id]));
    for (const unit of units.filter((u) => u.clientId === source.id)) {
      const existing = targetUnits.get(unit.name);
      if (existing) {
        await tx.opportunity.updateMany({ where: { buyingUnitId: unit.id }, data: { buyingUnitId: existing } });
        await tx.expectedEvent.updateMany({ where: { buyingUnitId: unit.id }, data: { buyingUnitId: existing } });
        await tx.buyingUnit.delete({ where: { id: unit.id } }); counts.buyingUnitsMerged++;
      } else { await tx.buyingUnit.update({ where: { id: unit.id }, data: { clientId: target.id } }); counts.buyingUnitsMoved++; }
    }
    const points = await tx.touchpoint.findMany({ where: { clientId: { in: ids }, sourceType: { not: null }, sourceId: { not: null } }, select: { id: true, clientId: true, sourceType: true, sourceId: true, status: true } });
    const targetPoints = new Map(points.filter((p) => p.clientId === target.id).map((p) => [JSON.stringify([p.sourceType, p.sourceId]), p]));
    const rank: Record<string, number> = { CONFIRMED: 3, DRAFT: 2, DISMISSED: 1 };
    for (const point of points.filter((p) => p.clientId === source.id)) {
      const existing = targetPoints.get(JSON.stringify([point.sourceType, point.sourceId]));
      if (!existing) continue;
      // Giữ bản đã xác nhận; bằng trạng thái thì giữ bản của khách đích.
      const loser = (rank[point.status] ?? 0) > (rank[existing.status] ?? 0) ? existing : point;
      await tx.touchpoint.delete({ where: { id: loser.id } }); counts.touchpointCollisions++;
    }
    counts.touchpoints = (await tx.touchpoint.updateMany({ where: { clientId: source.id }, data: { clientId: target.id } })).count;
    const periods = await tx.cadenceReminder.findMany({ where: { clientId: target.id }, select: { periodKey: true } });
    // Hai nhắc cùng kỳ dùng bản đích; task nguồn vẫn được chuyển bên dưới.
    counts.cadenceDropped = (await tx.cadenceReminder.deleteMany({ where: { clientId: source.id, periodKey: { in: periods.map((p) => p.periodKey) } } })).count;
    counts.cadenceMoved = (await tx.cadenceReminder.updateMany({ where: { clientId: source.id }, data: { clientId: target.id } })).count;
    const where = { clientId: source.id }; const data = { clientId: target.id };
    counts.projects = (await tx.project.updateMany({ where, data })).count;
    counts.opportunities = (await tx.opportunity.updateMany({ where, data })).count;
    counts.expectedEvents = (await tx.expectedEvent.updateMany({ where, data })).count;
    counts.tasks = (await tx.task.updateMany({ where, data })).count;
    counts.files = (await tx.projectFile.updateMany({ where, data })).count;
    counts.meetings = (await tx.meeting.updateMany({ where, data })).count;
    counts.potentialScores = (await tx.clientPotentialScore.updateMany({ where, data })).count;
    counts.trackerRows = (await tx.trackerImportRow.updateMany({ where: { matchedClientId: source.id }, data: { matchedClientId: target.id } })).count;
    counts.notifications = (await tx.notification.updateMany({ where, data })).count;
    // crm50 profile data: aliases, tags, agencies, child companies and field history follow the target.
    const targetAliasKeys = new Set((await tx.clientAlias.findMany({ where: { clientId: target.id }, select: { key: true } })).map((a) => a.key));
    for (const alias of await tx.clientAlias.findMany({ where: { clientId: source.id } })) {
      if (targetAliasKeys.has(alias.key)) { await tx.clientAlias.delete({ where: { id: alias.id } }); counts.aliasesDropped++; }
      else { await tx.clientAlias.update({ where: { id: alias.id }, data: { clientId: target.id } }); targetAliasKeys.add(alias.key); counts.aliasesMoved++; }
    }
    const sourceKey = clientDuplicateKey(source.name);
    const thirdNames = await tx.client.findMany({ where: { id: { notIn: ids } }, select: { name: true } });
    if (!await tx.clientAlias.findUnique({ where: { key: sourceKey }, select: { id: true } }) && !thirdNames.some((c) => clientDuplicateKey(c.name) === sourceKey)) {
      await tx.clientAlias.create({ data: { clientId: target.id, name: source.name, key: sourceKey } });
      counts.sourceNameAlias = true;
    }
    const targetTags = new Set((await tx.clientTagLink.findMany({ where: { clientId: target.id }, select: { tagId: true } })).map((l) => l.tagId));
    counts.tagsMoved = (await tx.clientTagLink.updateMany({ where: { clientId: source.id, tagId: { notIn: [...targetTags] } }, data: { clientId: target.id } })).count;
    const targetAgencies = new Map((await tx.clientCompetitor.findMany({ where: { clientId: target.id } })).map((c) => [c.competitorId, c]));
    for (const link of await tx.clientCompetitor.findMany({ where: { clientId: source.id } })) {
      const kept = targetAgencies.get(link.competitorId);
      if (kept) {
        if ((kept.note === null && link.note !== null) || (kept.since === null && link.since !== null)) await tx.clientCompetitor.update({ where: { id: kept.id }, data: { note: kept.note ?? link.note, since: kept.since ?? link.since } });
        await tx.clientCompetitor.delete({ where: { id: link.id } }); counts.competitorsMerged++;
      } else { await tx.clientCompetitor.update({ where: { id: link.id }, data: { clientId: target.id } }); counts.competitorsMoved++; }
    }
    // A target inside the source's own group is detached first so moving children cannot create a loop.
    const tree = new Map((await tx.client.findMany({ select: { id: true, parentClientId: true } })).map((c) => [c.id, c.parentClientId]));
    for (let cursor = tree.get(target.id) ?? null, guard = 0; cursor !== null && guard < 100; cursor = tree.get(cursor) ?? null, guard++) {
      if (cursor === source.id) { await tx.client.update({ where: { id: target.id }, data: { parentClientId: null } }); tree.set(target.id, null); break; }
    }
    for (const [id, parent] of tree) if (parent === source.id && id !== target.id) tree.set(id, target.id);
    tree.delete(source.id);
    const level = (id: string) => { let n = 1; for (let cursor = tree.get(id) ?? null; cursor !== null; cursor = tree.get(cursor) ?? null) if (++n > 3) return n; return n; };
    if ([...tree.keys()].some((id) => level(id) > 3)) throw new MergeHierarchyError();
    counts.childClients = (await tx.client.updateMany({ where: { parentClientId: source.id, id: { not: target.id } }, data: { parentClientId: target.id } })).count;
    counts.fieldChanges = (await tx.clientFieldChange.updateMany({ where, data })).count;
    const fields: Prisma.ClientUncheckedUpdateInput = { version: { increment: 1 } };
    if (!target.taxCode && source.taxCode) { await tx.client.update({ where: { id: source.id }, data: { taxCode: null } }); fields.taxCode = source.taxCode; }
    for (const key of ["picAccountId", "responsibleTeamId", "industry", "budgetSeason", "budgetSeasonMonth", "vendorSelection", "valuedMost", "legalName", "shortName", "website", "address", "acquisitionSource", "referredBy", "notes"] as const) {
      if (target[key] === null && source[key] !== null) Object.assign(fields, { [key]: source[key] });
    }
    // crm53 playbook: a target value always wins; an empty target takes the source value and the move is logged.
    const playbookMoves = PLAYBOOK_FIELDS.filter((key) => target[key] === null && source[key] !== null);
    for (const key of playbookMoves) Object.assign(fields, { [key]: source[key] });
    if (playbookMoves.length) await tx.clientFieldChange.createMany({ data: playbookMoves.map((key) => ({ clientId: target.id, field: key, newValue: playbookHistoryValue(key, source[key]) as Prisma.InputJsonValue, actorId: actor.id, actorName: actor.name })) });
    counts.playbookFields = playbookMoves.length;
    const targetSections = new Set((await tx.clientPlaybookUpdate.findMany({ where: { clientId: target.id }, select: { section: true } })).map((row) => row.section));
    counts.playbookSections = (await tx.clientPlaybookUpdate.updateMany({ where: { clientId: source.id, section: { notIn: [...targetSections] } }, data: { clientId: target.id } })).count;
    if (target.potentialLevel === null) Object.assign(fields, { potentialLevel: source.potentialLevel, potentialScoredById: source.potentialScoredById, potentialScoredAt: source.potentialScoredAt });
    if (target.importStatus === null) Object.assign(fields, { importStatus: source.importStatus, importConfirmedAt: source.importConfirmedAt });
    await tx.client.update({ where: { id: target.id }, data: fields });
    if (!await tx.driveFolder.findUnique({ where: { key: `client:${target.id}` } })) {
      for (const suffix of ["", ":tasks"]) {
        const key = `client:${target.id}${suffix}`;
        if (!await tx.driveFolder.findUnique({ where: { key } })) {
          const moved = await tx.driveFolder.updateMany({ where: { key: `client:${source.id}${suffix}` }, data: { key } });
          counts.driveFoldersRekeyed ||= moved.count > 0;
        }
      }
    }
    await tx.client.delete({ where: { id: source.id } });
    await tx.clientMergeLog.create({ data: { sourceClientId: source.id, sourceClientName: source.name, targetClientId: target.id, movedCounts: counts, actorId: actor.id, actorName: actor.name } });
    return { ok: true, movedCounts: counts, sourceClientName: source.name, targetClientName: target.name };
  }, { timeout: 20000 }); } catch (error) {
    if (error instanceof MergeHierarchyError) return { error: HIERARCHY_TOO_DEEP };
    throw error;
  }
}
