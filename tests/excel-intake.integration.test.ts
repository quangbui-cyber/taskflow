import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { previewPastedIntake } from "../lib/costflow/excelIntakeParser";
import type { FinanceData } from "../lib/costflow/types";

test("preview route persists opaque authority and returns a bounded DTO", async () => {
  const route = await readFile(path.join(process.cwd(), "app/api/projects/[id]/costflow/excel-intake/preview/route.ts"), "utf8");
  assert.match(route, /getCurrentUser/);
  assert.match(route, /createNewDraftExcelIntakePreview/);
  assert.match(route, /previewSessionId/);
  assert.match(route, /private, no-store/);
  assert.doesNotMatch(route, /return Response\.json\(preview\b/);
});

test("confirm service is serializable, session-owned and durable", async () => {
  const service = await readFile(path.join(process.cwd(), "lib/costflow/excelIntakeService.ts"), "utf8");
  assert.match(service, /TransactionIsolationLevel\.Serializable/);
  assert.match(service, /loadActionableExcelIntakePreviewSession/);
  assert.match(service, /excelIntakeOperationReceipt/);
  assert.match(service, /previewSessionId/);
  assert.doesNotMatch(service, /data\.excelIntakeReceipts|slice\(-99\)/);
  assert.doesNotMatch(service.match(/export type ConfirmExcelIntakeCommand[\s\S]*?;/)?.[0] ?? "", /preview:|fingerprint:/);
});

test("live confirm reauthorizes session scope, rolls back and admits one race winner", { skip: !process.env.COSTFLOW_TEST_DATABASE_URL }, async () => {
  const canonicalUrl = "postgresql://postgres@127.0.0.1:55439/costflow_test";
  assert.equal(process.env.COSTFLOW_TEST_DATABASE_URL, canonicalUrl);
  process.env.DATABASE_URL = canonicalUrl;
  const { prisma } = await import("../lib/prisma");
  const { confirmExcelIntake, createNewDraftExcelIntakePreview } = await import("../lib/costflow/excelIntakeService");
  const prefix = `excel-intake-${randomUUID()}`;
  const projectIds: string[] = [];
  const userIds: string[] = [];
  const preview = previewPastedIntake({
    sheet: "DAN_BANG",
    text: "LEVEL\tROW_TYPE\tPARENT_ROW\tNAME\tDESCRIPTION\tSELL_UNIT\tSELL_QUANTITY\tSELL_DAYS\tSELL_UNIT_PRICE\tSELL_VAT\tSELL_BASIS\tSELL_NOTE\tBUY_UNIT\tBUY_QUANTITY\tBUY_DAYS\tBUY_UNIT_PRICE\tBUY_VAT\tBUY_BASIS\tSUPPLIER\tBUY_NOTE\n+1\tGROUP\t\tNhóm thử nghiệm\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\n+2\tITEM\t2\tHạng mục thử nghiệm\tMô tả\tngày\t2\t1\t1000\t8\tNET\tGhi chú\tngày\t2\t1\t500\t10\tNET\tNCC thử nghiệm\tNội bộ",
  });
  try {
    const createUser = async (suffix: string, role: string, isActive = true) => {
      const user = await prisma.user.create({ data: { name: `${prefix}-${suffix}`, email: `${prefix}-${suffix}@example.test`, passwordHash: "unused", role, isActive } });
      userIds.push(user.id);
      return user;
    };
    const actor = await createUser("account", "ACCOUNT");
    const outside = await createUser("outside", "ACCOUNT");
    const createProject = async (suffix: string) => {
      const project = await prisma.project.create({ data: { name: `${prefix}-${suffix}`, ownerId: actor.id, revenue: 777, members: { create: { userId: actor.id } } } });
      projectIds.push(project.id);
      return project;
    };
    const createSession = async (projectId: string) => createNewDraftExcelIntakePreview({ id: actor.id, role: "USER" }, {
      projectId,
      preview,
      sourceKind: "PASTE",
      sourceRevision: 1,
      sourceText: "fixture",
    });

    const project = await createProject("primary");
    const session = await createSession(project.id);
    const command = { projectId: project.id, previewSessionId: session.previewSessionId, expectedVersion: 0, idempotencyKey: `${prefix}:primary`, corrections: {} };
    await assert.rejects(() => confirmExcelIntake({ id: outside.id, role: "ADMIN" }, command), /không tìm thấy|quyền/i);
    const created = await confirmExcelIntake({ id: actor.id, role: "USER" }, command);
    assert.equal(created.idempotent, false);
    const workspace = await prisma.costFlowWorkspace.findUniqueOrThrow({ where: { projectId: project.id } });
    const data = workspace.data as unknown as FinanceData;
    assert.equal(data.quotationDrafts?.length, 1);
    assert.equal(data.excelIntakeReceipts, undefined);
    assert.equal(await prisma.costFlowHistory.count({ where: { projectId: project.id } }), 1);
    assert.equal(await prisma.excelIntakeOperationReceipt.count({ where: { projectId: project.id } }), 1);

    const rollbackProject = await createProject("rollback");
    const rollbackSession = await createSession(rollbackProject.id);
    const itemKey = preview.rows.find(row => row.rowType === "ITEM")!.candidateKey;
    await assert.rejects(() => confirmExcelIntake({ id: actor.id, role: "ACCOUNT" }, {
      projectId: rollbackProject.id,
      previewSessionId: rollbackSession.previewSessionId,
      expectedVersion: 0,
      idempotencyKey: `${prefix}:rollback`,
      corrections: { [`${itemKey}.sell.quantity`]: "0" },
    }), /Số lượng phải lớn hơn 0/i);
    assert.equal(await prisma.costFlowWorkspace.count({ where: { projectId: rollbackProject.id } }), 0);
    assert.equal(await prisma.excelIntakeOperationReceipt.count({ where: { projectId: rollbackProject.id } }), 0);
    assert.equal(await prisma.excelIntakeSourceEvidence.count({ where: { projectId: rollbackProject.id } }), 0);
    assert.equal(await prisma.costFlowHistory.count({ where: { projectId: rollbackProject.id } }), 0);
    const stillReviewable = await prisma.excelIntakePreviewSession.findUniqueOrThrow({ where: { id: rollbackSession.previewSessionId } });
    assert.equal(stillReviewable.status, "ACTIVE");
    assert.notEqual(stillReviewable.canonicalPayload, null);
    assert.notEqual(stillReviewable.displayPayload, null);

    const raceProject = await createProject("race");
    const raceSession = await createSession(raceProject.id);
    const base = { projectId: raceProject.id, previewSessionId: raceSession.previewSessionId, expectedVersion: 0, corrections: {} };
    const race = await Promise.allSettled([
      confirmExcelIntake({ id: actor.id, role: "ACCOUNT" }, { ...base, idempotencyKey: `${prefix}:race-a` }),
      confirmExcelIntake({ id: actor.id, role: "ACCOUNT" }, { ...base, idempotencyKey: `${prefix}:race-b` }),
    ]);
    assert.equal(race.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(await prisma.excelIntakeOperationReceipt.count({ where: { projectId: raceProject.id } }), 1);
  } finally {
    if (projectIds.length) {
      await prisma.excelIntakePreviewSession.updateMany({ where: { projectId: { in: projectIds } }, data: { receiptId: null } });
      await prisma.excelIntakeSourceEvidence.deleteMany({ where: { projectId: { in: projectIds } } });
      await prisma.excelIntakeOperationReceipt.deleteMany({ where: { projectId: { in: projectIds } } });
      await prisma.excelIntakePreviewSession.deleteMany({ where: { projectId: { in: projectIds } } });
      await prisma.excelIntakePreviewAuthority.deleteMany({ where: { projectId: { in: projectIds } } });
      await prisma.costFlowHistory.deleteMany({ where: { projectId: { in: projectIds } } });
      await prisma.costFlowWorkspace.deleteMany({ where: { projectId: { in: projectIds } } });
      await prisma.projectMember.deleteMany({ where: { projectId: { in: projectIds } } });
      await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
    }
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  }
});
