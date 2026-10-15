import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { SignJWT } from "jose";
import { handleEvidenceRequest, type EvidenceGateway } from "../cloudflare/evidence-object";
import { buildExportSourceSeal, persistExportSourceSeal, type ExportSourceSealInput } from "../lib/costflow/exportSourceProjection";
import { deliverWorkflowNotifications, type WorkflowNotificationDeliveryStore } from "../lib/workflow/notificationDelivery";

const secret = "paired-save-test-secret-with-at-least-32-bytes";
const projectId = "project-1";

async function sessionCookie() {
  const token = await new SignJWT({ sessionVersion: 2 })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("account-1")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(secret));
  return `session=${token}`;
}

function saveRequest(form: FormData, cookie?: string, origin = "https://taskflow.example") {
  return new Request(`https://taskflow.example/api/projects/${projectId}/costflow/paired-save`, {
    method: "POST",
    headers: { ...(cookie ? { cookie } : {}), host: "taskflow.example", origin },
    body: form,
  });
}

test("paired save boundary is same-origin, session-bound and forwards only validated commands", async () => {
  const calls: unknown[] = [];
  const gateway: EvidenceGateway = {
    async findAuthorizedEvidence() { return null; },
    async savePaired(observedProjectId, session, version, form) {
      calls.push({ observedProjectId, session, version, command: form.get("command") });
      return { success: "saved", version: version + 1, draftId: "draft-1" };
    },
  };
  const form = new FormData();
  form.set("command", "SAVE_PAIRED_DRAFT");
  form.set("version", "4");
  assert.equal((await handleEvidenceRequest(saveRequest(form), secret, gateway)).status, 401);
  assert.equal((await handleEvidenceRequest(saveRequest(form, await sessionCookie(), "https://attacker.example"), secret, gateway)).status, 403);
  assert.equal(calls.length, 0);
  const response = await handleEvidenceRequest(saveRequest(form, await sessionCookie()), secret, gateway);
  assert.equal(response.status, 200);
  assert.deepEqual(calls, [{ observedProjectId: projectId, session: { userId: "account-1", sessionVersion: 2 }, version: 4, command: "SAVE_PAIRED_DRAFT" }]);
});

const sealInput: ExportSourceSealInput = {
  projectId,
  family: "QUOTATION",
  sourceKind: "QUOTATION",
  sourceId: "quotation-1",
  sourceVersion: 1,
  approvalAttemptId: "FINALIZE:quotation-1",
  approvedSnapshotId: null,
  signingState: "UNSIGNED",
  payload: { title: "Quote", privateIc: "MUST_NOT_LEAK", rows: [{ id: "line-1", name: "Line", vendorId: "PRIVATE" }] },
  lines: [{ id: "line-1", rawNet: "100.4", rawVat: "10.4", rawGross: "110.8", vatPercent: "10" }],
};

test("runtime-neutral export authority preserves allowlist, exact rounding, VAT assignment, SHA-256 and idempotent conflict checks", async () => {
  const first = await buildExportSourceSeal(sealInput);
  const second = await buildExportSourceSeal(sealInput);
  assert.equal(first.projectionHash, second.projectionHash);
  assert.match(first.projectionHash, /^[0-9a-f]{64}$/);
  assert.equal(first.roundingAdjustment, 1);
  assert.deepEqual(first.vatLineAssignment, { lineId: "line-1", adjustment: 1 });
  assert.equal(JSON.stringify(first.canonicalPayload).includes("MUST_NOT_LEAK"), false);
  assert.equal(JSON.stringify(first.canonicalPayload).includes("vendorId"), false);

  const exactRow = {
    dossierVersionId: null,
    authoritativeNet: first.totals.net,
    authoritativeVat: first.totals.vat,
    authoritativeGross: first.totals.gross,
    roundingAdjustment: first.roundingAdjustment,
    vatLineAssignment: first.vatLineAssignment,
    projectionHash: first.projectionHash,
    approvalAttemptId: sealInput.approvalAttemptId,
    approvedSnapshotId: null,
    signingState: sealInput.signingState,
    canonicalPayload: first.canonicalPayload,
  };
  await persistExportSourceSeal({ upsertExact: async () => exactRow }, sealInput);
  await assert.rejects(
    persistExportSourceSeal({ upsertExact: async () => ({ ...exactRow, projectionHash: "0".repeat(64) }) }, sealInput),
    /xung đột/,
  );
});

test("notification delivery remains idempotent and retryable behind a runtime-neutral post-commit boundary", async () => {
  const calls: string[] = [];
  const delivery = { id: "delivery-1", userId: "user-1", event: { id: "event-1", action: "SUBMIT", reason: null, request: { id: "request-1", projectId, title: "IC" } } };
  const store: WorkflowNotificationDeliveryStore = {
    pending: async requestId => { calls.push(`pending:${requestId}`); return [delivery]; },
    upsertNotification: async input => { calls.push(`upsert:${input.dedupeKey}`); },
    markDelivered: async id => { calls.push(`delivered:${id}`); },
    markRetry: async id => { calls.push(`retry:${id}`); },
  };
  await deliverWorkflowNotifications(store, "request-1");
  assert.deepEqual(calls, ["pending:request-1", "upsert:workflow:event-1:user-1", "delivered:delivery-1"]);

  calls.length = 0;
  store.upsertNotification = async () => { throw new Error("temporary"); };
  await deliverWorkflowNotifications(store, "request-1");
  assert.deepEqual(calls, ["pending:request-1", "retry:delivery-1"]);
});

test("production paired adapter keeps serializable auth, workspace lock, CAS/history, seal and notification after commit", async () => {
  const worker = await readFile(new URL("../cloudflare/evidence-object.ts", import.meta.url), "utf8");
  const editor = await readFile(new URL("../components/PairedQuotationIcEditor.tsx", import.meta.url), "utf8");
  const nextFallback = await readFile(new URL("../app/api/projects/[id]/costflow/paired-save/route.ts", import.meta.url), "utf8");
  assert.match(worker, /BEGIN ISOLATION LEVEL SERIALIZABLE/);
  assert.match(worker, /CostFlowWorkspace[^]*FOR UPDATE/);
  assert.match(worker, /WHERE "projectId" = \$2 AND "version" = \$3/);
  assert.match(worker, /INSERT INTO "CostFlowHistory"/);
  assert.match(worker, /persistExportSourceSeal/);
  assert.ok(worker.indexOf('client.query("COMMIT")') < worker.indexOf("deliverWorkflowNotifications(neonNotificationStore"));
  assert.match(editor, /costflow\/paired-save/);
  assert.match(editor, /credentials: "same-origin"/);
  assert.match(nextFallback, /sameOrigin\(request\)/);
  assert.match(nextFallback, /costFlowAction\(\{\}, form\)/);
  assert.match(nextFallback, /4\.2 \* 1024 \* 1024/);
});
