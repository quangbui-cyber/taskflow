import test from "node:test";
import assert from "node:assert/strict";
import { latestPublished } from "../lib/workflow/catalog";

test("Catalog latest published: independent families, draft revisions and advance variants", () => {
  const row = (id: string, familyId: string, version: number, publishedAt: string | null, kind = "PROPOSAL_ADVANCE") => ({ id, familyId, version, publishedAt, kind });
  const rows = [row("a1", "a", 1, "2026-01-01"), row("a2", "a", 2, "2026-02-01"), row("a3", "a", 3, null), row("b1", "b", 1, "2026-01-01"), row("s1", "s", 1, "2026-01-01", "PROPOSAL_ADVANCE_SETTLEMENT")];
  assert.deepEqual(latestPublished(rows).map(t => t.id).sort(), ["a2", "b1", "s1"]);
  assert.deepEqual(latestPublished([]), []);
});
