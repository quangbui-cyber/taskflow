import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const source = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

test("Project AI page authorizes before projecting source metadata", () => {
  const page = source("app/projects/[id]/ai/page.tsx");
  assert.ok(page.indexOf("requireAiProjectRead(user.id, id)") < page.indexOf("prisma.projectFile.findMany"));
  assert.match(page, /select: \{ id: true, name: true, mimeType: true, createdAt: true \}/);
  assert.doesNotMatch(page, /select: \{[^\n]*data: true/);
  const tabs = source("components/ProjectTabs.tsx");
  assert.match(tabs, /showAi \? \[/);
  assert.match(tabs, /active === id \? "page" : undefined/);
});

test("analysis only starts from an explicit selected-source click", () => {
  const launcher = source("components/ai/AiRunLauncher.tsx");
  assert.match(launcher, /Phân tích bằng AI/);
  assert.match(launcher, /disabled=\{!ready \|\| !providerEnabled\}/);
  assert.match(launcher, /onClick=\{launch\}/);
  assert.doesNotMatch(launcher, /useEffect/);
  assert.match(launcher, /Phạm vi đã chọn:/);
  assert.match(launcher, /AI trực tuyến chưa được bật cho môi trường này/);
  assert.match(launcher, /sources\[0\]\.businessKey === sources\[1\]\.businessKey/);
});

test("review and conflict UI keep field provenance and an explicit apply boundary", () => {
  const review = source("components/ai/AiReviewWorkspace.tsx");
  const conflict = source("components/ai/AiApplyConflictReview.tsx");
  const receipt = source("components/ai/AiApplicationReceiptView.tsx");
  assert.match(review, /AI trích xuất/);
  assert.match(review, /Người dùng sửa/);
  assert.match(review, /Người dùng nhập/);
  assert.match(review, /Mở nguồn/);
  assert.match(review, /Lý do chỉnh sửa/);
  assert.match(review, /isComposing/);
  assert.match(review, /pendingCount > 0 \|\| pending/);
  assert.match(conflict, /KEEP_CURRENT/);
  assert.match(conflict, /Giữ giá trị hiện có/);
  assert.match(conflict, /Áp dụng giá trị đã rà soát/);
  assert.match(conflict, /Áp dụng vào bản nháp/);
  assert.match(conflict, /prepareAiApplyConflicts/);
  assert.match(receipt, /targetVersionBefore/);
  assert.match(receipt, /targetVersionAfter/);
  assert.match(receipt, /field\.decision/);
});

test("source download rechecks run and source authority", () => {
  const route = source("app/api/projects/[id]/ai/runs/[runId]/source/[revisionId]/route.ts");
  assert.match(route, /await readAiRun\(actor\.id, id, runId\)/);
  assert.match(route, /sourceRevisionId: revisionId/);
  assert.match(route, /metadata\.version !== revision\.originVersion/);
  assert.match(route, /digest\("hex"\) !== revision\.sha256/);
});
