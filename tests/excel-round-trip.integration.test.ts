import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRoundTripProjection, previewRoundTripMerge } from "../lib/costflow/excelRoundTrip";
import { createExcelRoundTripWorkbook } from "../lib/costflow/quotationExcel";
import { blankPairedRow } from "../lib/costflow/pairedDraft";
import { emptyFinance, type FinanceData, type PairedDraft } from "../lib/costflow/types";

test("live round-trip preview is authorized, zero-write and preserves immutable records", { skip: !process.env.COSTFLOW_TEST_DATABASE_URL }, async () => {
  const canonicalUrl = "postgresql://postgres@127.0.0.1:55439/costflow_test";
  assert.equal(process.env.COSTFLOW_TEST_DATABASE_URL, canonicalUrl);
  process.env.DATABASE_URL = canonicalUrl;
  const { prisma } = await import("../lib/prisma");
  const prefix = `excel-round-trip-${randomUUID()}`;
  const projectIds: string[] = [];
  const userIds: string[] = [];
  try {
    const actor = await prisma.user.create({ data: { name: prefix, email: `${prefix}@example.test`, passwordHash: "unused", role: "ACCOUNT" } }); userIds.push(actor.id);
    const outsider = await prisma.user.create({ data: { name: `${prefix}-out`, email: `${prefix}-out@example.test`, passwordHash: "unused", role: "ACCOUNT" } }); userIds.push(outsider.id);
    const project = await prisma.project.create({ data: { name: prefix, ownerId: actor.id, revenue: 777, members: { create: { userId: actor.id } } } }); projectIds.push(project.id);
    const row = blankPairedRow(`${prefix}-item`); row.name = "Hạng mục live"; row.sell = { ...row.sell, unit: "gói", quantity: "1", days: "1", unitPrice: "1000", vatPercent: "8" }; row.buy = { ...row.buy, unit: "gói", quantity: "1", days: "1", unitPrice: "500", vatPercent: "8" };
    const draft: PairedDraft = { linePricingSchemaVersion: 2, id: `${prefix}-draft`, version: 3, createdBy: actor.id, workspaceMode: "paired", title: "Live draft", clientId: "", customer: "Customer", notes: "", rows: [row], globalEvidenceIds: [] };
    const data: FinanceData = { ...emptyFinance(), quotationDrafts: [draft], quotations: [{ id: `${prefix}-quote`, number: 1, parentId: null, title: "Frozen", customer: "Customer", notes: "", lines: [], poIds: [], evidenceIds: [], createdBy: actor.id, createdAt: "2026-10-10T00:00:00.000Z" }] };
    await prisma.costFlowWorkspace.create({ data: { projectId: project.id, version: 4, data: data as never } });
    const bytes = await createExcelRoundTripWorkbook(createRoundTripProjection(project.id, draft), { projectName: project.name });
    const beforeWorkspace = await prisma.costFlowWorkspace.findUniqueOrThrow({ where: { projectId: project.id } });
    const beforeHistory = await prisma.costFlowHistory.count({ where: { projectId: project.id } });
    await assert.rejects(() => previewRoundTripMerge({ id: outsider.id, role: "ACCOUNT" }, project.id, Buffer.from(bytes)), /không tìm thấy|quyền/i);
    const preview = await previewRoundTripMerge({ id: actor.id, role: "USER" }, project.id, Buffer.from(bytes));
    assert.deepEqual([preview.diff.adds.length, preview.diff.changes.length, preview.diff.deletionCandidates.length, preview.diff.moves.length], [0, 0, 0, 0]);
    const afterWorkspace = await prisma.costFlowWorkspace.findUniqueOrThrow({ where: { projectId: project.id } });
    assert.equal(afterWorkspace.version, beforeWorkspace.version);
    assert.deepEqual(afterWorkspace.data, beforeWorkspace.data);
    assert.equal(await prisma.costFlowHistory.count({ where: { projectId: project.id } }), beforeHistory);
    assert.equal((afterWorkspace.data as unknown as FinanceData).quotations?.[0].title, "Frozen");
    assert.equal(await prisma.costFlowCash.count({ where: { projectId: project.id } }), 0);
  } finally {
    if (projectIds.length) {
      await prisma.costFlowHistory.deleteMany({ where: { projectId: { in: projectIds } } });
      await prisma.costFlowWorkspace.deleteMany({ where: { projectId: { in: projectIds } } });
      await prisma.projectMember.deleteMany({ where: { projectId: { in: projectIds } } });
      await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
    }
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  }
});
