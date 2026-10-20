import assert from "node:assert/strict";
import test from "node:test";
import { actualCostManifestHash } from "../lib/costflow/actualCostSheet";
import { executeActualCostBulkDecision, executeActualCostCommand } from "../lib/costflow/actualCostService";

test("Bảng AC manifest hash is deterministic and order-sensitive by persisted position", () => {
  const base = {
    projectId: "project-1",
    revision: 2,
    icRevisionId: "ic-r4",
    lines: [
      { lineId: "line-b", versionId: "version-b", version: 1, position: 1 },
      { lineId: "line-a", versionId: "version-a", version: 3, position: 0 },
    ],
  };
  const hash = actualCostManifestHash(base);
  assert.equal(hash.length, 64);
  assert.equal(hash, actualCostManifestHash({ ...base, lines: [...base.lines].reverse() }));
  assert.notEqual(hash, actualCostManifestHash({ ...base, lines: base.lines.map(item => item.lineId === "line-a" ? { ...item, versionId: "version-a-new" } : item) }));
  assert.notEqual(hash, actualCostManifestHash({ ...base, icRevisionId: "ic-r5" }));
});

test("direct service calls also reject independent AC-line approval", async () => {
  const actor = { id: "actor", role: "ADMIN" };
  await assert.rejects(
    executeActualCostCommand(actor, { command: "DECIDE", projectId: "project", lineId: "line", version: 1, reviewToken: "token", action: "APPROVED", reason: "", acknowledgeMissingEvidence: false }),
    /thao tác duyệt từng khoản đã ngừng sử dụng/,
  );
  await assert.rejects(
    executeActualCostBulkDecision(actor, { projectId: "project", action: "APPROVED", reason: "", acknowledgeMissingEvidence: false, selections: [] }),
    /thao tác duyệt nhiều khoản riêng lẻ đã ngừng sử dụng/,
  );
});
