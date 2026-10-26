import { createHash, randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { preflightExcelWorkbook, type ExcelWorkbookUpload } from "./excelIntakeSecurity";
import { blankPairedRow, hydrateLinePricingData, normalizePairedRows, validatePairedRowPrimitives } from "./pairedDraft";
import { pricedTotal } from "./pairedPricing";
import type { FinanceData, PairedDraft, PairedRow } from "./types";
import type { ExcelDecimalConflict } from "./excelIntake";
import { compare, decimal, normalizeDecimalInput } from "./money";

export const EXCEL_ROUND_TRIP_SCHEMA_VERSION = 1;
export class ExcelRoundTripDiagnosticError extends Error {
  constructor(message: string, readonly diagnostic: { itemId: string; field: string; sourceCell: string }) { super(message); }
}

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
type RoundTripDecimalField = "sell.quantity" | "sell.days" | "sell.unitPrice" | "sell.vatPercent" | "buy.quantity" | "buy.days" | "buy.unitPrice" | "buy.vatPercent";
export type RoundTripImportRow = Omit<RoundTripRow, "itemId"> & { itemId: string | null; source: RoundTripSource; canonicalBindings?: Partial<Record<RoundTripDecimalField, string>> };
export type RoundTripImport = Omit<RoundTripProjection, "title" | "clientId" | "customer" | "notes" | "rows"> & { rows: RoundTripImportRow[]; decimalConflicts?: ExcelDecimalConflict[] };
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
  decimalConflicts?: ExcelDecimalConflict[];
};

type Actor = { id: string; role: string };

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, nested]) => [key, canonicalValue(nested)]));
  return value;
}
const stableJson = (value: unknown) => JSON.stringify(canonicalValue(value));

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
  return { schemaVersion: EXCEL_ROUND_TRIP_SCHEMA_VERSION, projectId, draft: { ...structuredClone(draft), rows: normalizePairedRows(structuredClone(draft.rows)) } };
}

