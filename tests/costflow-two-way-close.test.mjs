import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  closeProjectRequest,
  decideFinancialClose,
  twoWayCloseBlockers,
} from "../lib/costflow/reconciliation.ts";

const ready = {
  dossier: { id: "dossier-1", versionId: "version-1", state: "APPROVED", sourceCount: 2, lockCount: 2 },
  obligations: [
    { recipientKey: "USER:account", amountDue: "100", allocatedAmount: "100", everyCashHasEvidence: true },
  ],
  customerAccounting: {
    currentLiquidation: { id: "liquidation-1", documentNumber: "TL-01", signedAt: "2026-10-11", evidence: { id: "liquidation-file" } },
    receivable: { outstandingGross: "0" },
  },
};

test("two-way close: every internal and customer prerequisite blocks independently", () => {
  assert.deepEqual(twoWayCloseBlockers(ready), []);
  assert.match(twoWayCloseBlockers({ ...ready, dossier: null }).join(" "), /hồ sơ quyết toán|dossier/i);
  assert.match(twoWayCloseBlockers({ ...ready, dossier: { ...ready.dossier, lockCount: 1 } }).join(" "), /khóa|lock/i);
  assert.match(twoWayCloseBlockers({ ...ready, obligations: [{ ...ready.obligations[0], allocatedAmount: "40" }] }).join(" "), /công nợ|chưa thực hiện đủ|balance/i);
  assert.match(twoWayCloseBlockers({ ...ready, obligations: [{ ...ready.obligations[0], everyCashHasEvidence: false }] }).join(" "), /chứng từ/i);
  assert.match(twoWayCloseBlockers({ ...ready, customerAccounting: { ...ready.customerAccounting, currentLiquidation: null } }).join(" "), /thanh lý/i);
  assert.match(twoWayCloseBlockers({ ...ready, customerAccounting: { ...ready.customerAccounting, receivable: { outstandingGross: "1" } } }).join(" "), /khách hàng|AR/i);
});

test("two-way close: customer money never replaces approved AC, settlement locks, or internal cash", () => {
  const richCustomer = {
    currentLiquidation: { id: "liquidation-rich", documentNumber: "TL-RICH", signedAt: "2026-10-11", evidence: { id: "file-rich" }, grossAmount: "999999999999" },
    receivable: { outstandingGross: "0", collectedGross: "999999999999" },
  };
  const blockers = twoWayCloseBlockers({ ...ready, dossier: null, obligations: [{ ...ready.obligations[0], allocatedAmount: "0" }], customerAccounting: richCustomer });
  assert.match(blockers.join(" "), /hồ sơ quyết toán|dossier/i);
  assert.match(blockers.join(" "), /công nợ|chưa thực hiện đủ|balance/i);
});

test("financial close: confirmed project employee or Account requests with reason and immutable expected version", () => {
  for (const requester of [
    { id: "employee", role: "USER", isProjectMember: true, isProjectOwner: false },
    { id: "account", role: "ACCOUNT", isProjectMember: false, isProjectOwner: true },
  ]) {
    const request = closeProjectRequest({
      projectId: "project-1",
      dossierId: "dossier-1",
      kind: "CLOSE",
      reason: "Đã đối soát xong",
      requester,
      expectedVersion: 7,
      financialCloseState: "OPEN",
    });
    assert.equal(request.expectedVersion, 7);
    assert.equal(request.requesterRole, requester.role);
    assert.equal(request.events[0].decision, "REQUESTED");
  }
  assert.throws(() => closeProjectRequest({ projectId: "project-1", dossierId: "dossier-1", kind: "CLOSE", reason: "x", requester: { id: "outsider", role: "USER", isProjectMember: false, isProjectOwner: false }, expectedVersion: 7, financialCloseState: "OPEN" }), /nhân sự|Account|Project/i);
  assert.throws(() => closeProjectRequest({ projectId: "project-1", dossierId: "dossier-1", kind: "CLOSE", reason: "", requester: { id: "account", role: "ACCOUNT", isProjectMember: true, isProjectOwner: true }, expectedVersion: 7, financialCloseState: "OPEN" }), /lý do/i);
});

test("financial close: only the assigned Manager decides and blockers are rechecked", () => {
  const request = closeProjectRequest({ projectId: "project-1", dossierId: "dossier-1", kind: "CLOSE", reason: "Đóng", requester: { id: "account", role: "ACCOUNT", isProjectMember: true, isProjectOwner: true }, expectedVersion: 7, financialCloseState: "OPEN" });
  assert.throws(() => decideFinancialClose(request, { actorId: "other-manager", assignedManagerId: "manager", decision: "APPROVE", reason: "ok", currentVersion: 7, currentCloseState: "OPEN", blockers: [] }), /Quản lý.*phân công|assigned Manager/i);
  assert.throws(() => decideFinancialClose(request, { actorId: "manager", assignedManagerId: "manager", decision: "APPROVE", reason: "ok", currentVersion: 7, currentCloseState: "OPEN", blockers: ["AR còn nợ"] }), /AR còn nợ/);
  const approved = decideFinancialClose(request, { actorId: "manager", assignedManagerId: "manager", decision: "APPROVE", reason: "Đủ điều kiện", currentVersion: 7, currentCloseState: "OPEN", blockers: [] });
  assert.equal(approved.financialCloseState, "CLOSED");
  assert.equal(approved.events.at(-1).decision, "APPROVE");
});

test("financial close stays independent from dossier approval, signatures, and Task DONE", () => {
  const axes = { financialCloseState: "OPEN", dossierApproval: "APPROVED", signing: "CONFIRMED", task: "DONE" };
  assert.equal(axes.financialCloseState, "OPEN");
  assert.notEqual(axes.dossierApproval, axes.financialCloseState);
  assert.notEqual(axes.signing, axes.financialCloseState);
  assert.notEqual(axes.task, axes.financialCloseState);
});

test("financial close integration re-evaluates server blockers in the transaction and closes only CostFlow", () => {
  const service = readFileSync(new URL("../lib/costflow/service.ts", import.meta.url), "utf8");
  const actions = readFileSync(new URL("../app/actions/costflow.ts", import.meta.url), "utf8");
  assert.match(service, /prisma\.\$transaction\([\s\S]*DECIDE_FINANCIAL_CLOSE[\s\S]*currentTwoWayCloseInput\(tx, projectId\)[\s\S]*decideFinancialClose/);
  assert.match(service, /financialCloseEvent\.create/);
  assert.match(service, /data\.closed\s*=\s*next\.financialCloseState/);
  assert.doesNotMatch(service, /request\.kind === "CLOSE"\)\s*\{\s*assertClose\(\);\s*data\.closed = true/);
  assert.match(actions, /assertCostFlowMutationAllowed\(projectId, action\)/);
  assert.match(actions, /assertCostFlowMutationAllowed\(projectId, command\)/);
  assert.doesNotMatch(actions, /Task|Kanban/);
});
