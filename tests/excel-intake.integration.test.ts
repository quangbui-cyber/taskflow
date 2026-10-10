import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { previewPastedIntake } from "../lib/costflow/excelIntakeParser";
import type { FinanceData } from "../lib/costflow/types";

test("preview route is authenticated, project-scoped and zero-write", async () => {
  const route = await readFile(path.join(process.cwd(), "app/api/projects/[id]/costflow/excel-intake/preview/route.ts"), "utf8");
  assert.match(route, /getCurrentUser/);
  assert.match(route, /status:\s*401/);
  assert.match(route, /projectId_userId|projectMember/);
  assert.match(route, /status:\s*404/);
  assert.doesNotMatch(route, /\.(?:create|update|upsert|delete)\s*\(/);
});

test("confirm service is serializable, CAS-protected, idempotent and append-only", async () => {
  const service = await readFile(path.join(process.cwd(), "lib/costflow/excelIntakeService.ts"), "utf8");
  assert.match(service, /TransactionIsolationLevel\.Serializable/);
  assert.match(service, /expectedVersion/);
  assert.match(service, /excelIntakeReceipts/);
  assert.match(service, /idempotencyKey/);
  assert.match(service, /fingerprint/);
  assert.match(service, /operationFingerprint/);
  assert.match(service, /quotationDrafts\s*=\s*\[\.\.\./);
  assert.doesNotMatch(service, /finalizePairedQuotation|submit|approve|costFlowCash|revenue|settlement/i);
});

test("confirm action derives actor from session and returns only safe result fields", async () => {
  const action = await readFile(path.join(process.cwd(), "app/actions/costflowExcelIntake.ts"), "utf8");
  assert.match(action, /requireUser/);
  assert.match(action, /confirmExcelIntake/);
  assert.match(action, /draftId/);
  assert.match(action, /idempotent/);
  assert.doesNotMatch(action, /form\.get\(["'](?:actor|role|draftId|total)/);
});

test("live confirm proves authorization, rollback, CAS, replay, race and protected-state invariants", { skip: !process.env.COSTFLOW_TEST_DATABASE_URL }, async () => {
  const canonicalUrl = "postgresql://postgres@127.0.0.1:55439/costflow_test";
  assert.equal(process.env.COSTFLOW_TEST_DATABASE_URL, canonicalUrl);
  process.env.DATABASE_URL = canonicalUrl;

  const { prisma } = await import("../lib/prisma");
  const { confirmExcelIntake } = await import("../lib/costflow/excelIntakeService");
  const prefix = `excel-intake-${randomUUID()}`;
  const projectIds: string[] = [];
  const userIds: string[] = [];
  const preview = previewPastedIntake({
    sheet: "DAN_BANG",
    text: "LEVEL\tROW_TYPE\tPARENT_ROW\tNAME\tDESCRIPTION\tSELL_UNIT\tSELL_QUANTITY\tSELL_DAYS\tSELL_UNIT_PRICE\tSELL_VAT\tSELL_BASIS\tSELL_NOTE\tBUY_UNIT\tBUY_QUANTITY\tBUY_DAYS\tBUY_UNIT_PRICE\tBUY_VAT\tBUY_BASIS\tSUPPLIER\tBUY_NOTE\n+1\tGROUP\t\tNhóm thử nghiệm\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\n+2\tITEM\t2\tHạng mục thử nghiệm\tMô tả\tngày\t2\t1\t1000\t8\tNET\tGhi chú\tngày\t2\t1\t500\t10\tNET\tNCC thử nghiệm\tNội bộ",
  });
  assert.equal(preview.errors.length, 0);
  const itemKey = preview.rows.find(row => row.rowType === "ITEM")!.candidateKey;

  try {
    const createUser = async (suffix: string, role: string, isActive = true) => {
      const user = await prisma.user.create({ data: { name: `${prefix}-${suffix}`, email: `${prefix}-${suffix}@example.test`, passwordHash: "unused", role, isActive } });
      userIds.push(user.id);
      return user;
    };
    const actor = await createUser("account", "ACCOUNT");
    const ordinaryMember = await createUser("member", "USER");
    const outsideAccount = await createUser("outside", "ACCOUNT");
    const inactiveAccount = await createUser("inactive", "ACCOUNT", false);
    const createProject = async (suffix: string, memberIds: string[]) => {
      const project = await prisma.project.create({
        data: { name: `${prefix}-${suffix}`, ownerId: actor.id, revenue: 777, members: { create: memberIds.map(userId => ({ userId })) } },
      });
      projectIds.push(project.id);
      return project;
    };
    const project = await createProject("primary", [actor.id, ordinaryMember.id, inactiveAccount.id]);
    const command = (projectId: string, idempotencyKey: string, expectedVersion = 0, corrections: Record<string, string> = {}) => ({
      projectId,
      expectedVersion,
      idempotencyKey,
      fingerprint: preview.fingerprint,
      preview,
      corrections,
    });

    await assert.rejects(() => confirmExcelIntake({ id: ordinaryMember.id, role: "ACCOUNT" }, command(project.id, `${prefix}:ordinary`)), /không có quyền/i);
    await assert.rejects(() => confirmExcelIntake({ id: outsideAccount.id, role: "ADMIN" }, command(project.id, `${prefix}:outside`)), /không có quyền/i);
    await assert.rejects(() => confirmExcelIntake({ id: inactiveAccount.id, role: "ACCOUNT" }, command(project.id, `${prefix}:inactive`)), /không có quyền/i);
    assert.equal(await prisma.costFlowWorkspace.count({ where: { projectId: project.id } }), 0);

    const initialProtected = {
      revenue: (await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).revenue,
      cash: await prisma.costFlowCash.count({ where: { projectId: project.id } }),
      requests: await prisma.workflowRequest.count({ where: { projectId: project.id } }),
    };
    const key = `${prefix}:atomic`;
    const created = await confirmExcelIntake({ id: actor.id, role: "USER" }, command(project.id, key));
    assert.equal(created.version, 1);
    assert.equal(created.idempotent, false);
    const workspace = await prisma.costFlowWorkspace.findUniqueOrThrow({ where: { projectId: project.id } });
    const data = workspace.data as unknown as FinanceData;
    assert.equal(workspace.version, 1);
    assert.equal(data.quotationDrafts?.length, 1);
    assert.equal(data.quotationDrafts?.[0].id, created.draftId);
    assert.equal(data.excelIntakeReceipts?.length, 1);
    assert.equal(await prisma.costFlowHistory.count({ where: { projectId: project.id, action: "CONFIRM_EXCEL_INTAKE" } }), 1);
    assert.deepEqual({ revisions: data.revisions, quotations: data.quotations, expenses: data.expenses, beneficiaries: data.beneficiaries, pos: data.pos }, { revisions: [], quotations: [], expenses: [], beneficiaries: [], pos: [] });
    assert.deepEqual({
      revenue: (await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).revenue,
      cash: await prisma.costFlowCash.count({ where: { projectId: project.id } }),
      requests: await prisma.workflowRequest.count({ where: { projectId: project.id } }),
    }, initialProtected);

    const replay = await confirmExcelIntake({ id: actor.id, role: "ACCOUNT" }, command(project.id, key));
    assert.deepEqual(replay, { draftId: created.draftId, version: 1, idempotent: true });
    await assert.rejects(() => confirmExcelIntake({ id: actor.id, role: "ACCOUNT" }, command(project.id, key, 1, { [`${itemKey}.sell.quantity`]: "3" })), /dữ liệu khác/i);
    await assert.rejects(() => confirmExcelIntake({ id: actor.id, role: "ACCOUNT" }, command(project.id, `${prefix}:stale`, 0)), /Dữ liệu đã thay đổi/i);
    assert.equal((await prisma.costFlowWorkspace.findUniqueOrThrow({ where: { projectId: project.id } })).version, 1);
    assert.equal(await prisma.costFlowHistory.count({ where: { projectId: project.id } }), 1);

    const rollbackProject = await createProject("rollback", [actor.id]);
    await assert.rejects(() => confirmExcelIntake({ id: actor.id, role: "ACCOUNT" }, command(rollbackProject.id, `${prefix}:rollback`, 0, { [`${itemKey}.sell.quantity`]: "0" })), /Số lượng phải lớn hơn 0/i);
    assert.equal(await prisma.costFlowWorkspace.count({ where: { projectId: rollbackProject.id } }), 0);
    assert.equal(await prisma.costFlowHistory.count({ where: { projectId: rollbackProject.id } }), 0);

    const raceProject = await createProject("race", [actor.id]);
    const race = await Promise.allSettled([
      confirmExcelIntake({ id: actor.id, role: "ACCOUNT" }, command(raceProject.id, `${prefix}:race-a`)),
      confirmExcelIntake({ id: actor.id, role: "ACCOUNT" }, command(raceProject.id, `${prefix}:race-b`)),
    ]);
    assert.equal(race.filter(result => result.status === "fulfilled").length, 1);
    const raceWorkspace = await prisma.costFlowWorkspace.findUniqueOrThrow({ where: { projectId: raceProject.id } });
    const raceData = raceWorkspace.data as unknown as FinanceData;
    assert.equal(raceWorkspace.version, 1);
    assert.equal(raceData.quotationDrafts?.length, 1);
    assert.equal(raceData.excelIntakeReceipts?.length, 1);
    assert.equal(await prisma.costFlowHistory.count({ where: { projectId: raceProject.id } }), 1);
    assert.equal(await prisma.costFlowCash.count({ where: { projectId: raceProject.id } }), 0);
    assert.equal(await prisma.workflowRequest.count({ where: { projectId: raceProject.id } }), 0);
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