export function createRoundTripProjection(projectId: string, draft: PairedDraft): RoundTripProjection {
  if (draft.workspaceMode !== "paired") throw new Error("Chỉ nháp Báo giá & IC đang chỉnh sửa mới được xuất Excel round-trip.");
  const input = fingerprintInput(projectId, draft);
  const fingerprint = createHash("sha256").update(stableJson(input)).digest("hex");
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

export async function parseRoundTripWorkbook(bytes: Uint8Array, upload: ExcelWorkbookUpload = { filename: "round-trip.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }): Promise<RoundTripImport> {
  await preflightExcelWorkbook(bytes, upload);
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
  const decimalFields: RoundTripDecimalField[] = ["sell.quantity", "sell.days", "sell.unitPrice", "sell.vatPercent", "buy.quantity", "buy.days", "buy.unitPrice", "buy.vatPercent"];
  const stableById = new Map<string, { itemId: string; parentItemId: string | null; order: number; level: number; rowType: "GROUP" | "ITEM"; canonicalBindings: Partial<Record<RoundTripDecimalField, string>> }>();
  for (let rowNumber = 2; rowNumber <= stable.rowCount; rowNumber++) {
    const row = stable.getRow(rowNumber);
    const itemId = cellText(row.getCell(1));
    if (!itemId) continue;
    const sourceRow = Number(cellText(row.getCell(6)));
    const rowType = cellText(row.getCell(5));
    if (!Number.isSafeInteger(sourceRow) || (rowType !== "GROUP" && rowType !== "ITEM")) throw new Error("Metadata dòng round-trip không hợp lệ.");
    const canonicalBindings = Object.fromEntries(decimalFields.map((field, index) => [field, cellText(row.getCell(7 + index))])) as Partial<Record<RoundTripDecimalField, string>>;
    stableById.set(itemId, { itemId, parentItemId: cellText(row.getCell(2)) || null, order: Number(cellText(row.getCell(3))), level: Number(cellText(row.getCell(4))), rowType, canonicalBindings });
  }
  const rows: RoundTripImportRow[] = [];
  const decimalConflicts: ExcelDecimalConflict[] = [];
  const parentAtLevel = new Map<number, string>();
  for (let sourceRow = 7; sourceRow <= 206; sourceRow++) {
    const row = visible.getRow(sourceRow);
    const content = [3, 4, 5, 6, 7, 8, 14, 15, 16, 17, 18, 24, 25].map(column => cellText(row.getCell(column)));
    if (!content.some(Boolean)) continue;
    const itemId = cellText(row.getCell(26));
    const stableEntry = itemId ? stableById.get(itemId) : undefined;
    if (itemId && !stableEntry) throw new Error("Stable ID trong dòng không thuộc metadata round-trip.");
    if (stableEntry && (cellText(row.getCell(27)) !== (stableEntry.parentItemId ?? "") || Number(cellText(row.getCell(28))) !== stableEntry.order)) throw new Error("Metadata stable ID/parent/order đã bị sửa không hợp lệ.");
    const level = Number(cellText(row.getCell(1)) || 1);
    const previewId = stableEntry?.itemId ?? `preview-new-${sourceRow}`;
    const parentItemId = level === 1 ? null : parentAtLevel.get(level - 1) ?? null;
    const input = blankPairedRow(previewId, parentItemId, stableEntry?.rowType ?? (level === 1 ? "GROUP" : "ITEM"));
    input.name = cellText(row.getCell(3)); input.description = cellText(row.getCell(4));
    input.sell = { ...input.sell, unit: cellText(row.getCell(5)), quantity: cellText(row.getCell(6)), days: cellText(row.getCell(7)), unitPrice: cellText(row.getCell(8)), basis: (cellText(row.getCell(9)) || "NET") as "NET" | "GROSS", vatPercent: cellText(row.getCell(10)), notes: cellText(row.getCell(14)) };
    input.buy = { ...input.buy, unit: cellText(row.getCell(15)), quantity: cellText(row.getCell(16)), days: cellText(row.getCell(17)), unitPrice: cellText(row.getCell(18)), basis: (cellText(row.getCell(19)) || "NET") as "NET" | "GROSS", vatPercent: cellText(row.getCell(20)), vendorId: cellText(row.getCell(24)), notes: cellText(row.getCell(25)) };
    if (stableEntry) for (const field of decimalFields) {
      const [side, key] = field.split(".") as ["sell" | "buy", "quantity" | "days" | "unitPrice" | "vatPercent"];
      const rawVisible = input[side][key];
      const rawCanonical = stableEntry.canonicalBindings[field] ?? "";
      const visibleValue = rawVisible ? normalizeDecimalInput(rawVisible) : "";
      const canonicalValue = rawCanonical ? normalizeDecimalInput(rawCanonical) : "";
      input[side][key] = visibleValue;
      if (visibleValue !== canonicalValue && (!visibleValue || !canonicalValue || compare(decimal(visibleValue), decimal(canonicalValue)) !== 0)) {
        const columnByField: Record<RoundTripDecimalField, number> = { "sell.quantity": 6, "sell.days": 7, "sell.unitPrice": 8, "sell.vatPercent": 10, "buy.quantity": 16, "buy.days": 17, "buy.unitPrice": 18, "buy.vatPercent": 20 };
        const column = columnByField[field];
        decimalConflicts.push({ conflictId: `${stableEntry.itemId}:${field}:${visible.getCell(sourceRow, column).address}`, candidateKey: stableEntry.itemId, side, field, visible: visibleValue, canonical: canonicalValue, source: { sheet: visible.name, row: sourceRow, column, cell: visible.getCell(sourceRow, column).address }, canonicalSource: { sheet: stable.name, row: [...stableById.keys()].indexOf(stableEntry.itemId) + 2, column: 7 + decimalFields.indexOf(field), cell: stable.getCell([...stableById.keys()].indexOf(stableEntry.itemId) + 2, 7 + decimalFields.indexOf(field)).address }, reason: "VISIBLE_CANONICAL_MISMATCH" });
      }
    }
    rows.push({ itemId: stableEntry?.itemId ?? null, parentItemId, order: rows.length, level, row: input, source: { sheet: visible.name, row: sourceRow, cell: `C${sourceRow}` }, canonicalBindings: stableEntry?.canonicalBindings });
    parentAtLevel.set(level, previewId);
    for (const nestedLevel of [level + 1, level + 2, level + 3]) parentAtLevel.delete(nestedLevel);
  }
  return { schemaVersion, projectId: metadata.get("projectId") ?? "", draftId: metadata.get("draftId") ?? "", draftVersion, fingerprint: metadata.get("draftFingerprint") ?? "", rows, decimalConflicts };
}

const editableFields = [
  "name", "description",
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
  if (imported.draftVersion !== draft.version || imported.fingerprint !== current.fingerprint) throw new Error(`Nháp máy chủ đã thay đổi hoặc workbook dùng phiên bản cũ (${imported.draftVersion}/${draft.version}, ${imported.fingerprint}/${current.fingerprint}).`);
  const stableIds = imported.rows.flatMap(row => row.itemId ? [row.itemId] : []);
  if (new Set(stableIds).size !== stableIds.length) throw new Error("Workbook có stable ID bị trùng.");
  const currentById = new Map(draft.rows.map(row => [row.itemId, row]));
  for (const itemId of stableIds) if (!currentById.has(itemId)) throw new Error("Stable ID không thuộc nháp hiện tại hoặc không hợp lệ.");
  for (const entry of imported.rows) if (entry.itemId && entry.canonicalBindings) {
    const currentRow = currentById.get(entry.itemId)!;
    for (const [field, hiddenValue] of Object.entries(entry.canonicalBindings) as Array<[RoundTripDecimalField, string]>) {
      const [side, key] = field.split(".") as ["sell" | "buy", "quantity" | "days" | "unitPrice" | "vatPercent"];
      if ((hiddenValue ?? "") !== (currentRow[side][key] ?? "")) throw new ExcelRoundTripDiagnosticError(`Metadata canonical bảo vệ của dòng ${entry.itemId} đã bị sửa.`, { itemId: entry.itemId, field, sourceCell: entry.source.cell });
    }
  }
  const retained = new Set(stableIds);
  const deletionCandidates = draft.rows.filter(row => !retained.has(row.itemId)).map(row => ({ itemId: row.itemId, name: row.name || row.description || row.itemId }));
  const previewIds = new Map(imported.rows.map(row => [row, row.itemId ?? `preview-new-${row.source.row}`]));
  const mergedRows = imported.rows.map(entry => {
    const stable = entry.itemId ? currentById.get(entry.itemId)! : undefined;
    const row = stable ? structuredClone(stable) : blankPairedRow(previewIds.get(entry)!, entry.parentItemId, entry.row.rowType);
    row.itemId = previewIds.get(entry)!; row.parentItemId = entry.parentItemId;
    row.name = entry.row.name; row.description = entry.row.description;
    for (const side of ["sell", "buy"] as const) for (const field of ["unit", "quantity", "days", "unitPrice", "basis", "vatPercent", "notes"] as const) row[side][field] = entry.row[side][field] as never;
    row.buy.vendorId = entry.row.buy.vendorId;
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
  const previewFingerprint = createHash("sha256").update(stableJson({ current: current.fingerprint, imported })).digest("hex");
  return { previewFingerprint, expectedDraftVersion: draft.version, adds, changes, deletionCandidates, moves, mergedRows, oldTotals: { sell: pricedTotal(draft.rows, "sell"), buy: pricedTotal(draft.rows, "buy") }, newTotals: { sell: pricedTotal(mergedRows, "sell"), buy: pricedTotal(mergedRows, "buy") }, decimalConflicts: imported.decimalConflicts ?? [] };
}

function rebaseRoundTripImport(imported: RoundTripImport, draft: PairedDraft, projectId: string) {
  const currentById = new Map(draft.rows.map(row => [row.itemId, row]));
  const fields: RoundTripDecimalField[] = ["sell.quantity", "sell.days", "sell.unitPrice", "sell.vatPercent", "buy.quantity", "buy.days", "buy.unitPrice", "buy.vatPercent"];
  const columns: Record<RoundTripDecimalField, number> = { "sell.quantity": 6, "sell.days": 7, "sell.unitPrice": 8, "sell.vatPercent": 10, "buy.quantity": 16, "buy.days": 17, "buy.unitPrice": 18, "buy.vatPercent": 20 };
  imported.draftVersion = draft.version;
  imported.fingerprint = createRoundTripProjection(projectId, draft).fingerprint;
  imported.decimalConflicts = [];
  for (const entry of imported.rows) {
    if (!entry.itemId) continue;
    const current = currentById.get(entry.itemId);
    if (!current) throw new Error("Stable ID không thuộc nháp mới nhất.");
    entry.canonicalBindings = {};
    for (const field of fields) {
      const [side, key] = field.split(".") as ["sell" | "buy", "quantity" | "days" | "unitPrice" | "vatPercent"];
      const canonical = current[side][key];
      const visible = entry.row[side][key];
      entry.canonicalBindings[field] = canonical;
      if (visible === canonical) continue;
      const column = columns[field]; const cell = `${String.fromCharCode(64 + column)}${entry.source.row}`;
      imported.decimalConflicts.push({ conflictId: `${entry.itemId}:${field}:${cell}`, candidateKey: entry.itemId, side, field, visible, canonical, source: { sheet: entry.source.sheet, row: entry.source.row, column, cell }, canonicalSource: { sheet: "_IMPORT", row: entry.source.row - 5, column: 7 + fields.indexOf(field), cell: `${String.fromCharCode(71 + fields.indexOf(field))}${entry.source.row - 5}` }, reason: "VISIBLE_CANONICAL_MISMATCH" });
    }
  }
}

export async function previewRoundTripMerge(actor: Actor, projectId: string, bytes: Uint8Array, options: { rebaseToCurrent?: boolean; upload?: ExcelWorkbookUpload } = {}) {
  const imported = await parseRoundTripWorkbook(bytes, options.upload);
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
  if (options.rebaseToCurrent) rebaseRoundTripImport(imported, draft, projectId);
  return { workspaceVersion: workspace.version, draft: { id: draft.id, version: draft.version }, imported, diff: diffRoundTripDraft(draft, imported, projectId) };
}

export function applyRoundTripDiff(draft: PairedDraft, diff: RoundTripDiff, selectedDeletionIds: string[]) {
  const candidates = new Set(diff.deletionCandidates.map(row => row.itemId));
  const selected = new Set(selectedDeletionIds);
  if (selected.size !== selectedDeletionIds.length || [...selected].some(id => !candidates.has(id))) throw new Error("Danh sách xác nhận xóa không hợp lệ.");
  const childrenByParent = new Map<string, string[]>();
  for (const row of draft.rows) if (row.parentItemId) childrenByParent.set(row.parentItemId, [...(childrenByParent.get(row.parentItemId) ?? []), row.itemId]);
  for (const selectedId of selected) {
    const pending = [...(childrenByParent.get(selectedId) ?? [])];
    while (pending.length) {
      const descendant = pending.pop()!;
      if (!selected.has(descendant)) throw new Error("Không thể xóa dòng cha khi còn dòng con hoặc hậu duệ được giữ lại.");
      pending.push(...(childrenByParent.get(descendant) ?? []));
    }
  }
  const retainedMissing = draft.rows.filter(row => candidates.has(row.itemId) && !selected.has(row.itemId)).map(row => structuredClone(row));
  const provisional = diff.mergedRows.map(row => structuredClone(row));
  const explicitlyMoved = new Set(diff.moves.map(move => move.itemId));
  for (const missing of retainedMissing) {
    const originalIndex = draft.rows.findIndex(row => row.itemId === missing.itemId);
    const nextAnchor = draft.rows.slice(originalIndex + 1).find(row => row.parentItemId === missing.parentItemId && !candidates.has(row.itemId) && !explicitlyMoved.has(row.itemId));
    const previousAnchor = [...draft.rows.slice(0, originalIndex)].reverse().find(row => row.parentItemId === missing.parentItemId && !candidates.has(row.itemId) && !explicitlyMoved.has(row.itemId));
    const nextIndex = nextAnchor ? provisional.findIndex(row => row.itemId === nextAnchor.itemId) : -1;
    const previousIndex = previousAnchor ? provisional.findIndex(row => row.itemId === previousAnchor.itemId) : -1;
    if (nextIndex >= 0) provisional.splice(nextIndex, 0, missing);
    else if (previousIndex >= 0) provisional.splice(previousIndex + 1, 0, missing);
    else provisional.push(missing);
  }
  const newIds = new Map(provisional.filter(row => row.itemId.startsWith("preview-new-")).map(row => [row.itemId, randomUUID()]));
  const applied = provisional.map(row => ({ ...row, itemId: newIds.get(row.itemId) ?? row.itemId, parentItemId: row.parentItemId ? newIds.get(row.parentItemId) ?? row.parentItemId : null }));
  for (const row of applied) {
    const original = draft.rows.find(candidate => candidate.itemId === row.itemId);
    if (!original) continue;
    for (const side of ["sell", "buy"] as const) {
      const binding = row[side].parameterBinding;
      if (!binding?.lastCalculated) continue;
      if (["quantity", "days", "unitPrice"].some(field => {
        const key = field as "quantity" | "days" | "unitPrice";
        return binding.lastCalculated?.[key] !== undefined && row[side][key] !== original[side][key];
      })) row[side].parameterBinding = { ...binding, mode: "OVERRIDDEN" };
    }
  }
  validatePairedRowPrimitives(normalizePairedRows(applied));
  return applied;
}

export function resolveRoundTripDecimalConflicts(diff: RoundTripDiff, resolutions: Record<string, "VISIBLE" | "CANONICAL">) {
  const conflicts = diff.decimalConflicts ?? [];
  if (Object.keys(resolutions).length !== conflicts.length || conflicts.some(conflict => !resolutions[conflict.conflictId])) throw new Error("Cần chọn đầy đủ cách xử lý cho từng ô số thập phân xung đột.");
  const resolved = structuredClone(diff);
  for (const conflict of conflicts) {
    const row = resolved.mergedRows.find(candidate => candidate.itemId === conflict.candidateKey);
    if (!row) throw new Error("Xung đột số thập phân không còn khớp dòng round-trip.");
    const field = conflict.field.split(".")[1] as "quantity" | "days" | "unitPrice" | "vatPercent";
    row[conflict.side][field] = resolutions[conflict.conflictId] === "VISIBLE" ? conflict.visible : conflict.canonical;
  }
  resolved.newTotals = { sell: pricedTotal(resolved.mergedRows, "sell"), buy: pricedTotal(resolved.mergedRows, "buy") };
  return resolved;
}
