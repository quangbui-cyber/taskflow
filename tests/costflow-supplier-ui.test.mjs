import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = file => readFileSync(path.join(root, file), "utf8");

test("company supplier directory is discoverable and reports truthful verification states", () => {
  const page = source("app/suppliers/page.tsx");
  const sidebar = source("components/Sidebar.tsx");
  const directory = source("components/costflow/suppliers/SupplierDirectory.tsx");
  const editor = source("components/costflow/suppliers/SupplierEditor.tsx");
  assert.match(page, /listCompanySuppliers/);
  assert.match(sidebar, /href="\/suppliers"/);
  assert.match(directory, /Tìm nhà cung cấp/);
  assert.match(directory, /Chưa xác minh|Đã xác minh|Bị từ chối/);
  assert.match(directory, /API ngân hàng[^<]*chưa tích hợp/i);
  assert.match(editor, /supplierAction/);
  assert.match(editor, /Lý do thay đổi/);
  assert.doesNotMatch(directory, /tự động xác minh/i);
});

test("shared picker defaults primary account and exposes account choice only when needed", () => {
  const picker = source("components/costflow/suppliers/SupplierPicker.tsx");
  assert.match(picker, /isPrimary/);
  assert.match(picker, /accounts\.length > 1/);
  assert.match(picker, /label="Nhà cung cấp"/);
  assert.match(picker, /label="Tài khoản ngân hàng"/);
  assert.match(picker, /recipientKey/);
});

test("approval workspace links to the shared directory instead of opening a project-local supplier editor", () => {
  const approvals = source("components/ApprovalRequestsPanel.tsx");
  assert.match(approvals, /href="\/suppliers"/);
  const supplierLink = approvals.match(/<Link href="\/suppliers"[\s\S]{0,500}Danh bạ NCC[\s\S]{0,100}<\/Link>/);
  assert.ok(supplierLink, "shared supplier directory must be a link in the approval header");
});
