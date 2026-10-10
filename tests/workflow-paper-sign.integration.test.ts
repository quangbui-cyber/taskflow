import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import type { ProjectUpload } from "../lib/projectFiles";
import { assertSigningModeState } from "../lib/workflow/signing";
import { normalizeArchiveText, validatePhysicalScanBatch } from "../lib/workflow/lifecycle";

const upload = (mimeType: string, data: number[], size = data.length): ProjectUpload => ({ name: `scan.${mimeType === "application/pdf" ? "pdf" : "bin"}`, mimeType, size, data: Uint8Array.from(data) });

test("physical scan batch accepts only PDF/JPEG/PNG magic bytes", () => {
  assert.doesNotThrow(() => validatePhysicalScanBatch([upload("application/pdf", [...Buffer.from("%PDF-1.7")])]));
  assert.doesNotThrow(() => validatePhysicalScanBatch([upload("image/png", [...Buffer.from("89504e470d0a1a0a", "hex")])]));
  assert.doesNotThrow(() => validatePhysicalScanBatch([upload("image/jpeg", [0xff, 0xd8, 0xff, 0xe0])]));
  assert.throws(() => validatePhysicalScanBatch([upload("application/pdf", [...Buffer.from("<html")])]), /đúng định dạng/);
  assert.throws(() => validatePhysicalScanBatch([upload("image/webp", [0x52, 0x49, 0x46, 0x46])]), /PDF\/JPG\/PNG/);
});

test("batch bounds are 10 files, 4 MiB each and 20 MiB aggregate", () => {
  const pdf = upload("application/pdf", [...Buffer.from("%PDF-")]);
  assert.doesNotThrow(() => validatePhysicalScanBatch(Array.from({ length: 10 }, () => pdf)));
  assert.throws(() => validatePhysicalScanBatch(Array.from({ length: 11 }, () => pdf)), /tối đa 10/);
  assert.throws(() => validatePhysicalScanBatch([upload("application/pdf", [...Buffer.from("%PDF-")], 4 * 1024 * 1024 + 1)]), /4 MiB/);
  assert.throws(() => validatePhysicalScanBatch(Array.from({ length: 6 }, () => upload("application/pdf", [...Buffer.from("%PDF-")], 4 * 1024 * 1024))), /20 MiB/);
});

test("archive metadata is normalized and physical/digital states cannot mix", () => {
  assert.equal(normalizeArchiveText("  Tủ   hồ sơ A  ", "nơi lưu"), "Tủ hồ sơ A");
  assert.throws(() => normalizeArchiveText("   ", "nơi lưu"), /Thiếu/);
  assert.doesNotThrow(() => assertSigningModeState("PHYSICAL", "RETURNED"));
  assert.throws(() => assertSigningModeState("DIGITAL", "PHYSICAL_CONFIRMED"), /chế độ ký/);
});

test("service validates complete batch before relational writes and preserves approval state", async () => {
  const source = await readFile(new URL("../lib/workflow/service.ts", import.meta.url), "utf8");
  const uploadCase = source.match(/case "UPLOAD_SIGNED":[\s\S]*?case "RETURN_SIGNED":/)?.[0] ?? "";
  assert.ok(uploadCase.indexOf("validatePhysicalScanBatch") < uploadCase.indexOf("workflowPhysicalScanBatch.create"));
  assert.match(uploadCase, /mode === "DIGITAL"/);
  assert.match(uploadCase, /status !== "RETURNED"/);
  assert.match(source, /case "RETURN_SIGNED"[\s\S]*required\(text\(form, "reason"\)/);
  assert.match(source, /case "CONFIRM_SIGNED"[\s\S]*keeperNormalized[\s\S]*locationNormalized/);
  assert.match(source, /physicalCommandKey[\s\S]*priorPhysicalCommand[\s\S]*fingerprint/);
  assert.match(source, /workflowSigningCommand\.create/);
  assert.match(source, /body\.responsibleManagerId !== user\.id/);
  assert.match(source, /request\.version !== submittedFormVersion/);
  assert.match(source, /TransactionIsolationLevel\.Serializable/);
  assert.match(source, /finalizePhysicalApprovedSnapshot/);
  const physicalCases = source.match(/case "UPLOAD_SIGNED":[\s\S]*?case "REQUEST_DOCUMENT_CANCEL":/)?.[0] ?? "";
  assert.doesNotMatch(physicalCases, /await update\(\{\s*state:/);
});

test("UI exposes one signing mode and paper controls only for physical dossiers", async () => {
  const panel = await readFile(new URL("../components/WorkflowPanel.tsx", import.meta.url), "utf8");
  const dialog = await readFile(new URL("../components/WorkflowDecisionDialog.tsx", import.meta.url), "utf8");
  assert.match(panel, /name="signingMode"/);
  assert.match(panel, /value="DIGITAL"/);
  assert.match(panel, /value="PHYSICAL"/);
  assert.match(panel, /r\.signingMode === "PHYSICAL"/);
  assert.match(dialog, /request\.signingMode !== "PHYSICAL"/);
});

test("schema keeps immutable batches, files and transition history", async () => {
  const schema = await readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
  assert.match(schema, /model WorkflowPhysicalScanBatch/);
  assert.match(schema, /@@unique\(\[requestId, version\]\)/);
  assert.match(schema, /model WorkflowPhysicalScanFile/);
  assert.match(schema, /model WorkflowPhysicalSigningTransition/);
  assert.match(schema, /supersededAt\s+DateTime\?/);
});
