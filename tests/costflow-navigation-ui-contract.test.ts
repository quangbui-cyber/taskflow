import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("FinancialLifecycleBar: exposes 5 sequential stages and stage indicators", () => {
  const code = source("components/costflow/navigation/FinancialLifecycleBar.tsx");

  // Verifies the 5 financial stages
  assert.match(code, /"Báo giá & Scope"/, "Must have stage 1 Báo giá & Scope");
  assert.match(code, /"Dự toán IC"/, "Must have stage 2 Dự toán IC");
  assert.match(code, /"Tạm ứng & Hồ sơ"/, "Must have stage 3 Tạm ứng & Hồ sơ");
  assert.match(code, /"Chi phí thực tế \(AC\)"/, "Must have stage 4 Chi phí thực tế (AC)");
  assert.match(code, /"Quyết toán & Đóng"/, "Must have stage 5 Quyết toán & Đóng");

  // Verifies interactive switching
  assert.match(code, /onSelectTab\(stage\.id\)/, "Must allow user to switch tab on click");
  assert.match(code, /tf-lifecycle-steps/, "Must render accessible ordered list of steps");
  assert.match(code, /currentProjectStageIndex/, "Must calculate active organizational stage");
});

test("CostFlowActionBanner: role-aware smart next action guidance", () => {
  const code = source("components/costflow/navigation/CostFlowActionBanner.tsx");

  // Prioritizes approval actions for reviewer
  assert.match(code, /myPendingRequests/, "Must detect pending approvals for current user");
  assert.match(code, /Bạn có.*hồ sơ đang chờ phê duyệt/, "Must present urgent approval alert");

  // Prioritizes returned requests for creator
  assert.match(code, /myReturnedRequests/, "Must detect returned requests");

  // Onboarding & Lifecycle stages
  assert.match(code, /Khởi tạo Báo giá đầu tiên/, "Must guide to step 1 when no quotations");
  assert.match(code, /Lập dự toán chi phí nội bộ \(IC\)/, "Must guide to step 2 when quotation exists");
  assert.match(code, /khoản chi thực tế \(AC\) chưa đủ hóa đơn/, "Must warn about missing evidence");
  assert.match(code, /Dự án đã đủ điều kiện lập Quyết toán/, "Must guide to settlement when ready");
  assert.match(code, /Dự án đã đóng tài chính/, "Must show completion when closed");
});

test("CostFlowPanel: mounts FinancialLifecycleBar and CostFlowActionBanner", () => {
  const code = source("components/CostFlowPanel.tsx");

  assert.match(code, /import FinancialLifecycleBar from/, "Must import FinancialLifecycleBar");
  assert.match(code, /import CostFlowActionBanner from/, "Must import CostFlowActionBanner");
  assert.match(code, /<FinancialLifecycleBar/, "Must render FinancialLifecycleBar");
  assert.match(code, /<CostFlowActionBanner/, "Must render CostFlowActionBanner on overview");
});

test("CostFlowPanel: Sprint 2 UX - Scope sub-views, dual-labeling and prioritized approvals badge", () => {
  const code = source("components/CostFlowPanel.tsx");

  // Scope sub-navigation
  assert.match(code, /scopeSubTab/, "Must have scopeSubTab state");
  assert.match(code, /Báo giá & Căn cứ/, "Must offer Báo giá sub-tab");
  assert.match(code, /Nghiệm thu khối lượng/, "Must offer Nghiệm thu sub-tab");
  assert.match(code, /Thanh lý & Công nợ AR/, "Must offer Thanh lý sub-tab");

  // Dual labeling on Overview
  assert.match(code, /Báo giá hiện hành \(Bán\)/, "Must dual-label quotation");
  assert.match(code, /Dự toán IC \(Ngân sách mua\)/, "Must dual-label IC");
  assert.match(code, /Chi phí thực tế AC \(Phát sinh\)/, "Must dual-label AC");
  assert.match(code, /Dòng tiền thực tế \(Thu \/ Chi\)/, "Must dual-label cash");

  // Prioritized approvals badge
  assert.match(code, /myActionCount/, "Must calculate pending approvals for current user");
  assert.match(code, /myActionCount > 0 \? myActionCount : pendingRequests/, "Must prioritize myActionCount for approvals badge");
});

test("CostFlow navigation: reveals active destinations inside horizontal scrollers", () => {
  const moduleTabs = source("components/ui/ModuleUI.tsx");
  const lifecycle = source("components/costflow/navigation/FinancialLifecycleBar.tsx");
  const styles = source("app/modules.css");

  assert.match(moduleTabs, /navRef/, "Module tabs must retain their horizontal scroller");
  assert.match(moduleTabs, /button\[aria-pressed="true"\]/, "Module tabs must locate the active destination");
  assert.match(moduleTabs, /scroller\.scrollTo/, "Module tabs must reveal an off-screen active destination");
  assert.match(lifecycle, /lifecycleBarRef/, "Lifecycle must retain its horizontal scroller");
  assert.match(lifecycle, /data-stage-id/, "Lifecycle stages must expose stable reveal targets");
  assert.match(lifecycle, /scroller\.scrollTo/, "Lifecycle must reveal the selected or current stage");
  assert.match(styles, /\.tf-module-tabs::\-webkit-scrollbar/, "Module tabs must expose a horizontal scroll affordance");
  assert.match(styles, /\.tf-lifecycle-bar::\-webkit-scrollbar/, "Lifecycle must expose a horizontal scroll affordance");
  assert.match(styles, /overscroll-behavior-inline:\s*contain/, "Horizontal navigation must contain touch overscroll");
});
