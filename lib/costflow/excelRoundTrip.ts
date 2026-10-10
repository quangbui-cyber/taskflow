import { createHash, randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { preflightExcelWorkbook } from "./excelIntakeSecurity";
import { blankPairedRow, hydrateLinePricingData, normalizePairedRows } from "./pairedDraft";
import { pricedTotal } from "./pairedPricing";
import type { FinanceData, PairedDraft, PairedRow } from "./types";

export const EXCEL_ROUND_TRIP_SCHEMA_VERSION = 1;

export type RoundTripRow = {
  itemId: string;
  parentItemId: string | null;
  order: number;
  level: number;
  row: PairedRow;
};

export type RoundTripProjection = {
  schemaVersion: number;
  projectId: string;
  draftId: string;
  draftVersion: number;
  fingerprint: string;
  title: string;
  clientId: string;
  customer: string;
  notes: string;
  rows: RoundTripRow[];
};

export type RoundTripSource = { sheet: string; row: number; cell: string };
export type RoundTripImportRow = Omit<RoundTripRow, "itemId"> & { itemId: string | null; source: RoundTripSource };
export type RoundTripImport = Omit<RoundTripProjection, "title" | "clientId" | "customer" | "notes" | "rows"> & { rows: RoundTripImportRow[] };
export type RoundTripFieldChange = { itemId: string; field: string; oldValue: string | boolean; newValue: string | boolean; source: RoundTripSource };
export type RoundTripDiff = {
  previewFingerprint: string;
  expectedDraftVersion: number;
  adds: Array<{ previewKey: string; row: PairedRow; source: RoundTripSource }>;
  changes: RoundTripFieldChange[];
  deletionCandidates: Array<{ itemId: string; name: string }>;
  moves: Array<{ itemId: string; oldParentItemId: string | null; newParentItemId: string | null; oldOrder: number; newOrder: number; source: RoundTripSource }>;
  mergedRows: PairedRow[];
  oldTotals: { sell: ReturnType<typeof pricedTotal>; buy: ReturnType<typeof pricedTotal> };
  newTotals: { sell: ReturnType<typeof pricedTotal>; buy: ReturnType<typeof pricedTotal> };
};

type Actor = { id: string; role: string };

function rowLevel(rows: PairedRow[], row: PairedRow) {
  const byId = new Map(rows.map(value => [value.itemId, value]));
  let level = 1;
  let parent = row.parentItemId;
  const visited = new Set([row.itemId]);
  while (parent) {
    if (visited.has(parent)) throw new Error("Cấu trúc dòng có vòng tham chiếu.");
    visited.add(parent);
    const parentRow = byId.get(parent);
    if (!parentRow) throw new Error("Dòng cha không còn trong nháp.");
    level += 1;
    parent = parentRow.parentItemId;
  }
  return level;
}

function fingerprintInput(projectId: string, draft: PairedDraft) {
  return {
    schemaVersion: EXCEL_ROUND_TRIP_SCHEMA_VERSION,
    projectId,
    draftId: draft.id,
    draftVersion: draft.version,
    metadata: { title: draft.title, clientId: draft.clientId, customer: draft.customer, notes: draft.notes },
    rows: draft.rows.map((row, order) => ({
      itemId: row.itemId,
      parentItemId: row.parentItemId,
      order,
      rowType: row.rowType,
      name: row.name,
      description: row.description,
      pricingMode: row.pricingMode,
      showChildren: row.showChildren,
      showGroupSubtotal: row.showGroupSubtotal,
      packageChildDisplay: row.packageChildDisplay,
      saleRemoved: row.saleRemoved === true,
      sell: { unit: row.sell.unit, quantity: row.sell.quantity, days: row.sell.days, unitPrice: row.sell.unitPrice, basis: row.sell.basis, vatPercent: row.sell.vatPercent, notes: row.sell.notes },
      buy: { unit: row.buy.unit, quantity: row.buy.quantity, days: row.buy.days, unitPrice: row.buy.unitPrice, basis: row.buy.basis, vatPercent: row.buy.vatPercent, notes: row.buy.notes, vendorId: row.buy.vendorId },
    })),
  };
}

export function createRoundTripProjection(projectId: string, draft: PairedDraft): RoundTripProjection {
  if (draft.workspaceMode !== "paired") throw new Error("Chỉ nháp Báo giá & IC đang chỉnh sửa mới được xuất Excel round-trip.");
  const input = fingerprintInput(projectId, draft);
  const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  return {
    schemaVersion: EXCEL_ROUND_TRIP_SCHEMA_VERSION,
    projectId,
    draftId: draft.id,
    draftVersion: draft.version,
    fingerprint,
    title: draft.title,
    clientId: draft.clientId,
    customer: draft.customer,
    notes: draft.notes,
    rows: draft.rows.map((row, order) => ({ itemId: row.itemId, parentItemId: row.parentItemId, order, level: rowLevel(draft.rows, row), row: structuredClone(row) })),
  };
}

function cellText(cell: ExcelJS.Cell) {
  if (cell.type === ExcelJS.ValueType.Formula) throw new Error(`Ô ${cell.address} chứa công thức ở trường dữ liệu; máy chủ chỉ nhận giá trị nguyên thủy.`);
  if (cell.value === null || cell.value === undefined) return "";
  return String(cell.value).trim();
}

function metaMap(sheet: ExcelJS.Worksheet) {
  const out = new Map<string, string>();
  sheet.eachRow(row => {
    const key = cellText(row.getCell(1));
    if (key) out.set(key, cellText(row.getCell(2)));
  });
  return out;
}

export async function parseRoundTripWorkbook(bytes: Uint8Array): Promise<RoundTripImport> {
  await preflightExcelWorkbook(bytes);
  const workbook = new ExcelJS.Workbook();
  const buffer = Buffer.from(bytes);
  await workbook.xlsx.load(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer);
  const visible = workbook.getWorksheet("BAO_GIA_IC");
  const stable = workbook.getWorksheet("_IMPORT");
  const metadataSheet = workbook.getWorksheet("_META");
  if (!visible || !stable || !metadataSheet || stable.state !== "veryHidden" || metadataSheet.state !== "veryHidden") throw new Error("Workbook thiếu metadata round-trip riêng tư.");
  const metadata = metaMap(metadataSheet);
  const schemaVersion = Number(metadata.get("roundTripSchemaVersion"));
  const draftVersion = Number(metadata.get("draftVersion"));
  if (schemaVersion !== EXCEL_ROUND_TRIP_SCHEMA_VERSION || !Number.isSafeInteger(draftVersion)) throw new Error("Metadata round-trip không hợp lệ.");
  const stableBySource = new Map<number, { itemId: string; parentItemId: string | null; order: number; level: number; rowType: "GROUP" | "ITEM" }>();
  for (let rowNumber = 2; rowNumber <= stable.rowCount; rowNumber++) {
    const row = stable.getRow(rowNumber);
    const itemId = cellText(row.getCell(1));
    if (!itemId) continue;
    const sourceRow = Number(cellText(row.getCell(6)));
    const rowType = cellText(row.getCell(5));
    if (!Number.isSafeInteger(sourceRow) || (rowType !== "GROUP" && rowType !== "ITEM")) throw new Error("Metadata dòng round-trip không hợp lệ.");
    stableBySource.set(sourceRow, { itemId, parentItemId: cellText(row.getCell(2)) || null, order: Number(cellText(row.getCell(3))), level: Number(cellText(row.getCell(4))), rowType });
  }
  const rows: RoundTripImportRow[] = [];
  for (let sourceRow = 7; sourceRow <= 206; sourceRow++) {
    const row = visible.getRow(sourceRow);
    const content = [3, 4, 5, 6, 7, 8, 14, 15, 16, 17, 18, 24, 25].map(column => cellText(row.getCell(column)));
    if (!content.some(Boolean)) continue;
    const stableEntry = stableBySource.get(sourceRow);
    const input = blankPairedRow(stableEntry?.itemId ?? `preview-new-${sourceRow}`, stableEntry?.parentItemId ?? null, stableEntry?.rowType ?? (cellText(row.getCell(1)) === "1" ? "GROUP" : "ITEM"));
    input.name = cellText(row.getCell(3)); input.description = cellText(row.getCell(4));
    input.sell = { ...input.sell, unit: cellText(row.getCell(5)), quantity: cellText(row.getCell(6)), days: cellText(row.getCell(7)), unitPrice: cellText(row.getCell(8)), basis: (cellText(row.getCell(9)) || "NET") as "NET" | "GROSS", vatPercent: cellText(row.getCell(10)), notes: cellText(row.getCell(14)) };
    input.buy = { ...input.buy, unit: cellText(row.getCell(15)), quantity: cellText(row.getCell(16)), days: cellText(row.getCell(17)), unitPrice: cellText(row.getCell(18)), basis: (cellText(row.getCell(19)) || "NET") as "NET" | "GROSS", vatPercent: cellText(row.getCell(20)), vendorId: cellText(row.getCell(24)), notes: cellText(row.getCell(25)) };
    rows.push({ itemId: stableEntry?.itemId ?? null, parentItemId: stableEntry?.parentItemId ?? null, order: stableEntry?.order ?? rows.length, level: stableEntry?.level ?? Number(cellText(row.getCell(1)) || 1), row: input, source: { sheet: visible.name, row: sourceRow, cell: `C${sourceRow}` } });
  }
  return { schemaVersion, projectId: metadata.get("projectId") ?? "", draftId: metadata.get("draftId") ?? "", draftVersion, fingerprint: metadata.get("draftFingerprint") ?? "", rows };
}

const editableFields = [
  "rowType", "name", "description", "pricingMode", "showChildren", "showGroupSubtotal", "packageChildDisplay", "saleRemoved",
  "sell.unit", "sell.quantity", "sell.days", "sell.unitPrice", "sell.basis", "sell.vatPercent", "sell.notes",
  "buy.unit", "buy.quantity", "buy.days", "buy.unitPrice", "buy.basis", "buy.vatPercent", "buy.notes", "buy.vendorId",
] as const;

function fieldValue(row: PairedRow, field: typeof editableFields[number]): string | boolean {
  const [scope, key] = field.split(".");
  if (key && (scope === "sell" || scope === "buy")) return String(row[scope][key as keyof typeof row[typeof scope]] ?? "");
  const value = row[field as keyof PairedRow];
  return typeof value === "boolean" ? value : String(value ?? "");
}

export function diffRoundTripDraft(draft: PairedDraft, imported: RoundTripImport, projectId: string): RoundTripDiff {
  const current = createRoundTripProjection(projectId, draft);
  if (imported.projectId !== projectId || imported.draftId !== draft.id) throw new Error("Workbook không thuộc Project hoặc nháp hiện tại.");
  if (imported.draftVersion !== draft.version || imported.fingerprint !== current.fingerprint) throw new Error("Nháp máy chủ đã thay đổi hoặc workbook dùng phiên bản cũ.");
  const stableIds = imported.rows.flatMap(row => row.itemId ? [row.itemId] : []);
  if (new Set(stableIds).size !== stableIds.length) throw new Error("Workbook có stable ID bị trùng.");
  const currentById = new Map(draft.rows.map(row => [row.itemId, row]));
  for (const itemId of stableIds) if (!currentById.has(itemId)) throw new Error("Stable ID không thuộc nháp hiện tại hoặc không hợp lệ.");
  const retained = new Set(stableIds);
  const deletionCandidates = draft.rows.filter(row => !retained.has(row.itemId)).map(row => ({ itemId: row.itemId, name: row.name || row.description || row.itemId }));
  const previewIds = new Map(imported.rows.map(row => [row, row.itemId ?? `preview-new-${row.source.row}`]));
  const mergedRows = imported.rows.map(entry => {
    const stable = entry.itemId ? currentById.get(entry.itemId)! : undefined;
    const row = { ...(stable ? structuredClone(stable) : blankPairedRow(previewIds.get(entry)!, entry.parentItemId, entry.row.rowType)), ...structuredClone(entry.row), itemId: previewIds.get(entry)!, parentItemId: entry.parentItemId };
    if (stable) {
      row.buy.evidenceIds = [...stable.buy.evidenceIds]; row.buy.evidenceReason = stable.buy.evidenceReason;
      row.quotationLineId = stable.quotationLineId; row.icLineId = stable.icLineId;
    }
    return row;
  });
  normalizePairedRows(mergedRows);
  const mergedIds = new Set(mergedRows.map(row => row.itemId));
  for (const row of mergedRows) if (row.parentItemId && !mergedIds.has(row.parentItemId)) throw new Error("Cấu trúc không hợp lệ: dòng cha bị xóa nhưng dòng con chưa được di chuyển hoặc xóa.");
  const changes: RoundTripFieldChange[] = [];
  const moves: RoundTripDiff["moves"] = [];
  const adds: RoundTripDiff["adds"] = [];
  imported.rows.forEach((entry, newOrder) => {
    if (!entry.itemId) { adds.push({ previewKey: previewIds.get(entry)!, row: mergedRows[newOrder], source: entry.source }); return; }
    const oldRow = currentById.get(entry.itemId)!;
    const newRow = mergedRows[newOrder];
    for (const field of editableFields) {
      const oldValue = fieldValue(oldRow, field), newValue = fieldValue(newRow, field);
      if (oldValue !== newValue) changes.push({ itemId: entry.itemId, field, oldValue, newValue, source: entry.source });
    }
    const oldOrder = draft.rows.findIndex(row => row.itemId === entry.itemId);
    if (oldRow.parentItemId !== entry.parentItemId || oldOrder !== entry.order) moves.push({ itemId: entry.itemId, oldParentItemId: oldRow.parentItemId, newParentItemId: entry.parentItemId, oldOrder, newOrder: entry.order, source: entry.source });
  });
  const previewFingerprint = createHash("sha256").update(JSON.stringify({ current: current.fingerprint, imported })).digest("hex");
  return { previewFingerprint, expectedDraftVersion: draft.version, adds, changes, deletionCandidates, moves, mergedRows, oldTotals: { sell: pricedTotal(draft.rows, "sell"), buy: pricedTotal(draft.rows, "buy") }, newTotals: { sell: pricedTotal(mergedRows, "sell"), buy: pricedTotal(mergedRows, "buy") } };
}

export async function previewRoundTripMerge(actor: Actor, projectId: string, bytes: Uint8Array) {
  const imported = await parseRoundTripWorkbook(bytes);
  const [project, currentActor, workspace] = await Promise.all([
    prisma.project.findUnique({ where: { id: projectId }, select: { members: { where: { userId: actor.id }, select: { userId: true } } } }),
    prisma.user.findFirst({ where: { id: actor.id, isActive: true }, select: { role: true } }),
    prisma.costFlowWorkspace.findUnique({ where: { projectId }, select: { version: true, data: true } }),
  ]);
  if (!project || !currentActor || !workspace || !["ADMIN", "ACCOUNT"].includes(currentActor.role) || (currentActor.role !== "ADMIN" && !project.members.length)) throw new Error("Không tìm thấy nháp hoặc bạn không có quyền.");
  const data = hydrateLinePricingData(workspace.data as unknown as FinanceData);
  const draft = data.quotationDrafts?.find(value => value.id === imported.draftId);
  if (!draft || draft.createdBy !== actor.id || draft.workspaceMode !== "paired" || data.closed) throw new Error("Không tìm thấy nháp hoặc bạn không có quyền.");
  if (draft.icRevisionId) {
    const revision = data.revisions.find(value => value.id === draft.icRevisionId);
    const request = revision ? await prisma.workflowRequest.findUnique({ where: { id: revision.requestId }, select: { state: true, creatorId: true } }) : null;
    if (!revision || revision.effective || request?.state !== "DRAFT" || request.creatorId !== actor.id) throw new Error("Nháp không còn ở trạng thái được phép chỉnh sửa.");
  }
  return { workspaceVersion: workspace.version, draft: { id: draft.id, version: draft.version }, imported, diff: diffRoundTripDraft(draft, imported, projectId) };
}

export function applyRoundTripDiff(draft: PairedDraft, diff: RoundTripDiff, selectedDeletionIds: string[]) {
  const candidates = new Set(diff.deletionCandidates.map(row => row.itemId));
  const selected = new Set(selectedDeletionIds);
  if (selected.size !== selectedDeletionIds.length || [...selected].some(id => !candidates.has(id))) throw new Error("Danh sách xác nhận xóa không hợp lệ.");
  const retainedMissing = draft.rows.filter(row => candidates.has(row.itemId) && !selected.has(row.itemId)).map(row => structuredClone(row));
  const provisional = [...diff.mergedRows.map(row => structuredClone(row)), ...retainedMissing];
  const newIds = new Map(provisional.filter(row => row.itemId.startsWith("preview-new-")).map(row => [row.itemId, randomUUID()]));
  const applied = provisional.map(row => ({ ...row, itemId: newIds.get(row.itemId) ?? row.itemId, parentItemId: row.parentItemId ? newIds.get(row.parentItemId) ?? row.parentItemId : null }));
  return normalizePairedRows(applied);
}
