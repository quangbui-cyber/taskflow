import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import bcrypt from "bcryptjs";
import type { Prisma } from "@prisma/client";
import { appendDigitalSigningEvent, requiresDigitalSignature, type DigitalSigningRole } from "../lib/workflow/signing";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

async function fakeTx(options?: { mode?: string; version?: number }) {
  const pinHash = await bcrypt.hash("654321", 4);
  const events: Array<Record<string, any>> = [];
  const commands = new Map<string, Record<string, any>>();
  let lifecycle: Record<string, any> | null = options?.mode
    ? { requestId: "request-1", mode: options.mode, expectedVersion: options.version ?? 7, evidenceState: options.mode === "DIGITAL" ? "CHO_KY" : "PENDING" }
    : null;
  const tx = {
    user: { findFirst: async ({ where }: any) => where.id.startsWith("actor-") ? { signaturePinHash: pinHash } : null },
    workflowSigningLifecycle: {
      findUnique: async () => lifecycle,
      create: async ({ data }: any) => (lifecycle = { ...data }),
      update: async ({ data }: any) => (lifecycle = { ...lifecycle, ...data }),
    },
    workflowSigningCommand: {
      findUnique: async ({ where }: any) => commands.get(where.requestId_commandKey.commandKey) ?? null,
      create: async ({ data }: any) => { commands.set(data.commandKey, data); return data; },
    },
    workflowSigningEvent: {
      findUnique: async ({ where }: any) => events.find(item => {
        const key = where.requestId_version_role;
        return item.requestId === key.requestId && item.version === key.version && item.role === key.role;
      }) ?? null,
      findFirst: async () => events.at(-1) ?? null,
      create: async ({ data }: any) => { const event = { id: `event-${events.length + 1}`, ...data }; events.push(event); return event; },
      count: async ({ where }: any) => events.filter(item => item.requestId === where.requestId && item.version === where.version).length,
    },
  };
  return { tx: tx as unknown as Prisma.TransactionClient, events, commands, getLifecycle: () => lifecycle };
}

function sign(tx: Prisma.TransactionClient, role: DigitalSigningRole, commandKey: string, overrides: Record<string, unknown> = {}) {
  return appendDigitalSigningEvent(tx, {
    requestId: "request-1",
    version: 7,
    kind: "PROPOSAL",
    role,
    actorId: `actor-${role.toLowerCase()}`,
    signatureData: PNG,
    signaturePin: "654321",
    commandKey,
    ...overrides,
  });
}

test("signed and exempt document kinds remain explicit", () => {
  for (const kind of ["ADVANCE", "VENDOR_PAYMENT", "REIMBURSEMENT", "PROPOSAL"]) assert.equal(requiresDigitalSignature(kind), true);
  for (const kind of ["QUOTATION", "IC", "AC", "AC_REVISION"]) assert.equal(requiresDigitalSignature(kind), false);
});

test("server verifies bcrypt PIN before writing an event", async () => {
  const { tx, events } = await fakeTx();
  await assert.rejects(() => sign(tx, "CREATOR", "submit-1", { signaturePin: "000000" }), /PIN/);
  assert.equal(events.length, 0);
  await sign(tx, "CREATOR", "submit-1");
  assert.equal(events.length, 1);
  assert.equal(events[0].pinVerified, true);
});

test("digital commands reject physical mode and stale expected version", async () => {
  const physical = await fakeTx({ mode: "PHYSICAL", version: 7 });
  await assert.rejects(() => sign(physical.tx, "CREATOR", "submit-1"), /chế độ ký khác/);
  const stale = await fakeTx({ mode: "DIGITAL", version: 6 });
  await assert.rejects(() => sign(stale.tx, "CREATOR", "submit-1"), /phiên bản ký đã thay đổi/);
});

test("identical command retries are idempotent and conflicting reuse fails", async () => {
  const { tx, events, commands } = await fakeTx();
  const first = await sign(tx, "CREATOR", "submit-1");
  const retried = await sign(tx, "CREATOR", "submit-1");
  assert.equal(retried?.id, first?.id);
  assert.equal(events.length, 1);
  assert.equal(commands.size, 1);
  await assert.rejects(() => sign(tx, "CREATOR", "submit-1", { actorId: "actor-other" }), /nội dung khác/);
});

test("four ordered role events are required for DIGITAL_CONFIRMED", async () => {
  const fixture = await fakeTx();
  const roles: DigitalSigningRole[] = ["CREATOR", "MANAGER", "ACCOUNTANT", "CEO"];
  for (const [index, role] of roles.entries()) {
    await sign(fixture.tx, role, `command-${role}`);
    assert.equal(fixture.getLifecycle()?.evidenceState, index === 3 ? "DIGITAL_CONFIRMED" : "CHO_KY");
  }
  assert.deepEqual(fixture.events.map(item => item.role), roles);
  assert.equal(fixture.events[1].previousEventHash, fixture.events[0].eventHash);
});

test("workflow and CostFlow commands wire creator and approver signatures while IC stays exempt", async () => {
  const workflow = await readFile(new URL("../lib/workflow/service.ts", import.meta.url), "utf8");
  const costflow = await readFile(new URL("../lib/costflow/service.ts", import.meta.url), "utf8");
  assert.match(workflow, /role:\s*"CREATOR"/);
  assert.match(workflow, /finalizeDigitalApprovedSnapshot/);
  assert.match(costflow, /CREATE_PAYMENT_DOSSIER[\s\S]*appendDigitalSigningEvent/);
  assert.match(costflow, /requiresDigitalSignature\(request\.kind\)/);
  assert.doesNotMatch(costflow, /request\.kind === "IC"[\s\S]{0,180}appendDigitalSigningEvent/);
});
