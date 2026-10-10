import test from "node:test";
import assert from "node:assert/strict";
import {
  WORKFLOW_HUB_HREF,
  workflowDocumentHref,
  workflowPrintHref,
  workflowProjectApprovalHref,
  workflowRequestHref,
  workflowVerifyHref,
} from "../lib/workflow/routes";

test("workflow routes: the shared dossier and approval hub is canonical", () => {
  assert.equal(WORKFLOW_HUB_HREF, "/workflow");
  assert.equal(workflowDocumentHref("wf-01"), "/workflow/wf-01");
});

test("workflow routes: Workflow dossiers open detail/print while public verification uses a separate capability", () => {
  const request = { id: "wf 01", module: "WORKFLOW", projectId: null };
  assert.equal(workflowRequestHref(request), "/workflow/wf%2001");
  assert.equal(workflowPrintHref(request.id), "/workflow/wf%2001/print");
  assert.equal(workflowVerifyHref("opaque token"), "/workflow/verify/opaque%20token");
});

test("workflow routes: CostFlow dossiers return to their project approval tab and exact request", () => {
  const request = { id: "cost-01", module: "COSTFLOW", projectId: "project 01" };
  assert.equal(
    workflowRequestHref(request),
    "/projects/project%2001/costflow?tab=approvals#request-cost-01",
  );
  assert.equal(
    workflowProjectApprovalHref("project 01"),
    "/projects/project%2001/costflow?tab=approvals",
  );
});

test("workflow routes: malformed CostFlow summaries fail closed to the Workflow detail route", () => {
  assert.equal(
    workflowRequestHref({ id: "orphan", module: "COSTFLOW", projectId: null }),
    "/workflow/orphan",
  );
});
