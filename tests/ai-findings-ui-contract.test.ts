import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const source = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

test("Project queue keeps category labels, source actions and four reasoned outcomes", () => {
  const queue = source("components/ai/AiFindingQueue.tsx");
  for (const label of ["Lỗi quy tắc chắc chắn", "Nghi vấn AI", "Thiếu/không đọc được dữ liệu",
    "Đã sửa", "Chấp nhận ngoại lệ", "Không đúng cảnh báo", "Cần bổ sung",
    "Mở vị trí cần xử lý", "Lý do xử lý"]) assert.ok(queue.includes(label));
  assert.match(queue, /aria-pressed=\{kind === value\}/);
  assert.match(queue, /<th scope="col">/);
  assert.match(queue, /<th scope="row">/);
  assert.match(queue, /md:hidden/);
  assert.match(queue, /hidden md:block/);
  assert.match(queue, /reason\.trim\(\)\.length < 3/);
  assert.match(queue, /await reload\(\)/);
});

test("review joins exact run, field and span while Project keeps a persistent queue", () => {
  const review = source("components/ai/AiReviewWorkspace.tsx");
  const workspace = source("components/ai/ProjectAiWorkspace.tsx");
  assert.match(review, /AiInlineFindings/);
  assert.match(review, /item\.runId === run\.id && item\.targetKind === "FIELD" && item\.targetId === field\.id/);
  assert.match(review, /item\.sourceSpanId === \(field\.sourceSpan\?\.id \?\? null\)/);
  assert.match(workspace, /<AiFindingQueue projectId=\{projectId\}/);
  assert.match(workspace, /tab === "findings"/);
});
