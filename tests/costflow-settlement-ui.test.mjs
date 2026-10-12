import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("settlement workspace composes the six axis-separated operational surfaces", () => {
  const panel = source("components/SettlementPanel.tsx");
  for (const component of [
    "SettlementProgressCards",
    "ProjectSettlementTable",
    "SettlementExportActions",
    "FinancialCloseModal",
    "SettlementEvidenceUploader",
    "PaymentLedgerTable",
  ]) assert.match(panel, new RegExp(component));
  for (const label of [
    "Trạng thái duyệt",
    "Khóa quyết toán",
    "Tiến độ tiền",
    "Trạng thái ký",
    "Công việc TaskFlow",
    "Đóng tài chính",
  ]) assert.match(panel, new RegExp(label));
  assert.doesNotMatch(panel, /Task DONE[^\n]*(?:đã đóng|CLOSED)|đã ký[^\n]*(?:đã đóng|CLOSED)/i);
});

test("progress cards keep internal settlement and customer AR independent", () => {
  const cards = source("components/costflow/settlement/SettlementProgressCards.tsx");
  for (const label of [
    "Tiến độ Đối soát Nội bộ",
    "Tiến độ Doanh thu Khách hàng",
    "AC đã quyết toán",
    "Công nợ nội bộ",
    "Thanh lý đã ký",
    "AR còn phải thu",
  ]) assert.match(cards, new RegExp(label));
  assert.match(cards, /aria-valuenow/);
  assert.match(cards, /grid-cols-1/);
  assert.match(cards, /md:grid-cols-2/);
  assert.doesNotMatch(cards, /customer.*(?:obligation|approvedAc|advance)/i);
});

test("settlement table preserves warnings, fixed diagnostics, cash provenance and responsive semantics", () => {
  const table = source("components/costflow/settlement/ProjectSettlementTable.tsx");
  for (const label of [
    "AC chưa được DD duyệt",
    "Thiếu liên kết IC/AC",
    "Thiếu hóa đơn/chứng từ chi phí",
    "Thiếu bằng chứng tiền đã chi",
    "ĐNHTU",
    "ĐNTT",
    "Pending Disbursement",
    "Đã chi lũy kế",
    "Còn phải thực hiện",
    "Nguồn hồ sơ",
  ]) assert.match(table, new RegExp(label));
  assert.match(table, /<Table caption=/);
  assert.match(table, /scope="col"/);
  assert.match(table, /tf-payment-ledger-table/);
  assert.match(table, /tf-payment-ledger-cards/);
  assert.match(table, /min-h-11/);
});

test("evidence uploader exposes inherited and supplemental lineage without conflating diagnostics", () => {
  const uploader = source("components/costflow/settlement/SettlementEvidenceUploader.tsx");
  for (const fact of [
    "ADD_SETTLEMENT_EVIDENCE",
    "RELATED_IC_AC",
    "EXPENSE_EVIDENCE",
    "DISBURSEMENT_PROOF",
    "Kế thừa",
    "Bổ sung",
    "sha256",
  ]) assert.match(uploader, new RegExp(fact));
  assert.match(uploader, /type="file"/);
  assert.match(uploader, /accept=/);
  assert.match(uploader, /min-h-11/);
});

test("exports expose six XLSX and six PDF actions bound to an explicit immutable version", () => {
  const actions = source("components/costflow/settlement/SettlementExportActions.tsx");
  const families = ["quotation", "customer-acceptance", "dntu", "dntt", "dnhtu", "project-settlement"];
  for (const family of families) assert.match(actions, new RegExp(family));
  assert.match(actions, /versionId=/);
  assert.match(actions, /\/print/);
  assert.match(actions, /6 tệp Excel/);
  assert.match(actions, /6 bản PDF/);
  assert.match(actions, /min-h-11/);
});

test("close and reopen dialogs are explicit, blocker-aware and preserve B02 history", () => {
  const modal = source("components/costflow/settlement/FinancialCloseModal.tsx");
  const dialog = source("components/ui/Dialog.tsx");
  for (const fact of [
    "REQUEST_CLOSE_PROJECT",
    "REQUEST_REOPEN_PROJECT",
    "Gửi yêu cầu đóng tài chính",
    "Gửi yêu cầu mở lại tài chính",
    "bảo toàn 100%",
    "một hồ sơ quyết toán",
    "Capability xin mở",
    "ADD_NEW_AC",
    "CORRECT_RECIPIENT",
    "RECOVER_CASH",
    "Vòng sửa quyết toán có phạm vi",
    "Phiên bản / hash nền",
    "Recovery còn lại",
    "Corrected payment",
    "Approval mới",
    "Signing snapshot mới",
    "Cash · khóa SETTLED · TaskFlow · đóng tài chính",
  ]) assert.match(modal, new RegExp(fact, "i"));
  assert.match(modal, /disabled=/);
  assert.match(dialog, /<dialog/);
  assert.match(dialog, /aria-labelledby/);
  assert.match(dialog, /onCancel/);
});
