import type { WorkbookInventory } from "./workbookInventory";
import type { GenerationModel } from "@/lib/ai/providers/types";
import { buildMaskedStructurePayload, EXCEL_MASK_POLICY_VERSION } from "./masking";

export const MAPPABLE_FIELDS = ["name", "description", "sell.unit", "sell.quantity", "sell.days", "sell.unitPrice", "sell.vatPercent", "sell.basis", "sell.note", "buy.unit", "buy.quantity", "buy.days", "buy.unitPrice", "buy.vatPercent", "buy.basis", "buy.supplier", "buy.note"] as const;
export type MappableField = typeof MAPPABLE_FIELDS[number];
export type ExcelMappingProposal = {
  sheet: string; range: string; headerRow: number; kind: "QUOTATION" | "IC" | "PAIRED";
  columns: Partial<Record<MappableField, number>>;
  rows: { row: number; rowType: "GROUP" | "ITEM"; level: 1 | 2 | 3; parentRow: number | null }[];
  confidence: number;
  additional?: Omit<ExcelMappingProposal, "additional">;
};
export type ReviewedExcelMapping = ExcelMappingProposal & { reviewed: true; confirmedCriticalCells: string[]; runId?: string; adapterId?: string };

export function confidenceTier(confidence: number): "PRESELECTED" | "CONFIRM" | "UNMAPPED" {
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error("Độ tin cậy mapping không hợp lệ.");
  return confidence >= 0.9 ? "PRESELECTED" : confidence >= 0.6 ? "CONFIRM" : "UNMAPPED";
}

export function validateExcelMapping(inventory: WorkbookInventory, proposal: ExcelMappingProposal) {
  const allowedKeys = new Set(["sheet", "range", "headerRow", "kind", "columns", "rows", "confidence", "additional", "reviewed", "confirmedCriticalCells", "runId", "adapterId"]);
  if (!proposal || typeof proposal !== "object" || Array.isArray(proposal) || Object.keys(proposal).some(key => !allowedKeys.has(key))) throw new Error("Cấu trúc mapping không hợp lệ.");
  const sheet = inventory.sheets.find(item => item.name === proposal.sheet);
  if (!sheet) throw new Error("Mapping tham chiếu sheet ngoài phạm vi đã kiểm tra.");
  const match = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i.exec(proposal.range);
  if (!match || !Number.isSafeInteger(proposal.headerRow)) throw new Error("Vùng mapping không hợp lệ.");
  const columnIndex = (name: string) => [...name.toUpperCase()].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0);
  const firstColumn = columnIndex(match[1]); const lastColumn = columnIndex(match[3]);
  const firstRow = Number(match[2]); const lastRow = Number(match[4]);
  if (firstRow < sheet.firstRow || lastRow > sheet.lastRow || firstColumn < sheet.firstColumn || lastColumn > sheet.lastColumn ||
      firstRow > lastRow || firstColumn > lastColumn || proposal.headerRow < firstRow || proposal.headerRow >= lastRow ||
      lastRow - proposal.headerRow > 500 || lastColumn - firstColumn + 1 > 40) throw new Error("Vùng mapping vượt phạm vi nguồn.");
  if (!["QUOTATION", "IC", "PAIRED"].includes(proposal.kind)) throw new Error("Loại bảng mapping không hợp lệ.");
  const keys = Object.keys(proposal.columns);
  if (!keys.includes("name") || keys.some(key => !MAPPABLE_FIELDS.includes(key as MappableField))) throw new Error("Mapping thiếu tên hoặc có field lạ.");
  const columns = Object.values(proposal.columns);
  if (columns.some(column => !Number.isSafeInteger(column) || column! < firstColumn || column! > lastColumn || sheet.hiddenColumns.includes(column!)) || new Set(columns).size !== columns.length) throw new Error("Cột mapping ngoài phạm vi hoặc bị ẩn.");
  if (!Array.isArray(proposal.rows) || proposal.rows.length === 0 || proposal.rows.length > 500 || proposal.rows.some(item =>
      !item || typeof item !== "object" || Array.isArray(item) || Object.keys(item).some(key => !["row", "rowType", "level", "parentRow"].includes(key)) ||
      !Number.isSafeInteger(item.row) || item.row <= proposal.headerRow || item.row > lastRow || sheet.hiddenRows.includes(item.row) ||
      !["GROUP", "ITEM"].includes(item.rowType) || ![1, 2, 3].includes(item.level) ||
      (item.parentRow !== null && (!Number.isSafeInteger(item.parentRow) || item.parentRow >= item.row || item.parentRow <= proposal.headerRow)))) throw new Error("Dòng hoặc hierarchy mapping không hợp lệ.");
  if (new Set(proposal.rows.map(item => item.row)).size !== proposal.rows.length) throw new Error("Dòng mapping bị lặp.");
  const selectedRows = new Set(proposal.rows.map(item => item.row));
  if (proposal.rows.some(item => item.parentRow !== null && !selectedRows.has(item.parentRow))) throw new Error("Dòng cha mapping không nằm trong bảng.");
  if (proposal.additional) {
    if ("additional" in proposal.additional ||
        proposal.kind === "PAIRED" || proposal.additional.kind === "PAIRED" || proposal.additional.kind === proposal.kind) {
      throw new Error("Chỉ hỗ trợ tối đa một bảng mỗi loại trong workbook.");
    }
    const secondRange = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i.exec(proposal.additional.range);
    if (proposal.additional.sheet === proposal.sheet && secondRange &&
        Number(secondRange[2]) <= lastRow && Number(secondRange[4]) >= firstRow) {
      throw new Error("Hai bảng cùng sheet phải có vùng dòng tách biệt.");
    }
    validateExcelMapping(inventory, proposal.additional);
  }
  return { sheet, tier: confidenceTier(proposal.confidence) };
}

