import assert from "node:assert/strict";
import { test } from "node:test";
import { validateExpectedEventForm, previewReminderSteps, expectedEventToast, type ExpectedEventFormState } from "../lib/crm/expectedEventForm";
const vn = (s: string) => new Date(`${s}T00:00:00+07:00`);
const state: ExpectedEventFormState = { programTypeCode: "MICE", buyingUnitId: "", precision: "DAY", dateKey: "2026-12-20", month: "", quarter: "", year: "2026", source: "CLIENT_CONFIRMED", note: "  Notes  " };
test("requires program, source and limits trimmed note", () => {
  const result = validateExpectedEventForm({ ...state, programTypeCode: "", source: "", note: "x".repeat(1001) }, 2026);
  assert.ok("errors" in result);
  assert.deepEqual(result.errors, { programTypeCode: "Chọn loại chương trình.", source: "Chọn nguồn.", note: "Ghi chú tối đa 1000 ký tự." });
});
test("requires real day, month/year or quarter within the year window", () => {
  for (const patch of [ { dateKey: "" }, { dateKey: "2026-02-30" }, { dateKey: "2030-01-01" }, { precision: "MONTH" as const, month: "" }, { precision: "MONTH" as const, month: "7", year: "" }, { precision: "MONTH" as const, month: "13" }, { precision: "MONTH" as const, month: "1.5" }, { precision: "QUARTER" as const, quarter: "" }, { precision: "QUARTER" as const, quarter: "5" } ]) {
    const result = validateExpectedEventForm({ ...state, ...patch }, 2026);
    assert.ok("errors" in result);
    assert.equal(result.errors.time, "Nhập thời gian dự kiến.");
  }
});
test("typed payload clears precision leftovers and normalizes optional inputs", () => {
  const result = validateExpectedEventForm({ ...state, month: "1", quarter: "3", year: "2025" }, 2026);
  assert.ok("ok" in result && result.ok);
  assert.deepEqual(result.value, { programTypeCode: "MICE", buyingUnitId: null, precision: "DAY", date: vn("2026-12-20"), year: 2026, month: 12, quarter: null, source: "CLIENT_CONFIRMED", note: "Notes" });
  const month = validateExpectedEventForm({ ...state, precision: "MONTH", month: "7", dateKey: "bad", note: " " }, 2026);
  assert.ok("ok" in month);
  assert.equal(month.value.date, null); assert.equal(month.value.note, null);
  const quarter = validateExpectedEventForm({ ...state, precision: "QUARTER", quarter: "2" }, 2026);
  assert.ok("ok" in quarter); assert.equal(quarter.value.month, null);
});
test("previews exact shared reminder planning including quarter and missing offsets", () => {
  const valid = validateExpectedEventForm(state, 2026); assert.ok("ok" in valid);
  const rows = previewReminderSteps(valid.value, { MICE: [90, 60, 30] }, vn("2026-08-22"));
  assert.deepEqual(rows.map(r => [r.label, r.dueDate]), [["90 ngày trước", vn("2026-09-21")], ["60 ngày trước", vn("2026-10-21")], ["30 ngày trước", vn("2026-11-20")]]);
  const quarter = { ...valid.value, precision: "QUARTER" as const, year: 2027, month: null, date: null, quarter: 2 };
  assert.deepEqual(previewReminderSteps(quarter, { MICE: [90, 60, 30] }, vn("2026-08-22")).map(r => [r.kind, r.label]), [["VERIFY_MONTH", "Xác minh tháng"]]);
  assert.deepEqual(previewReminderSteps(valid.value, {}, vn("2026-08-22")), []);
});
test("preview uses server past-collapse and after-event rules; feedback counts", () => {
  const valid = validateExpectedEventForm(state, 2026); assert.ok("ok" in valid);
  assert.equal(previewReminderSteps(valid.value, { MICE: [90, 60, 30] }, vn("2026-11-01")).length, 2);
  assert.deepEqual(previewReminderSteps(valid.value, { MICE: [90] }, vn("2026-12-21")), []);
  assert.equal(expectedEventToast("create", 3), "Đã lưu sự kiện và tạo 3 mốc nhắc.");
  assert.equal(expectedEventToast("update", 2), "Đã cập nhật ngày, 2 mốc chưa làm được tính lại.");
});
