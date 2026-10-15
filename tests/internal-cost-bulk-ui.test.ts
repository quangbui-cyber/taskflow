import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../components/InternalCostPanel.tsx", import.meta.url), "utf8");

test("Internal Cost exposes draft-only bulk selection for vendor and evidence assignment", () => {
  assert.match(source, /isEditableDraft && \(\s*<div[^>]+>[\s\S]*Gắn NCC hàng loạt/);
  assert.match(source, /Gắn Minh chứng hàng loạt/);
  assert.match(source, /toggleAllFilteredLines/);
  assert.match(source, /Chọn tất cả \$\{filteredLines\.length\} dòng đang hiển thị/);
  assert.match(source, /checked=\{selectedLineIdSet\.has\(line\.id\)\}/);
});

test("bulk save retains unrelated IC fields and merges evidence instead of replacing it", () => {
  assert.match(source, /selectedLineIdSet\.has\(line\.id\) \? \{ \.\.\.line, vendorId: bulkVendorId \} : line/);
  assert.match(source, /evidenceIds: \[\.\.\.new Set\(\[\.\.\.\(line\.evidenceIds \?\? \[\]\), \.\.\.bulkEvidenceIds\]\)\]/);
  assert.match(source, /command="SAVE_IC"/);
  assert.match(source, /NCC đã chọn sẽ thay thế NCC hiện tại trên các dòng được chọn\. Các số liệu và Minh chứng khác được giữ nguyên\./);
});
