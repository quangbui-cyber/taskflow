import assert from "node:assert/strict";
import { test } from "node:test";
import { assertMigrationTarget, MigrationTargetError, parseMigrationArgs, parseReviewIdList, resolveApplySelection } from "../lib/crm/migrationCli";
import type { LegacyPlan } from "../lib/crm/legacyMigration";

test("default/explicit dry-run, apply/rollback batch rules, and strict options", () => {
  const dry = parseMigrationArgs([]);
  assert.equal(dry.mode, "DRY_RUN"); assert.deepEqual(parseMigrationArgs(["--dry-run"]), dry);
  assert.equal(parseMigrationArgs(["--rollback", "--batch", "b1"]).mode, "ROLLBACK");
  assert.deepEqual(parseMigrationArgs(["--dry-run", "--project-ids=a,b"]).projectIds, ["a", "b"]);
  for (const argv of [["--apply"], ["--apply", "--rollback", "--batch", "b1"], ["--dry-run", "--apply", "--batch", "b1"], ["--dry-run", "--rollback", "--batch", "b1"], ["--what"], ["--year=NaN"], ["--project-ids="], ["--batch=x"], ["--year=2026", "--year=2027"]]) assert.throws(() => parseMigrationArgs(argv), /./);
});
test("target guard rejects dev DB, remote/test lookalikes and malformed URLs without credentials", () => {
  const args = parseMigrationArgs([]), safe = "postgresql://u:password@127.0.0.1:55439/taskflow_crm_test";
  assert.deepEqual(assertMigrationTarget(safe, {}, args), { host: "127.0.0.1", database: "taskflow_crm_test" });
  for (const url of [safe.replace("taskflow_crm_test", "taskflow"), safe.replace("127.0.0.1", "db.example.com"), safe.replace("taskflow_crm_test", "taskflow_crm_testevil"), "invalid password", "https://u:password@localhost/taskflow_crm_test", safe.replace("taskflow_crm_test", "taskflow%2Fother")]) {
    assert.throws(() => assertMigrationTarget(url, { CRM_MIGRATION_ALLOWED_DATABASES: "127.0.0.1/taskflow" }, args), (error: unknown) => error instanceof MigrationTargetError && !error.message.includes("password"));
  }
});
test("allowlist permits read target but requires exact confirm-database for writes", () => {
  const url = "postgresql://u:secret@db.example.com:5432/prod", env = { CRM_MIGRATION_ALLOWED_DATABASES: "db.example.com/prod" };
  assert.deepEqual(assertMigrationTarget(url, env, parseMigrationArgs([])), { host: "db.example.com", database: "prod" });
  for (const mode of ["--apply", "--rollback"]) {
    for (const confirm of [[], ["--confirm-database=other"]]) assert.throws(() => assertMigrationTarget(url, env, parseMigrationArgs([mode, "--batch=b1", ...confirm])));
    assert.doesNotThrow(() => assertMigrationTarget(url, env, parseMigrationArgs([mode, "--batch=b1", "--confirm-database=prod"])));
  }
  assert.throws(() => assertMigrationTarget(url.replace("prod", "taskflow"), { CRM_MIGRATION_ALLOWED_DATABASES: "db.example.com/taskflow" }, parseMigrationArgs([])));
});
test("review approvals are raw file/list input and restricted to apply", () => {
  assert.equal(parseMigrationArgs(["--apply", "--batch=d1", "--approve-review-ids", "p1,p2"]).approveReviewIds, "p1,p2");
  assert.equal(parseMigrationArgs(["--apply", "--batch=d1", "--approve-review-ids=ids.txt"]).approveReviewIds, "ids.txt");
  for (const mode of [[], ["--rollback", "--batch=a1"]]) assert.throws(() => parseMigrationArgs([...mode, "--approve-review-ids=p1"]));
  assert.deepEqual(parseReviewIdList("p1, p2\n# comment\np2\n\n p3 "), ["p1", "p2", "p3"]);
});
test("selection compares every dry-run classification and never accepts blocked/missing/foreign approvals", () => {
  const records = [{ legacyProjectId: "a", classification: "MIGRATE" }, { legacyProjectId: "b", classification: "NEEDS_REVIEW" }, { legacyProjectId: "c", classification: "BLOCKED" }, { legacyProjectId: "d", classification: "MISSING_CLIENT" }];
  const plan = { rows: records.map((r) => ({ projectId: r.legacyProjectId, classification: r.classification })) } as LegacyPlan;
  assert.deepEqual(resolveApplySelection(records, plan, ["b", "b"]), { ok: true, projectIds: ["a"], approvedReviewIds: ["b"] });
  for (const id of ["c", "d", "zzz"]) { const r = resolveApplySelection(records, plan, [id]); assert.equal(r.ok, false); if (!r.ok) assert.equal(r.invalidApprovals[0].projectId, id); }
  const changed = resolveApplySelection(records, { ...plan, rows: plan.rows.filter((r) => r.projectId !== "a") }, []);
  assert.equal(changed.ok, false); if (!changed.ok) assert.deepEqual(changed.changed, [{ projectId: "a", before: "MIGRATE", after: null }]);
  const blocked = resolveApplySelection(records, { ...plan, rows: plan.rows.map((r) => r.projectId === "a" ? { ...r, classification: "BLOCKED" } : r) }, []);
  assert.equal(blocked.ok, false); if (!blocked.ok) assert.equal(blocked.changed[0].after, "BLOCKED");
});
