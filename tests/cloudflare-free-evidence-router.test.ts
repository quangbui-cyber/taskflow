import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { performance } from "node:perf_hooks";
import { SignJWT } from "jose";
import {
  canReadEvidence,
  handleEvidenceRequest,
  type EvidenceGateway,
} from "../cloudflare/evidence-object";
import { createFreeRouter, type FreeRouterEnv } from "../cloudflare/free-router";

const secret = "test-only-session-secret-with-at-least-32-bytes";
const projectId = "project-1";
const evidenceId = "evidence-1";

async function cookie(userId = "user-1", sessionVersion = 3) {
  const token = await new SignJWT({ sessionVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(secret));
  return `session=${token}`;
}

function request(path: string, sessionCookie?: string) {
  return new Request(`https://taskflow.example${path}`, {
    headers: sessionCookie ? { cookie: sessionCookie } : undefined,
  });
}

test("native evidence boundary preserves fail-closed auth and preview headers", async () => {
  let observedSession: unknown;
  const gateway: EvidenceGateway = {
    async findAuthorizedEvidence(observedProjectId, observedEvidenceId, session) {
      observedSession = session;
      assert.equal(observedProjectId, projectId);
      assert.equal(observedEvidenceId, evidenceId);
      return {
        id: evidenceId,
        name: "hồ sơ.pdf",
        mimeType: "application/pdf",
        data: new TextEncoder().encode("%PDF-test"),
      };
    },
  };

  const unauthorized = await handleEvidenceRequest(
    request(`/api/projects/${projectId}/costflow/evidence/${evidenceId}/preview`),
    secret,
    gateway,
  );
  assert.equal(unauthorized.status, 404);
  assert.equal(observedSession, undefined, "invalid sessions must not reach Neon");

  const response = await handleEvidenceRequest(
    request(`/api/projects/${projectId}/costflow/evidence/${evidenceId}/preview`, await cookie()),
    secret,
    gateway,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(observedSession, { userId: "user-1", sessionVersion: 3 });
  assert.equal(response.headers.get("content-type"), "application/pdf");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "SAMEORIGIN");
  assert.match(response.headers.get("content-security-policy") ?? "", /frame-ancestors 'self'/);
  assert.match(response.headers.get("content-disposition") ?? "", /^inline;/);
  assert.equal(await response.text(), "%PDF-test");
});

test("authorization predicate matches the existing member, DD, admin, request and step grants", () => {
  const base = {
    id: evidenceId,
    name: "proof.pdf",
    mimeType: "application/pdf",
    data: new Uint8Array(),
    role: "USER",
    member: false,
    dd: false,
    creatorId: null,
    cashAssigneeId: null,
    reader: false,
    steps: [],
  };
  assert.equal(canReadEvidence({ ...base, member: true }, "actor"), true);
  assert.equal(canReadEvidence({ ...base, dd: true }, "actor"), true);
  assert.equal(canReadEvidence({ ...base, role: "ADMIN" }, "actor"), true);
  assert.equal(canReadEvidence({ ...base, creatorId: "actor" }, "actor"), true);
  assert.equal(canReadEvidence({ ...base, cashAssigneeId: "actor" }, "actor"), true);
  assert.equal(canReadEvidence({ ...base, reader: true }, "actor"), true);
  assert.equal(canReadEvidence({ ...base, steps: [{ assigneeId: "actor" }] }, "actor"), true);
  assert.equal(canReadEvidence(base, "actor"), false);
});

test("thin ingress dispatches evidence GETs to a project object and everything else to legacy", async () => {
  const calls: string[] = [];
  const env = {
    EVIDENCE_OBJECTS: {
      idFromName(name: string) { calls.push(`id:${name}`); return name; },
      get(id: unknown) {
        calls.push(`get:${String(id)}`);
        return { async fetch() { calls.push("evidence"); return new Response("evidence"); } };
      },
    },
    LEGACY: { async fetch() { calls.push("legacy"); return new Response("legacy"); } },
  } satisfies FreeRouterEnv;
  const router = createFreeRouter(env);
  assert.equal(await (await router.fetch(request(`/api/projects/${projectId}/costflow/evidence/${evidenceId}`))).text(), "evidence");
  assert.equal(await (await router.fetch(new Request(`https://taskflow.example/api/projects/${projectId}/costflow/evidence/upload`, { method: "POST" }))).text(), "evidence");
  assert.equal(await (await router.fetch(request(`/api/projects/${projectId}/costflow/paired-data`))).text(), "evidence");
  assert.equal(await (await router.fetch(new Request(`https://taskflow.example/api/projects/${projectId}/costflow/paired-save`, { method: "POST" }))).text(), "evidence");
  assert.equal(await (await router.fetch(request(`/projects/${projectId}/costflow/paired`))).text(), "legacy");
  assert.deepEqual(calls, [
    `id:${projectId}`, `get:${projectId}`, "evidence",
    `id:${projectId}`, `get:${projectId}`, "evidence",
    `id:${projectId}`, `get:${projectId}`, "evidence",
    `id:${projectId}`, `get:${projectId}`, "evidence",
    "legacy",
  ]);
});

test("paired read foundation keeps session and route selection server-side", async () => {
  const calls: unknown[] = [];
  const gateway: EvidenceGateway = {
    async findAuthorizedEvidence() { return null; },
    async loadPaired(observedProjectId, session, params) {
      calls.push({ observedProjectId, session, params });
      return { finance: { project: { id: observedProjectId }, fullAccess: true }, resolvedQuotationId: params.quotationId };
    },
  };
  const response = await handleEvidenceRequest(
    request(`/api/projects/${projectId}/costflow/paired-data?quotationId=q-1&draftId=d-1`, await cookie()),
    secret,
    gateway,
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(calls, [{
    observedProjectId: projectId,
    session: { userId: "user-1", sessionVersion: 3 },
    params: { quotationId: "q-1", draftId: "d-1", revisionId: undefined },
  }]);
  const denied = await handleEvidenceRequest(
    request(`/api/projects/${projectId}/costflow/paired-data`),
    secret,
    gateway,
  );
  assert.equal(denied.status, 404);
  assert.equal(calls.length, 1);
});

test("upload boundary rejects cross-origin requests and forwards validated IC and AC commands server-side", async () => {
  const commands: unknown[] = [];
  const gateway: EvidenceGateway = {
    async findAuthorizedEvidence() { return null; },
    async uploadEvidence(command, session) {
      commands.push({ command, session });
      return command.lineId ? { lineId: command.lineId, version: (command.expectedVersion ?? 0) + 1, evidence: [] } : { evidence: { id: "new" } };
    },
  };
  const sessionCookie = await cookie();
  const makeUpload = (form: FormData, origin = "https://taskflow.example") => new Request(
    `https://taskflow.example/api/projects/${projectId}/costflow/evidence/upload`,
    { method: "POST", headers: { cookie: sessionCookie, host: "taskflow.example", origin }, body: form },
  );

  const rejectedForm = new FormData();
  rejectedForm.set("proof", new File(["proof"], "proof.pdf", { type: "application/pdf" }));
  const anonymous = await handleEvidenceRequest(makeUpload(rejectedForm), "wrong-secret", gateway);
  assert.equal(anonymous.status, 401);
  assert.equal(commands.length, 0);
  const rejected = await handleEvidenceRequest(makeUpload(rejectedForm, "https://attacker.example"), secret, gateway);
  assert.equal(rejected.status, 403);
  assert.equal(commands.length, 0);

  const icForm = new FormData();
  icForm.set("proof", new File(["proof"], "../IC\u0000 proof.pdf", { type: "application/pdf" }));
  const ic = await handleEvidenceRequest(makeUpload(icForm), secret, gateway);
  assert.equal(ic.status, 201);

  const acForm = new FormData();
  acForm.set("lineId", "line-1");
  acForm.set("version", "4");
  acForm.set("kind", "VAT_INVOICE");
  acForm.append("proof", new File(["invoice"], "invoice.pdf", { type: "application/pdf" }));
  acForm.append("proof", new File(["photo"], "photo.png", { type: "image/png" }));
  const ac = await handleEvidenceRequest(makeUpload(acForm), secret, gateway);
  assert.equal(ac.status, 201);
  assert.deepEqual(commands, [
    {
      command: {
        projectId,
        sourceFileId: "",
        lineId: "",
        expectedVersion: null,
        kind: "",
        files: [{ name: ".. IC proof.pdf", mimeType: "application/pdf", size: 5, data: new TextEncoder().encode("proof") }],
      },
      session: { userId: "user-1", sessionVersion: 3 },
    },
    {
      command: {
        projectId,
        sourceFileId: "",
        lineId: "line-1",
        expectedVersion: 4,
        kind: "VAT_INVOICE",
        files: [
          { name: "invoice.pdf", mimeType: "application/pdf", size: 7, data: new TextEncoder().encode("invoice") },
          { name: "photo.png", mimeType: "image/png", size: 5, data: new TextEncoder().encode("photo") },
        ],
      },
      session: { userId: "user-1", sessionVersion: 3 },
    },
  ]);
});

test("production upload gateway retains serializable AC CAS and server-side SHA-256 contracts", async () => {
  const source = await readFile(new URL("../cloudflare/evidence-object.ts", import.meta.url), "utf8");
  assert.match(source, /BEGIN ISOLATION LEVEL SERIALIZABLE/);
  assert.match(source, /crypto\.subtle\.digest\("SHA-256"/);
  assert.match(source, /"currentVersion" = \$1/);
  assert.match(source, /"currentVersion" = \$4/);
  assert.match(source, /wr\."state" NOT IN \('WITHDRAWN','REJECTED','CANCELLED'\)/);
  assert.match(source, /u\."sessionVersion" = \$3/);
});

test("thin ingress has no Next, Prisma or database import and stays below the local 10 ms risk contract", async t => {
  const source = await readFile(new URL("../cloudflare/free-router.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /from ["']next(?:\/|["'])/);
  assert.doesNotMatch(source, /@prisma|lib\/prisma|@neondatabase|jose/);

  const env = {
    EVIDENCE_OBJECTS: {
      idFromName(name: string) { return name; },
      get() { return { async fetch() { return new Response(null, { status: 204 }); } }; },
    },
    LEGACY: { async fetch() { return new Response(null, { status: 204 }); } },
  } satisfies FreeRouterEnv;
  const router = createFreeRouter(env);
  const target = request(`/api/projects/${projectId}/costflow/evidence/${evidenceId}`);
  for (let index = 0; index < 50; index += 1) await router.fetch(target.clone());
  const samples: number[] = [];
  for (let index = 0; index < 500; index += 1) {
    const started = performance.now();
    await router.fetch(target.clone());
    samples.push(performance.now() - started);
  }
  samples.sort((left, right) => left - right);
  const p95 = samples[Math.floor(samples.length * 0.95)];
  t.diagnostic(`local thin-ingress p95=${p95.toFixed(3)} ms across ${samples.length} requests`);
  assert.ok(p95 < 10, `local thin-ingress p95 ${p95.toFixed(3)} ms must remain below the Free request ceiling`);
});
