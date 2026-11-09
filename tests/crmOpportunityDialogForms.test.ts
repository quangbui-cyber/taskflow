import test from "node:test";
import assert from "node:assert/strict";
import { allowedOutcomes, reasonGroupFor, validateStageForm, validateOutcomeForm, buildAdvancePayload, buildClosePayload, buildWinPayload, outcomeFooterLines, type OutcomeForm } from "../lib/crm/opportunityDialogForms";

const today = "2026-11-09";
const reasons = { LOST: [{ id: "price", label: "Giá", requiresNote: false }, { id: "other", label: "Khác", requiresNote: true }], CANCELLED: [{ id: "cancel", label: "Đổi kế hoạch", requiresNote: false }], DECLINED: [] };
const win = (patch: Partial<OutcomeForm> = {}): OutcomeForm => ({ outcome: "WON", contractValue: "1.250.000.000", wonAt: "2026-11-08", projectName: "YEP", reasonId: "", note: "", lessons: "", followUp: false, followUpTitle: "", assigneeId: null, dueDate: "", ...patch });

test("available results follow stage and closed rules", () => {
  assert.deepEqual(allowedOutcomes("BIDDING", null), ["WON", "LOST_COMPETITIVE", "CUSTOMER_CANCELLED", "CS_DECLINED"]);
  for (const stage of ["CARE", "BRIEF"] as const) assert.deepEqual(allowedOutcomes(stage, null), ["CUSTOMER_CANCELLED", "CS_DECLINED"]);
  assert.deepEqual(allowedOutcomes("BIDDING", "WON"), []);
  assert.equal(reasonGroupFor("WON"), null);
  assert.equal(reasonGroupFor("LOST_COMPETITIVE"), "LOST");
});
test("win requires positive safe contract, a valid past/today date and Project name", () => {
  assert.deepEqual(validateOutcomeForm(win(), reasons, today), {});
  for (const contractValue of ["", "0", "-1", "1.25", "9007199254740992"]) assert.equal(validateOutcomeForm(win({ contractValue }), reasons, today).contractValue, "Nhập giá trị hợp đồng.");
  for (const wonAt of ["", "2026-11-10", "2026-02-30"]) assert.equal(validateOutcomeForm(win({ wonAt }), reasons, today).wonAt, "Chọn ngày thắng không sau hôm nay.");
  assert.equal(validateOutcomeForm(win({ projectName: " " }), reasons, today).projectName, "Nhập tên Project.");
  assert.deepEqual(validateOutcomeForm(win({ outcome: null }), reasons, today), { outcome: "Chọn kết quả." });
});
test("non-win requires current group reason, required note and complete follow-up", () => {
  const s = win({ outcome: "LOST_COMPETITIVE" });
  assert.deepEqual(validateOutcomeForm(s, reasons, today), { reasonId: "Chọn lý do." });
  assert.equal(validateOutcomeForm({ ...s, reasonId: "cancel" }, reasons, today).reasonId, "Chọn lý do.");
  assert.deepEqual(validateOutcomeForm({ ...s, reasonId: "other" }, reasons, today), { note: "Ghi chú cho lý do Khác." });
  assert.equal(validateOutcomeForm({ ...s, reasonId: "price", followUp: true }, reasons, today).followUp, "Nhập việc cần làm và hạn.");
  assert.equal(validateOutcomeForm({ ...s, reasonId: "price", followUp: true, followUpTitle: "Gửi case", dueDate: today }, reasons, today).assigneeId, "Chọn người làm đang hoạt động.");
  assert.deepEqual(validateOutcomeForm({ ...s, reasonId: "price", followUp: true, followUpTitle: "Gửi case", dueDate: today, assigneeId: "user" }, reasons, today), {});
});
test("Brief dates and optional budgets validate; Bidding requires no field", () => {
  assert.equal(validateStageForm("BRIEF", { briefReceivedAt: "" }, today).briefReceivedAt, "Nhập ngày nhận Brief.");
  assert.equal(validateStageForm("BRIEF", { briefReceivedAt: "2026-11-10" }, today).briefReceivedAt, "Ngày nhận Brief không được sau hôm nay.");
  assert.equal(validateStageForm("BRIEF", { briefReceivedAt: today, budgetMin: "10", budgetMax: "5" }, today).budgetMin, "Ngân sách từ phải nhỏ hơn hoặc bằng ngân sách đến.");
  assert.ok(validateStageForm("BRIEF", { briefReceivedAt: today, budgetMin: "x" }, today).budgetMin);
  assert.deepEqual(validateStageForm("BIDDING", {}, today), {});
});
test("builders match action wire contract; win never takes budget; toggled off follow-up omitted", () => {
  assert.deepEqual(buildWinPayload("opp", 2, win()), { opportunityId: "opp", expectedVersion: 2, contractValue: "1250000000", wonAt: "2026-11-08", projectName: "YEP" });
  assert.deepEqual(buildAdvancePayload("opp", 3, "BRIEF", { briefReceivedAt: today, budgetMin: "1.000", budgetMax: "", briefSummary: " Brief " }), { opportunityId: "opp", expectedVersion: 3, to: "BRIEF", briefReceivedAt: today, proposalDueAt: null, budgetMin: "1000", budgetMax: null, briefSummary: "Brief" });
  assert.deepEqual(buildAdvancePayload("opp", 4, "BIDDING", { winStrategy: "Case", proposalPlannedAt: today }), { opportunityId: "opp", expectedVersion: 4, to: "BIDDING", winStrategy: "Case", proposalPlannedAt: today });
  const closed = win({ outcome: "LOST_COMPETITIVE", reasonId: "price", followUpTitle: "Unused" });
  assert.equal("followUp" in buildClosePayload("opp", 5, closed), false);
  assert.deepEqual(buildClosePayload("opp", 5, { ...closed, followUp: true, followUpTitle: " Gửi case ", assigneeId: "user", dueDate: today }).followUp, { title: "Gửi case", assigneeId: "user", dueDate: today });
});
test("footer spells out irreversible close and actual transfer/task counts", () => {
  assert.deepEqual(outcomeFooterLines(null, 4, null), []);
  assert.deepEqual(outcomeFooterLines("LOST_COMPETITIVE", 3, null), ["3 việc chuẩn bị thầu đang mở sẽ đóng.", "Cơ hội đã kết thúc không mở lại được."]);
  assert.deepEqual(outcomeFooterLines("CUSTOMER_CANCELLED", 0, null), ["Cơ hội đã kết thúc không mở lại được."]);
  assert.deepEqual(outcomeFooterLines("WON", 0, { tasks: 4, files: 3, meetings: 2 }), ["Chuyển sang Project: 4 việc · 3 file · 2 cuộc họp", "Cơ hội đã kết thúc không mở lại được."]);
});
