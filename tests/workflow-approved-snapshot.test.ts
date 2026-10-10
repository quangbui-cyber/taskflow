import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  attestApprovedProjection,
  buildApprovedProjection,
  computeApprovedProjectionSha256,
  verifyApprovedProjectionAttestation,
} from "../lib/workflow/approvedSnapshot";
import {
  assertSigningModeState,
  computeSigningEventHash,
  resolveSignerIp,
} from "../lib/workflow/signing";

const baseInput = {
  request: {
    id: "req-1",
    version: 7,
    module: "WORKFLOW",
    kind: "PROPOSAL_ADVANCE",
    creatorId: "creator-1",
    title: "Tạm ứng sản xuất",
    approvedAt: "2026-10-10T08:30:00.000Z",
  },
  template: { familyId: "advance", version: 3, name: "ĐNTU-CS.2026" },
  document: {
    purpose: "Chi phí triển khai",
    content: "Nội dung tờ trình",
    counterparty: "Nhà cung cấp A",
    beneficiary: "Nguyễn Văn A",
    bankAccount: "0123456789",
    bankName: "VCB",
    dueDate: "2026-10-20",
  },
  finance: {
    source: "COSTFLOW_APPROVED_SNAPSHOT",
    snapshotId: "finance-1",
    amount: "15000000",
    lines: [{ id: "line-1", description: "Thi công", amount: "15000000" }],
  },
  files: [
    { id: "file-b", kind: "SUPPORTING", name: "b.pdf", sha256: "b".repeat(64) },
    { id: "file-a", kind: "MAIN", name: "a.pdf", sha256: "a".repeat(64) },
  ],
  decisions: [
    { step: 2, role: "ACCOUNTANT", actorId: "accountant", action: "APPROVE", decidedAt: "2026-10-10T08:20:00.000Z" },
    { step: 1, role: "MANAGER", actorId: "manager", action: "APPROVE", decidedAt: "2026-10-10T08:10:00.000Z" },
  ],
  signatures: [
    { role: "CREATOR", actorId: "creator-1", signedAt: "2026-10-10T08:00:00.000Z", imageSha256: "1".repeat(64), eventHash: "2".repeat(64) },
    { role: "MANAGER", actorId: "manager", signedAt: "2026-10-10T08:10:00.000Z", imageSha256: "3".repeat(64), eventHash: "4".repeat(64) },
    { role: "ACCOUNTANT", actorId: "accountant", signedAt: "2026-10-10T08:20:00.000Z", imageSha256: "5".repeat(64), eventHash: "6".repeat(64) },
    { role: "CEO", actorId: "ceo", signedAt: "2026-10-10T08:30:00.000Z", imageSha256: "7".repeat(64), eventHash: "8".repeat(64) },
  ],
} as const;

test("approved projection is canonical and any material drift changes SHA-256", () => {
  const projection = buildApprovedProjection(baseInput);
  assert.deepEqual(projection.files.map((file) => file.id), ["file-a", "file-b"]);
  assert.deepEqual(projection.decisions.map((decision) => decision.step), [1, 2]);
  const digest = computeApprovedProjectionSha256(projection);
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.notEqual(
    computeApprovedProjectionSha256(buildApprovedProjection({
      ...baseInput,
      document: { ...baseInput.document, content: `${baseInput.document.content}!` },
    })),
    digest
  );
  assert.notEqual(
    computeApprovedProjectionSha256(buildApprovedProjection({
      ...baseInput,
      finance: { ...baseInput.finance, amount: "15000001" },
    })),
    digest
  );
  assert.notEqual(
    computeApprovedProjectionSha256(buildApprovedProjection({
      ...baseInput,
      files: [{ ...baseInput.files[0], sha256: "c".repeat(64) }, baseInput.files[1]],
    })),
    digest
  );
});

