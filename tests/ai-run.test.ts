import assert from "node:assert/strict";
import test from "node:test";

import {
  AiSourceNotFoundError,
  parseAiSourceSelection,
  resolveAiReadScope,
} from "../lib/ai/access/resolveAiReadScope";
import { snapshotSelectedAiSources } from "../lib/ai/sources/sourceRevisions";

test("selected AI sources reject empty, duplicate and unsupported references", () => {
  assert.throws(() => parseAiSourceSelection([]));
  assert.throws(() => parseAiSourceSelection(["PROJECT_FILE:a", "PROJECT_FILE:a"]));
  assert.throws(() => parseAiSourceSelection(["PROJECT_FILE:a", "PROJECT_FILE:b"]));
  assert.throws(() => parseAiSourceSelection(["UNKNOWN:a"]));
  assert.deepEqual(parseAiSourceSelection(["PROJECT_FILE:a"]), [
    { kind: "PROJECT_FILE", id: "a" },
  ]);
});

test("authorization rejects foreign and missing source before reading bytes", async () => {
  let byteReads = 0;
  const reader = {
    actor: async () => ({ id: "actor", role: "ACCOUNT", isActive: true }),
    project: async () => ({ id: "project", ownerId: "owner", memberIds: ["actor"] }),
    source: async () => null,
    bytes: async () => { byteReads++; return new Uint8Array([1]); },
  };
  await assert.rejects(
    () => resolveAiReadScope("actor", { projectId: "project", sourceIds: ["PROJECT_FILE:foreign"], purpose: "DOCUMENT_EXTRACTION" }, reader),
    AiSourceNotFoundError,
  );
  assert.equal(byteReads, 0);
});

test("scope hash changes with visibility and invoice pair requires one business identity", async () => {
  let memberIds = ["actor"];
  const metadata = (id: string) => ({
    kind: "VENDOR_INVOICE_FILE" as const, id, projectId: "project", name: `${id}.pdf`,
    mimeType: id === "xml" ? "application/xml" : "application/pdf",
    version: "a".repeat(64), authorityStatus: "CONFIRMED", immutable: true,
    businessKey: id === "wrong" ? "different-invoice" : "invoice-1",
  });
  const reader = {
    actor: async () => ({ id: "actor", role: "ACCOUNT", isActive: true }),
    project: async () => ({ id: "project", ownerId: "owner", memberIds }),
    source: async (ref: { id: string }) => metadata(ref.id),
  };
  const input = { projectId: "project", sourceIds: ["VENDOR_INVOICE_FILE:xml", "VENDOR_INVOICE_FILE:pdf"], purpose: "DOCUMENT_EXTRACTION" };
  const first = await resolveAiReadScope("actor", input, reader);
  memberIds = ["actor", "other"];
  const changed = await resolveAiReadScope("actor", input, reader);
  assert.notEqual(first.scopeHash, changed.scopeHash);
  await assert.rejects(
    () => resolveAiReadScope("actor", { ...input, sourceIds: ["VENDOR_INVOICE_FILE:xml", "VENDOR_INVOICE_FILE:wrong"] }, reader),
    AiSourceNotFoundError,
  );
});

test("same filename with changed bytes creates a different revision", async () => {
  const origin = {
    kind: "PROJECT_FILE" as const, id: "file", projectId: "project", name: "po.pdf",
    mimeType: "application/pdf", version: "1", authorityStatus: "DRAFT",
    immutable: false, businessKey: null,
  };
  const revisions = new Map<string, { id: string; sha256: string }>();
  let bytes = new Uint8Array([1]);
  const store = {
    readBytes: async () => bytes,
    findRevision: async (_kind: string, _id: string, _version: string, sha256: string) => revisions.get(sha256) ?? null,
    createRevision: async (input: { sha256: string }) => {
      const revision = { id: `revision-${revisions.size}`, sha256: input.sha256 };
      revisions.set(input.sha256, revision);
      return revision;
    },
  };
  const first = await snapshotSelectedAiSources("actor", [origin], store);
  const repeated = await snapshotSelectedAiSources("actor", [origin], store);
  assert.equal(first[0].id, repeated[0].id);
  bytes = new Uint8Array([2]);
  const changed = await snapshotSelectedAiSources("actor", [origin], store);
  assert.notEqual(changed[0].id, first[0].id);
});
