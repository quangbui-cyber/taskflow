import { createHash } from "node:crypto";
import type { PairedDraft, PairedRow } from "./types";

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

// Implemented by Task 11.2; exported here so all round-trip authority stays in one module.
export function diffRoundTripDraft(): never {
  throw new Error("Round-trip diff is not available yet.");
}

// Implemented by Task 11.3 after deletion selection and CAS have been revalidated.
export function applyRoundTripDiff(): never {
  throw new Error("Round-trip apply is not available yet.");
}
