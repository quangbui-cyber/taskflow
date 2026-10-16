import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("supplier schedule is IC-linked, has no synthetic 50/50 and only creates DNTU before AC", () => {
  const schedule = source("components/VendorPaymentScheduleTable.tsx");
  assert.match(schedule, /Phân bổ theo hạng mục IC của NCC/);
  assert.match(schedule, /lineAllocations/);
  assert.match(schedule, /scheduleMilestoneId: milestone\.id/);
  assert.match(schedule, /Theo kế hoạch/);
  assert.match(schedule, /Phát sinh/);
  assert.match(schedule, /ĐNTT chỉ lập sau khi có AC và hóa đơn VAT điện tử/);
  assert.doesNotMatch(schedule, /Default 2 installments|Math\.round\(data\.totalGross \* 0\.5\)/);
  assert.doesNotMatch(schedule, /kind: "VENDOR_PAYMENT"/);
});

test("schedule opens the normalized DNTU editor with exact IC allocations and persists linkage", () => {
  const editor = source("components/costflow/payments/PaymentRequestEditor.tsx");
  const service = source("lib/costflow/service.ts");
  assert.match(editor, /initialScheduleMilestoneId/);
  assert.match(editor, /scheduleMilestone\.lineAllocations\.map/);
  assert.match(editor, /name="scheduleMilestoneId"/);
  assert.match(service, /Đợt lịch thanh toán đã liên kết một hồ sơ ĐNTU/);
  assert.match(service, /scheduleMilestone\.linkedRequestId = saved\.id/);
  assert.match(service, /Phân bổ ĐNTU đã khác lịch thanh toán/);
});

test("legacy Expense remains readable but has no creation modal or buttons", () => {
  const panel = source("components/ActualCostPanel.tsx");
  assert.match(panel, /Expense cũ chỉ đọc/);
  assert.doesNotMatch(panel, /ExpenseUploadModal|openUploadModalWithDefaults|Báo chi phí mới|Ghi chi phí/);
});

test("supplier bank proof is optional and accountant verification is explicit", () => {
  const service = source("lib/costflow/service.ts");
  const modal = source("components/ExpenseRequestModal.tsx");
  assert.match(service, /accountFingerprint/);
  assert.match(service, /reviewConfirmed/);
  assert.doesNotMatch(service, /Chọn file xác minh đã có hoặc tải file xác minh mới/);
  assert.match(modal, /không bắt buộc/);
  assert.match(modal, /API ngân hàng đang để pending/);
});
