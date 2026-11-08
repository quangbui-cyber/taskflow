import assert from "node:assert/strict";
import { test } from "node:test";
import ExcelJS from "exceljs";
import { parseTrackerDate, parseTrackerWorkbook, TrackerImportError } from "../lib/crm/trackerImport";
const ctx = { clients: [{ id: "existing", name: "Công ty A" }], accounts: [{ id: "pic", name: "An" }], programAliases: new Map([["MICE", "MICE"]]), reasons: [{ id: "price", group: "LOST", label: "Giá" }] };
test("tracker dates are exact calendar values or retained text, never guessed", () => {
  const date = parseTrackerDate("15/03/2026");
  assert.equal(date?.kind, "DATE");
  if (date?.kind === "DATE") assert.equal(date.date.toISOString(), "2026-03-14T17:00:00.000Z");
  assert.deepEqual(parseTrackerDate("T5/2026"), { kind: "MONTH", year: 2026, month: 5 });
  assert.deepEqual(parseTrackerDate("Q2/2026"), { kind: "QUARTER", year: 2026, quarter: 2 });
  assert.deepEqual(parseTrackerDate("đầu tháng 5"), { kind: "TEXT", raw: "đầu tháng 5" });
  assert.deepEqual(parseTrackerDate("31/02/2026"), { kind: "TEXT", raw: "31/02/2026" });
  assert.equal(parseTrackerDate(null), null);
  assert.equal(parseTrackerDate(new Date("2026-03-15T00:00:00Z"))?.kind, "DATE");
});
test("synthetic tracker preserves raw columns and actual row numbers, flags uncertainty by priority", () => {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("prospect");
  sheet.addRow(["Khách hàng", "PIC", "Thời gian dự kiến", "Cột chưa ánh xạ"]);
  sheet.addRow(["Công ty A", "An", "đầu tháng 5", "  giữ nguyên  "]);
  sheet.getRow(4).values = ["Công ty B", "An", "đầu tháng 5", "x"];
  const care = wb.addWorksheet("CSKH");
  care.addRow(["Khách hàng", "PIC"]); care.addRow(["Công ty C", ""]);
  const rows = parseTrackerWorkbook(wb, ctx);
  assert.equal(rows[0].status, "DUPLICATE");
  assert.equal(rows[0].proposed.matchedClientId, "existing");
  assert.equal(rows[0].raw["Cột chưa ánh xạ"], "  giữ nguyên  ");
  assert.equal(rows[1].rowNumber, 4);
  assert.equal(rows[1].status, "TEXT_DATE");
  assert.equal(rows[2].status, "MISSING_PIC");
});
test("Brief and Deal Lost Log share a stable opportunity key and preserve FAIL outcome", () => {
  const wb = new ExcelJS.Workbook();
  for (const name of ["Brief", "Deal Lost Log"]) {
    const s = wb.addWorksheet(name); s.addRow(["Khách hàng", "PIC", "Loại chương trình", "Thời gian dự kiến", "Kết quả"]);
    s.addRow(["New Client", "An", "MICE", "Q2/2026", name === "Brief" ? "" : "FAIL"]);
  }
  const rows = parseTrackerWorkbook(wb, ctx);
  assert.equal(rows[0].proposed.opportunityKey, rows[1].proposed.opportunityKey);
  assert.ok(rows[0].proposed.opportunityKey);
  assert.equal(rows[1].proposed.outcome, "LEGACY_UNCLASSIFIED");
  assert.equal(rows[1].proposed.legacyOutcome, "FAIL");
  assert.equal(rows[1].status, "UNCLEAR");
});
test("unmapped headers and ambiguous PICs are reviewable; duplicate clients in file flag both", () => {
  const wb = new ExcelJS.Workbook(); const s = wb.addWorksheet("Prospect");
  s.addRow(["Khách hàng", "PIC", "Unknown"]); s.addRow(["New", "An", "v"]); s.addRow([" new ", "An", "v"]); s.addRow(["Other", "An", "v"]);
  const rows = parseTrackerWorkbook(wb, ctx);
  assert.deepEqual(rows.map((r) => r.status), ["DUPLICATE", "DUPLICATE", "UNCLEAR"]);
  const ambiguous = parseTrackerWorkbook(wb, { ...ctx, accounts: [...ctx.accounts, { id: "second", name: "An" }] });
  assert.equal(ambiguous[2].status, "MISSING_PIC");
});
test("tracker parser caps rows and rejects unrecognized workbooks", () => {
  const wb = new ExcelJS.Workbook(); const s = wb.addWorksheet("Prospect");
  s.addRow(["Khách hàng"]); s.getRow(5002).values = ["too many"];
  assert.throws(() => parseTrackerWorkbook(wb, ctx), TrackerImportError);
  assert.throws(() => parseTrackerWorkbook(new ExcelJS.Workbook(), ctx), TrackerImportError);
});
