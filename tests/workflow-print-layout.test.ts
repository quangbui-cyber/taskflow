import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("approved Workflow and CostFlow print routes require an authorized reader and immutable snapshot", async () => {
  const workflow = await readFile(new URL("../app/workflow/[id]/print/page.tsx", import.meta.url), "utf8");
  const costflowRoute = await readFile(new URL("../app/projects/[id]/costflow/requests/[requestId]/print/page.tsx", import.meta.url), "utf8");
  const costflowData = await readFile(new URL("../lib/costflow/exportData.ts", import.meta.url), "utf8");
  assert.match(workflow, /requireUser/);
  assert.match(workflow, /loadDocument/);
  assert.match(workflow, /workflowApprovedSnapshot\.findFirst/);
  assert.match(workflow, /approvedSnapshotPrintDocument/);
  assert.match(costflowRoute, /requireUser/);
  assert.match(costflowData, /request\.state === "APPROVED"[\s\S]*workflowApprovedSnapshot\.findFirst/);
  assert.match(costflowData, /approvedSnapshotPrintDocument/);
});

test("approved print DTO is derived only from canonical projection and issued capability", async () => {
  const source = await readFile(new URL("../lib/workflow/printDocument.ts", import.meta.url), "utf8");
  assert.match(source, /computeApprovedProjectionSha256/);
  assert.match(source, /verifyApprovedProjectionAttestation/);
  assert.match(source, /deriveAuthorizedPublicTokenForSnapshot/);
  assert.match(source, /absolutePublicVerificationUrl/);
  assert.match(source, /projection\.finance\.lines/);
  assert.match(source, /projection\.signatures/);
  assert.doesNotMatch(source, /workflowRequest|payload|findUnique|findFirst/);
});

test("print supports four form kinds, four roles, draft watermark and no draft QR", async () => {
  const source = await readFile(new URL("../components/WorkflowPrintView.tsx", import.meta.url), "utf8");
  for (const kind of ["ADVANCE", "VENDOR_PAYMENT", "REIMBURSEMENT", "PROPOSAL"]) assert.match(source, new RegExp(kind));
  for (const role of ["CREATOR", "MANAGER", "ACCOUNTANT", "CEO"]) assert.match(source, new RegExp(role));
  assert.match(source, /BẢN NHÁP/);
  assert.match(source, /!doc\.isDraft && doc\.qrDataUrl/);
  assert.doesNotMatch(source, /Bùi Duy Quang|Đỗ Vũ Phương Uyên|Đoàn Thái Sơn|1903 8888/);
});

test("QR implementation uses maintained encoder with explicit EC and quiet zone", async () => {
  const source = await readFile(new URL("../components/workflow/QrCode.tsx", import.meta.url), "utf8");
  assert.match(source, /from "qrcode"/);
  assert.match(source, /errorCorrectionLevel:\s*"M"/);
  assert.match(source, /margin:\s*4/);
  assert.doesNotMatch(source, /generateQrMatrix|gfMul|rsEncode/);
});
