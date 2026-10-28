import { EXCEL_MAPPING_VERSION, type WorkbookInventory } from "./workbookInventory";

export const EXCEL_MASK_POLICY_VERSION = "phase15-mask-v1";
const sensitive = [
  { kind: "BANK_ACCOUNT", pattern: /\b\d{9,20}\b/g },
  { kind: "EMAIL", pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  { kind: "PHONE", pattern: /\b(?:\+?84|0)\d{9,10}\b/g },
  { kind: "IDENTIFIER", pattern: /\b\d{8,12}\b/g },
];

export function maskWorkbookText(value: string, counts: Record<string, number>) {
  let masked = value.slice(0, 120);
  for (const { kind, pattern } of sensitive) masked = masked.replace(pattern, () => {
    counts[kind] = (counts[kind] ?? 0) + 1;
    return `<${kind}_${counts[kind]}>`;
  });
  return masked;
}

function safeFormat(format: string) {
  if (/^[0#?.,%/:+\- ]{0,50}$/.test(format)) return format;
  if (/\b[dmhy]{1,4}\b/i.test(format)) return "<DATE_TIME_FORMAT>";
  return "<CUSTOM_FORMAT>";
}

function safeHeader(value: string, counts: Record<string, number>) {
  const recognized = /^(?:level|row.?type|parent.?row|name|description|quantity|price|unit|vat|supplier|note|stt|hạng mục|mô tả|số lượng|đơn giá|giá vốn|đvt|nhà cung cấp|ghi chú|cấp|loại dòng|dòng cha)/i.exec(value.trim());
  const masked = maskWorkbookText(value, counts);
  if (!recognized) return "<HEADER_TEXT>";
  return `${recognized[0]} ${(masked.match(/<(?:BANK_ACCOUNT|EMAIL|PHONE|IDENTIFIER)_\d+>/g) ?? []).join(" ")}`.trim();
}

export function buildMaskedStructurePayload(inventory: WorkbookInventory) {
  const tokenCounts: Record<string, number> = {};
  const sheets = inventory.sheets.map((sheet, index) => ({
    name: `SHEET_${index + 1}`, range: sheet.range,
    hiddenRows: sheet.hiddenRows, hiddenColumns: sheet.hiddenColumns,
    mergedRanges: sheet.mergedRanges, formulaCells: sheet.formulaCells,
    samples: [...sheet.cells.values()]
      .filter(cell => cell.row <= sheet.firstRow + 20 && !sheet.hiddenRows.includes(cell.row) && !sheet.hiddenColumns.includes(cell.column))
      .slice(0, 160).map(cell => ({ cell: cell.address, type: cell.type, format: safeFormat(cell.format),
        sample: cell.formula !== undefined ? "<FORMULA>" : typeof cell.value === "string" ? cell.row === sheet.firstRow ? safeHeader(cell.value, tokenCounts) : "<TEXT>" : typeof cell.value === "number" ? "<NUMBER>" : "<OTHER>" })),
  }));
  return { policyVersion: EXCEL_MASK_POLICY_VERSION, adapterVersion: EXCEL_MAPPING_VERSION, sheets, tokenCounts };
}