export async function proposeExcelMapping(inventory: WorkbookInventory, model: GenerationModel, abort: AbortSignal) {
  const payload = buildMaskedStructurePayload(inventory);
  const authorizedSources = payload.sheets.map((sheet, index) => {
    const minimized = { policyVersion: EXCEL_MASK_POLICY_VERSION, sheet: { ...sheet, samples: [...sheet.samples] } };
    while (JSON.stringify(minimized).length > 20_000 && minimized.sheet.samples.length) minimized.sheet.samples.pop();
    return { span: { spanId: `excel-structure-${index + 1}`, sourceRevisionId: inventory.fingerprint,
      page: null, cellRange: sheet.range, quote: `${sheet.name} ${sheet.range}`.slice(0, 240) }, content: JSON.stringify(minimized) };
  });
  try {
    const result = await model.extract({ task: "EXCEL_STRUCTURE",
      instruction: "Return one candidate with key mapping and value as JSON containing only sheet (SHEET_1 or SHEET_2 token), range, headerRow, kind (QUOTATION|IC|PAIRED), columns (canonical field to 1-based column), rows (row, rowType, level, parentRow), confidence, and optional additional table on the other sheet with the same fields. Use coordinates only. Never return workbook values. No authority to confirm or import.",
      authorizedSources }, abort);
    const candidate = result.output.candidates[0];
    if (result.output.task !== "EXCEL_STRUCTURE" || result.output.candidates.length !== 1 || candidate.key !== "mapping" || !candidate.value ||
        !candidate.sources.length || candidate.sources.some(source => !authorizedSources.some(authorized => authorized.span.spanId === source.spanId && authorized.span.sourceRevisionId === source.sourceRevisionId))) {
      throw new Error("Model không trả mapping có nguồn hợp lệ.");
    }
    const proposal = JSON.parse(candidate.value) as ExcelMappingProposal;
    if (Object.keys(proposal).some(key => ["reviewed", "confirmedCriticalCells", "runId", "adapterId"].includes(key))) throw new Error("Model không được xác nhận mapping.");
    const sheetToken = /^SHEET_([12])$/.exec(proposal.sheet);
    if (!sheetToken || !inventory.sheets[Number(sheetToken[1]) - 1]) throw new Error("Model trả sheet ngoài phạm vi.");
    proposal.sheet = inventory.sheets[Number(sheetToken[1]) - 1].name;
    if (proposal.additional) {
      const additionalToken = /^SHEET_([12])$/.exec(proposal.additional.sheet);
      if (!additionalToken || !inventory.sheets[Number(additionalToken[1]) - 1]) throw new Error("Model trả sheet bổ sung ngoài phạm vi.");
      proposal.additional.sheet = inventory.sheets[Number(additionalToken[1]) - 1].name;
    }
    if (proposal.confidence > candidate.confidence || (proposal.additional?.confidence ?? 0) > candidate.confidence) throw new Error("Độ tin cậy mapping vượt mức model công bố.");
    validateExcelMapping(inventory, proposal);
    const tier = confidenceTier(Math.min(proposal.confidence, proposal.additional?.confidence ?? 1));
    return { status: tier === "UNMAPPED" ? "MANUAL_MAPPING" as const : "PROPOSED" as const,
      proposal: tier === "UNMAPPED" ? null : proposal, tier, providerRequestId: result.providerRequestId,
      policyVersion: EXCEL_MASK_POLICY_VERSION, tokenCounts: payload.tokenCounts };
  } catch {
    return { status: "MANUAL_MAPPING" as const, proposal: null, tier: "UNMAPPED" as const,
      providerRequestId: null, policyVersion: EXCEL_MASK_POLICY_VERSION, tokenCounts: payload.tokenCounts };
  }
}
