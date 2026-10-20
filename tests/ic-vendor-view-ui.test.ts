import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../components/InternalCostVendorView.tsx", import.meta.url), "utf8");

test("IC vendor view scales through searchable master-detail instead of one table per vendor", () => {
  assert.match(source, /Tìm NCC hoặc hạng mục/);
  assert.match(source, /Chi phí cao nhất/);
  assert.match(source, /Danh sách NCC trong IC/);
  assert.match(source, /NCC đang xem/);
  assert.match(source, /selectedGroup\.lines\.map/);
  assert.doesNotMatch(source, /groups\.map\([\s\S]*<Table/);
});

test("IC vendor view keeps approval-oriented totals and incomplete-data warnings", () => {
  assert.match(source, /Tổng Gross/);
  assert.match(source, /Tổng đang tạm tính/);
  assert.match(source, /Tổng chỉ cộng các dòng đã đủ dữ liệu giá/);
  assert.match(source, /không phải tiền đã chi/);
});
