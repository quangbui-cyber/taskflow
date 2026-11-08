import type ExcelJS from "exceljs";
import { clientNameKey } from "../clientCatalog";
export class TrackerImportError extends Error {}
export const TRACKER_SHEETS = { PROSPECT: "Prospect", CSKH: "CSKH", BRIEF: "Brief", LOST: "Lost Log" } as const;
type SheetKey = keyof typeof TRACKER_SHEETS;
type FieldKey = "clientName" | "buyingUnit" | "programType" | "expectedPeriod" | "pic" | "source" | "lastTouchDate" | "touchResult" | "briefDate" | "budget" | "outcome" | "lostReason" | "winbackPlan" | "note";
// Người dùng chọn "no file": alias từ đề án, chưa xác nhận header của tracker thật.
const aliases: Record<FieldKey, string[]> = {
  clientName: ["Khách hàng", "Tên khách hàng", "Công ty", "Tên công ty", "Client"],
  buyingUnit: ["Đơn vị mua", "Buying unit"], programType: ["Loại chương trình", "Loại dịch vụ", "Program type"],
  expectedPeriod: ["Thời gian dự kiến", "Tháng/quý dự kiến", "Expected period"], pic: ["PIC", "Account phụ trách", "Người phụ trách"],
  source: ["Nguồn", "Nguồn tiếp cận", "Source"], lastTouchDate: ["Ngày thực tế", "Ngày tiếp cận", "Lần tiếp cận gần nhất", "Last touch date"],
  touchResult: ["Kết quả tiếp cận", "Mức kết quả", "Touch result"], briefDate: ["Ngày nhận brief", "Brief date"],
  budget: ["Ngân sách", "Budget"], outcome: ["Kết quả", "Outcome", "Win/Lost"], lostReason: ["Lý do thua", "Lý do", "Lost reason"],
  winbackPlan: ["Kế hoạch lấy lại", "Winback plan"], note: ["Ghi chú", "Note"],
};
export const TRACKER_COLUMN_MAP: Record<SheetKey, Record<FieldKey, string[]>> = {
  PROSPECT: structuredClone(aliases), CSKH: structuredClone(aliases), BRIEF: structuredClone(aliases), LOST: structuredClone(aliases),
};
function headerKey(value: string): string { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").trim().replace(/\s+/g, " ").toLowerCase(); }
function cellValue(value: unknown): unknown {
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const v = value as { text?: unknown; result?: unknown; richText?: { text: string }[] };
    if (Array.isArray(v.richText)) return v.richText.map((p) => p.text).join("");
    if (v.result !== undefined) return v.result;
    if (v.text !== undefined) return v.text;
  }
  return value;
}
type TrackerDate = { kind: "DATE"; date: Date } | { kind: "MONTH"; year: number; month: number } | { kind: "QUARTER"; year: number; quarter: number } | { kind: "TEXT"; raw: string };
export function parseTrackerDate(value: unknown): TrackerDate | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date && Number.isFinite(value.getTime())) return { kind: "DATE", date: new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()) - 7 * 3600000) };
  const raw = String(value); const text = raw.trim();
  if (!text) return null;
  let match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (match) {
    const day = +match[1], month = +match[2], year = +match[3];
    const utc = new Date(Date.UTC(year, month - 1, day));
    if (year >= 1900 && year <= 2200 && utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day) return { kind: "DATE", date: new Date(utc.getTime() - 7 * 3600000) };
  }
  match = /^T(\d{1,2})\/(\d{4})$/i.exec(text);
  if (match && +match[1] >= 1 && +match[1] <= 12 && +match[2] >= 1900 && +match[2] <= 2200) return { kind: "MONTH", year: +match[2], month: +match[1] };
  match = /^Q([1-4])\/(\d{4})$/i.exec(text);
  if (match && +match[2] >= 1900 && +match[2] <= 2200) return { kind: "QUARTER", year: +match[2], quarter: +match[1] };
  return { kind: "TEXT", raw };
}
export type TrackerRowDraft = {
  sheet: string; rowNumber: number; raw: Record<string, string>;
  proposed: { clientName: string | null; matchedClientId: string | null; programTypeCode: string | null; picAccountId: string | null; period: ReturnType<typeof parseTrackerDate>; outcome: string | null; legacyOutcome: string | null; reasonId: string | null; opportunityKey: string | null; touch: { date: Date; level: number } | null };
  status: "OK" | "DUPLICATE" | "UNCLEAR" | "TEXT_DATE" | "MISSING_PIC";
};
type Context = { clients: { id: string; name: string }[]; accounts: { id: string; name: string }[]; programAliases: Map<string, string>; reasons: { id: string; group: string; label: string }[] };
export function parseTrackerWorkbook(workbook: ExcelJS.Workbook, ctx: Context): TrackerRowDraft[] {
  const results: TrackerRowDraft[] = [];
  const duplicateCandidates: { row: TrackerRowDraft; key: string }[] = [];
  const programAliases = new Map([...ctx.programAliases].map(([alias, code]) => [headerKey(alias), code]));
  let sheetCount = 0;
  for (const sheet of workbook.worksheets) {
    const sheetKey = (Object.keys(TRACKER_SHEETS) as SheetKey[]).find((key) => headerKey(TRACKER_SHEETS[key]) === headerKey(sheet.name) || (key === "LOST" && headerKey(sheet.name) === "deal lost log"));
    if (!sheetKey) continue;
    sheetCount++;
    if (sheet.rowCount > 5001) throw new TrackerImportError("Mỗi sheet chỉ được tối đa 5.000 dòng dữ liệu.");
    if (sheet.columnCount > 256) throw new TrackerImportError("Sheet có quá nhiều cột dữ liệu.");
    const fields = new Map<number, FieldKey>(); const headers = new Map<number, string>(); const seen = new Set<string>();
    for (let col = 1; col <= sheet.columnCount; col++) {
      const name = sheet.getRow(1).getCell(col).text;
      let rawKey = name || `__column_${col}`;
      if (seen.has(rawKey)) rawKey += `#${col}`;
      seen.add(rawKey); headers.set(col, rawKey);
      const field = (Object.keys(TRACKER_COLUMN_MAP[sheetKey]) as FieldKey[]).find((f) => TRACKER_COLUMN_MAP[sheetKey][f].some((alias) => headerKey(alias) === headerKey(name)));
      if (field) fields.set(col, field);
    }
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1 || row.actualCellCount === 0) return;
      const raw: Record<string, string> = Object.create(null);
      const values = new Map<FieldKey, unknown>(); let unclear = false;
      for (let col = 1; col <= sheet.columnCount; col++) {
        const cell = row.getCell(col); raw[headers.get(col)!] = cell.text;
        const field = fields.get(col);
        if (field) { if (values.has(field)) unclear = true; else values.set(field, cellValue(cell.value)); }
        else unclear = true;
      }
      const text = (field: FieldKey) => String(values.get(field) ?? "").trim();
      const clientName = text("clientName") || null;
      const key = clientName ? clientNameKey(clientName) : "";
      const matches = ctx.clients.filter((c) => clientNameKey(c.name) === key);
      const matchedClientId = matches.length === 1 ? matches[0].id : null;
      const accounts = ctx.accounts.filter((a) => headerKey(a.name) === headerKey(text("pic")));
      const picAccountId = text("pic") && accounts.length === 1 ? accounts[0].id : null;
      const programTypeCode = programAliases.get(headerKey(text("programType"))) ?? null;
      const period = parseTrackerDate(values.get("expectedPeriod"));
      const touchDate = parseTrackerDate(values.get("lastTouchDate"));
      const briefDate = parseTrackerDate(values.get("briefDate"));
      const outcomeText = text("outcome");
      const reasonText = text("lostReason") || outcomeText;
      const reasons = ctx.reasons.filter((r) => r.group === "LOST" && headerKey(r.label) === headerKey(reasonText));
      const reasonId = reasonText && reasons.length === 1 ? reasons[0].id : null;
      const won = ["win", "won", "thang"].includes(headerKey(outcomeText));
      const knownLoss = reasonId !== null && (!outcomeText || headerKey(outcomeText) === headerKey(reasons[0].label));
      const outcome = won ? "WON" : knownLoss ? "LOST_COMPETITIVE" : outcomeText ? "LEGACY_UNCLASSIFIED" : null;
      const year = period?.kind === "DATE" ? new Date(period.date.getTime() + 7 * 3600000).getUTCFullYear() : period?.kind === "MONTH" || period?.kind === "QUARTER" ? period.year : null;
      const opportunityKey = (sheetKey === "BRIEF" || sheetKey === "LOST") && key && programTypeCode && year ? JSON.stringify([key, programTypeCode, year]) : null;
      const levels = ["Đã thử liên hệ", "Có phản hồi thực chất", "Có cuộc hẹn", "Có nhu cầu xác nhận"].map(headerKey);
      const level = /^[1-4]$/.test(text("touchResult")) ? +text("touchResult") : levels.indexOf(headerKey(text("touchResult"))) + 1;
      const touch = touchDate?.kind === "DATE" && level >= 1 && level <= 4 ? { date: touchDate.date, level } : null;
      if (!clientName || matches.length > 1 || (text("programType") && !programTypeCode) || outcome === "LEGACY_UNCLASSIFIED" || (sheetKey === "LOST" && !outcome) || ((sheetKey === "BRIEF" || sheetKey === "LOST") && !opportunityKey) || (text("touchResult") && !touch) || (text("lostReason") && !reasonId)) unclear = true;
      const textDate = [period, touchDate, briefDate].some((d) => d?.kind === "TEXT");
      const draft: TrackerRowDraft = { sheet: sheet.name, rowNumber, raw, proposed: { clientName, matchedClientId, programTypeCode, picAccountId: picAccountId || null, period, outcome, legacyOutcome: outcome === "LEGACY_UNCLASSIFIED" ? outcomeText : null, reasonId, opportunityKey, touch }, status: matches.length > 0 && key ? "DUPLICATE" : !picAccountId ? "MISSING_PIC" : textDate ? "TEXT_DATE" : unclear ? "UNCLEAR" : "OK" };
      results.push(draft);
      if ((sheetKey === "PROSPECT" || sheetKey === "CSKH") && key) duplicateCandidates.push({ row: draft, key });
    });
  }
  if (!sheetCount) throw new TrackerImportError("Không tìm thấy sheet Prospect, CSKH, Brief hoặc Lost Log.");
  const counts = new Map<string, number>();
  for (const { key } of duplicateCandidates) counts.set(key, (counts.get(key) ?? 0) + 1);
  for (const { row, key } of duplicateCandidates) if (counts.get(key)! > 1) row.status = "DUPLICATE";
  return results;
}