test("issuer attestation is versioned HMAC and fails closed without its dedicated key", () => {
  const previous = process.env.DOCUMENT_ATTESTATION_KEY_V1;
  delete process.env.DOCUMENT_ATTESTATION_KEY_V1;
  try {
    assert.throws(() => attestApprovedProjection(buildApprovedProjection(baseInput)), /DOCUMENT_ATTESTATION_KEY_V1/);
    process.env.DOCUMENT_ATTESTATION_KEY_V1 = "phase9-local-test-only-key-change-me";
    const projection = buildApprovedProjection(baseInput);
    const attested = attestApprovedProjection(projection);
    assert.equal(attested.keyId, "v1");
    assert.equal(verifyApprovedProjectionAttestation(projection, attested), true);
    assert.equal(
      verifyApprovedProjectionAttestation(
        buildApprovedProjection({ ...baseInput, document: { ...baseInput.document, purpose: "Changed" } }),
        attested
      ),
      false
    );
  } finally {
    if (previous === undefined) delete process.env.DOCUMENT_ATTESTATION_KEY_V1;
    else process.env.DOCUMENT_ATTESTATION_KEY_V1 = previous;
  }
});

test("signer IP audit normalizes direct/trusted proxy sources and never returns raw headers", () => {
  assert.deepEqual(resolveSignerIp({ directPeer: "[2001:DB8::1]:443", forwardedFor: null, trustedProxies: [] }), {
    signerIpNormalized: "2001:db8::1",
    signerIpSource: "DIRECT",
  });
  assert.deepEqual(resolveSignerIp({ directPeer: "10.0.0.2", forwardedFor: "203.0.113.9, 10.0.0.1", trustedProxies: ["10.0.0.2", "10.0.0.1"] }), {
    signerIpNormalized: "203.0.113.9",
    signerIpSource: "TRUSTED_PROXY",
  });
  assert.deepEqual(resolveSignerIp({ directPeer: "bad", forwardedFor: "raw-secret", trustedProxies: [] }), {
    signerIpNormalized: null,
    signerIpSource: "UNAVAILABLE",
  });
});

test("schema persists one signing mode, distinct evidence states and idempotency constraints", async () => {
  const schema = await readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
  assert.match(schema, /model WorkflowApprovedSnapshot \{/);
  assert.match(schema, /model WorkflowSigningEvent \{/);
  assert.match(schema, /model WorkflowSigningLifecycle \{/);
  assert.match(schema, /model WorkflowSigningCommand \{/);
  assert.match(schema, /@@unique\(\[requestId, version, role\]\)/);
  assert.match(schema, /@@unique\(\[requestId, commandKey\]\)/);
  assert.match(schema, /signerIpNormalized\s+String\?/);
  assert.match(schema, /signerIpSource\s+String/);
  assert.doesNotMatch(schema, /rawForwarded|rawIpHeader/);
});

test("digital and physical evidence states cannot form a hybrid lifecycle", () => {
  assert.doesNotThrow(() => assertSigningModeState("DIGITAL", "CHO_KY"));
  assert.doesNotThrow(() => assertSigningModeState("PHYSICAL", "RETURNED"));
  assert.throws(() => assertSigningModeState("DIGITAL", "PHYSICAL_CONFIRMED"), /chế độ ký/);
  assert.throws(() => assertSigningModeState("PHYSICAL", "DIGITAL_CONFIRMED"), /chế độ ký/);
  const event = {
    snapshotSha256: "a".repeat(64), role: "MANAGER", actorId: "manager",
    imageSha256: "b".repeat(64), signedAt: "2026-10-10T08:10:00.000Z", previousEventHash: null,
  };
  assert.notEqual(computeSigningEventHash(event), computeSigningEventHash({ ...event, imageSha256: "c".repeat(64) }));
});

test("Phase 9 installs no automatic purge or invented signing-retention duration", async () => {
  const signing = await readFile(new URL("../lib/workflow/signing.ts", import.meta.url), "utf8");
  assert.doesNotMatch(signing, /deleteMany|purge|retentionDays|setInterval/);
});
