import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

function approvedDatabaseUrl() {
  const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol), "Phase 7 test requires PostgreSQL");
  assert.equal(url.hostname, "127.0.0.1", "Phase 7 test only uses 127.0.0.1");
  assert.equal(url.port, "55439", "Phase 7 test only uses port 55439");
  assert.equal(url.pathname, "/taskflow", "Phase 7 test only uses database taskflow");
  return url;
}

test("payment-integration: approved DB guard runs before any fixture write", async () => {
  const url = approvedDatabaseUrl();
  const { prisma } = await import("../lib/prisma");
  const prefix = `phase7-payment-${randomUUID()}`;
  const createdUserIds: string[] = [];
  let projectId = "";

  try {
    const owner = await prisma.user.create({
      data: { email: `${prefix}-owner@example.test`, name: `${prefix} owner`, role: "ACCOUNT", passwordHash: "unused" },
    });
    createdUserIds.push(owner.id);
    const project = await prisma.project.create({ data: { name: prefix, ownerId: owner.id } });
    projectId = project.id;

    assert.equal(project.name, prefix);
    assert.equal(url.pathname, "/taskflow");
  } finally {
    if (projectId) await prisma.project.deleteMany({ where: { id: projectId, name: prefix } });
    if (createdUserIds.length) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds }, email: { startsWith: prefix } } });
    }
  }
});

