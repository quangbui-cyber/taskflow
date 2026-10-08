import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizePaymentDraft, publicPaymentErrorMessage } from "../lib/costflow/paymentPolicy";

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const root = fileURLToPath(new URL("..", import.meta.url));
function sourceTree(directory: string): string {
  return readdirSync(join(root, directory), { withFileTypes: true }).flatMap(entry => {
    const relative = join(directory, entry.name);
    if (entry.isDirectory()) return sourceTree(relative);
    return /\.[cm]?[jt]sx?$/.test(entry.name) ? [readFileSync(join(root, relative), "utf8")] : [];
  }).join("\n");
}

const base = {
  projectId: "project-a",
  kind: "ADVANCE" as const,
  budgetEffectStatus: "EFFECTIVE" as const,
  milestone: "Đợt 1",
  clientTotal: "999999999999",
  lines: [{
    stableKey: "line-a",
    description: "Đặt cọc",
    amount: "10000000",
    source: { projectId: "project-a", revisionId: "revision-a", lineId: "ic-line-a", budgetGross: "10000000" },
    recipient: { projectId: "project-a", key: "VENDOR:vendor-a", type: "VENDOR" as const, name: "Vendor A", accountLast4: "6789", sourceVersion: 2 },
    evidenceIds: ["evidence-a"],
  }],
};

test("payment security: browser total has no authority and foreign IDs fail", () => {
  assert.equal(normalizePaymentDraft(base).totalAmount, "10000000");
  assert.throws(() => normalizePaymentDraft({ ...base, lines: [{ ...base.lines[0], source: { ...base.lines[0].source, projectId: "project-b" } }] }), /cùng Project/);
  assert.throws(() => normalizePaymentDraft({ ...base, lines: [{ ...base.lines[0], recipient: { ...base.lines[0].recipient, projectId: "project-b" } }] }), /cùng Project/);
});

test("payment security: public errors redact account-like values and stay bounded", () => {
  const message = publicPaymentErrorMessage(new Error(`Số tài khoản 0123456789012 không hợp lệ ${"x".repeat(900)}`));
  assert.doesNotMatch(message, /0123456789012/);
  assert.match(message, /đã ẩn/);
  assert.ok(message.length <= 500);
});

test("payment security: Server Action takes actor from session and never browser role", () => {
  const action = source("app/actions/costflow.ts");
  assert.match(action, /const actor = await requireUser\(\)/);
  assert.doesNotMatch(action, /form\.get\(["'](?:role|actorId|userId)["']\)/);
  assert.match(action, /publicPaymentErrorMessage\(error\)/);
});

test("payment security: broad ledger omits bank account and raw evidence bytes", () => {
  const readModel = source("lib/costflow/paymentReadModel.ts");
  assert.doesNotMatch(readModel, /accountNumber|account\s*:/);
  assert.doesNotMatch(readModel, /evidenceBytes|\bdata\s*:/);
  assert.doesNotMatch(readModel, /bankName/);
});

test("payment security: evidence routes recheck reader, Project and ownership without enumeration", () => {
  for (const path of [
    "app/api/projects/[id]/costflow/evidence/[evidenceId]/route.ts",
    "app/api/projects/[id]/costflow/evidence/[evidenceId]/preview/route.ts",
  ]) {
    const route = source(path);
    assert.match(route, /loadFinance\(id, actor\)/);
    assert.match(route, /finance\?\.evidence\.some\(e => e\.id === evidenceId\)/);
    assert.match(route, /findFirst\(\{ where: \{ id: evidenceId, projectId: id \} \}\)/);
    assert.match(route, /new Response\("Not found", \{ status: 404 \}\)/);
    assert.match(route, /Cache-Control[\s\S]*private, no-store/);
  }
});

test("payment security: production contains no test AC fixture or PAY-06 bypass", () => {
  const production = ["app", "lib", "components"].map(sourceTree).join("\n");
  assert.doesNotMatch(production, /ApprovedAcConsumerFixture|PAY-06|PRE_APPROVAL|APPROVE_EXCEPTION/);
});
