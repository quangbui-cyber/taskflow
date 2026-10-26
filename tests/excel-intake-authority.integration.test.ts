import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { previewPastedIntake } from "../lib/costflow/excelIntakeParser";
import type { FinanceData } from "../lib/costflow/types";

const CANONICAL_URL = "postgresql://postgres@127.0.0.1:55439/costflow_test";

test("public commands and browser callers use opaque preview sessions only", async () => {
  const [service, action, intakeDialog, roundTripDialog, previewRoute, reviewRoute, sourceRoute] = await Promise.all([
    readFile(path.join(process.cwd(), "lib/costflow/excelIntakeService.ts"), "utf8"),
    readFile(path.join(process.cwd(), "app/actions/costflowExcelIntake.ts"), "utf8"),
    readFile(path.join(process.cwd(), "components/ExcelIntakeDialog.tsx"), "utf8"),
    readFile(path.join(process.cwd(), "components/ExcelRoundTripDialog.tsx"), "utf8"),
    readFile(path.join(process.cwd(), "app/api/projects/[id]/costflow/excel-intake/preview/route.ts"), "utf8"),
    readFile(path.join(process.cwd(), "app/api/projects/[id]/costflow/excel-intake/sessions/[sessionId]/route.ts"), "utf8"),
    readFile(path.join(process.cwd(), "app/api/projects/[id]/costflow/excel-intake/sessions/[sessionId]/source/route.ts"), "utf8"),
  ]);
  assert.match(service, /ConfirmExcelIntakeCommand\s*=\s*\{[\s\S]*?previewSessionId/);
  assert.match(service, /ConfirmRoundTripMergeCommand\s*=\s*\{[\s\S]*?previewSessionId/);
  for (const forbidden of ["preview: ExcelIntakePreview", "imported: RoundTripImport", "previewFingerprint:", "fingerprint: string"]) {
    assert.doesNotMatch(service.match(/export type ConfirmExcelIntakeCommand[\s\S]*?;/)?.[0] ?? "", new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(service.match(/export type ConfirmRoundTripMergeCommand[\s\S]*?;/)?.[0] ?? "", new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(`${action}\n${intakeDialog}\n${roundTripDialog}`, /expectedDraftFingerprint|expectedWorkspaceVersion|imported:\s*preview|preview:\s*state\.preview|fingerprint:\s*state\.preview/);
  assert.match(previewRoute, /previewSessionId/);
  assert.doesNotMatch(previewRoute, /return Response\.json\(preview\b/);
  assert.doesNotMatch(service, /data\.excelIntakeReceipts|slice\(-99\)/);
  assert.match(reviewRoute, /status:\s*404/);
  assert.match(reviewRoute, /private, no-store/);
  assert.match(sourceRoute, /status:\s*404/);
  assert.match(sourceRoute, /private, no-store/);
  assert.match(sourceRoute, /X-Content-Type-Options["']?:\s*["']nosniff/);
});

test("opaque new-draft session is atomic, durable and reviewable", { skip: !process.env.COSTFLOW_TEST_DATABASE_URL }, async () => {
  assert.equal(process.env.COSTFLOW_TEST_DATABASE_URL, CANONICAL_URL);
  process.env.DATABASE_URL = CANONICAL_URL;
  const { prisma } = await import("../lib/prisma");
  const {
    confirmExcelIntake,
    createNewDraftExcelIntakePreview,
    getExcelIntakePreviewSessionView,
  } = await import("../lib/costflow/excelIntakeService");
  const prefix = `excel-authority-${randomUUID()}`;
  const projectIds: string[] = [];
  const userIds: string[] = [];
  try {
    const actor = await prisma.user.create({ data: { name: prefix, email: `${prefix}@example.test`, passwordHash: "unused", role: "ACCOUNT" } });
    const outsider = await prisma.user.create({ data: { name: `${prefix}-out`, email: `${prefix}-out@example.test`, passwordHash: "unused", role: "ACCOUNT" } });
    userIds.push(actor.id, outsider.id);
    const project = await prisma.project.create({ data: { name: prefix, ownerId: actor.id, members: { create: { userId: actor.id } } } });
    projectIds.push(project.id);
    const preview = previewPastedIntake({
      sheet: "DAN_BANG",
      text: "LEVEL\tROW_TYPE\tPARENT_ROW\tNAME\tDESCRIPTION\tSELL_UNIT\tSELL_QUANTITY\tSELL_DAYS\tSELL_UNIT_PRICE\tSELL_VAT\tSELL_BASIS\tSELL_NOTE\tBUY_UNIT\tBUY_QUANTITY\tBUY_DAYS\tBUY_UNIT_PRICE\tBUY_VAT\tBUY_BASIS\tSUPPLIER\tBUY_NOTE\n+1\tGROUP\t\tNhóm\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\n+2\tITEM\t2\tHạng mục\tMô tả\tgói\t1\t1\t1000\t8\tNET\tGhi chú\tgói\t1\t1\t500\t8\tNET\tNCC\tNội bộ",
    });
    const session = await createNewDraftExcelIntakePreview({ id: actor.id, role: "USER" }, {
      projectId: project.id,
      preview,
      sourceKind: "XLSX",
      sourceRevision: 1,
      sourceFilename: "source.xlsx",
      sourceMimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      sourceBytes: Buffer.from("PK\u0003\u0004-authority-source"),
    });
    assert.equal(session.state, "ACTIONABLE");
    assert.ok(session.previewSessionId);

    const command = {
      projectId: project.id,
      previewSessionId: session.previewSessionId,
      expectedVersion: 0,
      idempotencyKey: `${prefix}:confirm`,
      corrections: {},
    };
    await assert.rejects(() => confirmExcelIntake({ id: outsider.id, role: "ADMIN" }, command), /không tìm thấy|quyền/i);
    const created = await confirmExcelIntake({ id: actor.id, role: "USER" }, command);
    assert.equal(created.idempotent, false);
    const replay = await confirmExcelIntake({ id: actor.id, role: "ACCOUNT" }, command);
    assert.equal(replay.idempotent, true);
    assert.equal(replay.draftId, created.draftId);
    await assert.rejects(() => confirmExcelIntake({ id: actor.id, role: "ACCOUNT" }, { ...command, corrections: { "forged.sell.unitPrice": "1" } }), /dữ liệu khác|không hợp lệ/i);

    const laterSessionRows = Array.from({ length: 101 }, (_, index) => ({
      id: `${prefix}-later-session-${index}`,
      projectId: project.id,
      actorId: actor.id,
      operationKind: "NEW_DRAFT",
      scopeKey: "NEW_DRAFT",
      sourceKind: "PASTE",
      sourceRevision: index + 2,
      sourceSha256: String(index).padStart(64, "0"),
      sourceSize: 0,
      canonicalFingerprint: String(index + 1).padStart(64, "0"),
      status: "CONSUMED",
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: new Date(),
      resultKind: "PAIRED_DRAFT",
      resultId: `${prefix}-later-draft-${index}`,
    }));
    await prisma.excelIntakePreviewSession.createMany({ data: laterSessionRows });
    await prisma.excelIntakeOperationReceipt.createMany({ data: laterSessionRows.map((row, index) => ({
      projectId: project.id,
      previewSessionId: row.id,
      idempotencyKey: `${prefix}:later:${index}`,
      actorId: actor.id,
      operationKind: "NEW_DRAFT",
      canonicalFingerprint: String(index + 1).padStart(64, "0"),
      result: { output: { draftId: row.resultId, version: 1, idempotent: false }, review: {} },
      linkedRecordKind: "PAIRED_DRAFT",
      linkedRecordId: row.resultId,
    })) });
    const replayAfter101 = await confirmExcelIntake({ id: actor.id, role: "ACCOUNT" }, command);
    assert.equal(replayAfter101.draftId, created.draftId);
    assert.equal(replayAfter101.idempotent, true);

    const expiring = await createNewDraftExcelIntakePreview({ id: actor.id, role: "ACCOUNT" }, { projectId: project.id, preview, sourceKind: "PASTE", sourceRevision: 200, sourceText: "expires" });
    await prisma.excelIntakePreviewSession.update({ where: { id: expiring.previewSessionId }, data: { expiresAt: new Date(Date.now() - 1) } });
    const expired = await getExcelIntakePreviewSessionView({ id: actor.id, role: "ACCOUNT" }, project.id, expiring.previewSessionId);
    assert.equal(expired.state, "NON_ACTIONABLE_EXPIRED");
    const redacted = await prisma.excelIntakePreviewSession.findUniqueOrThrow({ where: { id: expiring.previewSessionId } });
    assert.equal(redacted.canonicalPayload, null);
    assert.equal(redacted.displayPayload, null);
    assert.equal(redacted.sourceBytes, null);

    const [workspace, receipt, evidence, consumed] = await Promise.all([
      prisma.costFlowWorkspace.findUniqueOrThrow({ where: { projectId: project.id } }),
      prisma.excelIntakeOperationReceipt.findUniqueOrThrow({ where: { projectId_idempotencyKey: { projectId: project.id, idempotencyKey: command.idempotencyKey } } }),
      prisma.excelIntakeSourceEvidence.findUniqueOrThrow({ where: { previewSessionId: session.previewSessionId } }),
      getExcelIntakePreviewSessionView({ id: actor.id, role: "USER" }, project.id, session.previewSessionId),
    ]);
    const data = workspace.data as unknown as FinanceData;
    assert.equal(data.quotationDrafts?.[0].id, created.draftId);
    assert.equal(data.excelIntakeReceipts, undefined);
    assert.equal(receipt.linkedRecordId, created.draftId);
    assert.equal(evidence.sha256.length, 64);
    assert.equal(consumed?.state, "READ_ONLY_CONSUMED");
    assert.equal(consumed?.result?.draftId, created.draftId);
    assert.equal(consumed?.source?.filename, "source.xlsx");
  } finally {
    if (projectIds.length) {
      await prisma.excelIntakePreviewSession.updateMany({ where: { projectId: { in: projectIds } }, data: { receiptId: null } });
      await prisma.excelIntakeSourceEvidence.deleteMany({ where: { projectId: { in: projectIds } } });
      await prisma.excelIntakeOperationReceipt.deleteMany({ where: { projectId: { in: projectIds } } });
      await prisma.excelIntakePreviewSession.deleteMany({ where: { projectId: { in: projectIds } } });
      await prisma.costFlowHistory.deleteMany({ where: { projectId: { in: projectIds } } });
      await prisma.costFlowWorkspace.deleteMany({ where: { projectId: { in: projectIds } } });
      await prisma.projectMember.deleteMany({ where: { projectId: { in: projectIds } } });
      await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
    }
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  }
});

test("exact cancellation and newest-successful scope revoke stale authority", { skip: !process.env.COSTFLOW_TEST_DATABASE_URL }, async () => {
  assert.equal(process.env.COSTFLOW_TEST_DATABASE_URL, CANONICAL_URL);
  process.env.DATABASE_URL = CANONICAL_URL;
  const { prisma } = await import("../lib/prisma");
  const {
    cancelExcelIntakePreviewSession,
    confirmExcelIntake,
    createExcelIntakePreviewSession,
    createNewDraftExcelIntakePreview,
    getExcelIntakePreviewSessionView,
  } = await import("../lib/costflow/excelIntakeService");
  const prefix = `excel-revision-${randomUUID()}`;
  const projectIds: string[] = [];
  const userIds: string[] = [];
  try {
    const actor = await prisma.user.create({ data: { name: prefix, email: `${prefix}@example.test`, passwordHash: "unused", role: "ACCOUNT" } });
    const outsider = await prisma.user.create({ data: { name: `${prefix}-out`, email: `${prefix}-out@example.test`, passwordHash: "unused", role: "ACCOUNT" } });
    userIds.push(actor.id, outsider.id);
    const project = await prisma.project.create({ data: { name: prefix, ownerId: actor.id, members: { create: { userId: actor.id } } } });
    const otherProject = await prisma.project.create({ data: { name: `${prefix}-other`, ownerId: outsider.id, members: { create: { userId: outsider.id } } } });
    projectIds.push(project.id, otherProject.id);
    const preview = previewPastedIntake({
      sheet: "DATA",
      text: "LEVEL\tROW_TYPE\tPARENT_ROW\tNAME\tDESCRIPTION\tSELL_QUANTITY\tSELL_DAYS\tSELL_UNIT_PRICE\tSELL_VAT\tBUY_QUANTITY\tBUY_DAYS\tBUY_UNIT_PRICE\tBUY_VAT\n+1\tITEM\t\tA\t\t1\t1\t100\t0\t1\t1\t50\t0",
    });

    const cancelledA = await createNewDraftExcelIntakePreview({ id: actor.id, role: "ACCOUNT" }, {
      projectId: project.id, preview, sourceKind: "PASTE", sourceRevision: 1, sourceText: "A",
    });
    await assert.rejects(() => cancelExcelIntakePreviewSession({ id: outsider.id, role: "ACCOUNT" }, project.id, cancelledA.previewSessionId), /không tìm thấy|quyền/i);
    await assert.rejects(() => cancelExcelIntakePreviewSession({ id: actor.id, role: "ACCOUNT" }, otherProject.id, cancelledA.previewSessionId), /không tìm thấy|quyền/i);
    const cancelled = await cancelExcelIntakePreviewSession({ id: actor.id, role: "ACCOUNT" }, project.id, cancelledA.previewSessionId);
    assert.equal(cancelled.state, "NON_ACTIONABLE_CANCELLED");
    assert.equal((await cancelExcelIntakePreviewSession({ id: actor.id, role: "ACCOUNT" }, project.id, cancelledA.previewSessionId)).state, "NON_ACTIONABLE_CANCELLED");
    const cancelledRow = await prisma.excelIntakePreviewSession.findUniqueOrThrow({ where: { id: cancelledA.previewSessionId } });
    assert.equal(cancelledRow.canonicalPayload, null);
    assert.equal(cancelledRow.displayPayload, null);
    assert.equal(cancelledRow.sourceBytes, null);

    const before = await Promise.all([
      prisma.costFlowWorkspace.count({ where: { projectId: project.id } }),
      prisma.costFlowHistory.count({ where: { projectId: project.id } }),
      prisma.excelIntakeOperationReceipt.count({ where: { projectId: project.id } }),
      prisma.excelIntakeSourceEvidence.count({ where: { projectId: project.id } }),
    ]);
    await assert.rejects(() => confirmExcelIntake({ id: actor.id, role: "ACCOUNT" }, {
      projectId: project.id, previewSessionId: cancelledA.previewSessionId, expectedVersion: 0,
      idempotencyKey: `${prefix}:cancelled`, corrections: {}, decimalResolutions: {},
    }), /không còn hiệu lực/i);
    assert.deepEqual(await Promise.all([
      prisma.costFlowWorkspace.count({ where: { projectId: project.id } }),
      prisma.costFlowHistory.count({ where: { projectId: project.id } }),
      prisma.excelIntakeOperationReceipt.count({ where: { projectId: project.id } }),
      prisma.excelIntakeSourceEvidence.count({ where: { projectId: project.id } }),
    ]), before);
    // A replacement parse can fail before session creation; explicit cancellation is final.
    await assert.rejects(async () => { throw new Error("B parse failed"); }, /B parse failed/);
    assert.equal((await getExcelIntakePreviewSessionView({ id: actor.id, role: "ACCOUNT" }, project.id, cancelledA.previewSessionId)).state, "NON_ACTIONABLE_CANCELLED");

    const activeA = await createNewDraftExcelIntakePreview({ id: actor.id, role: "ACCOUNT" }, {
      projectId: project.id, preview, sourceKind: "PASTE", sourceRevision: 2, sourceText: "active-A",
    });
    // A failed preview without explicit cancellation creates no session and leaves A actionable.
    await assert.rejects(async () => { throw new Error("B parse failed"); }, /B parse failed/);
    assert.equal((await getExcelIntakePreviewSessionView({ id: actor.id, role: "ACCOUNT" }, project.id, activeA.previewSessionId)).state, "ACTIONABLE");
    const activeB = await createNewDraftExcelIntakePreview({ id: actor.id, role: "ACCOUNT" }, {
      projectId: project.id, preview, sourceKind: "PASTE", sourceRevision: 3, sourceText: "active-B",
    });
    assert.equal((await getExcelIntakePreviewSessionView({ id: actor.id, role: "ACCOUNT" }, project.id, activeA.previewSessionId)).state, "NON_ACTIONABLE_SUPERSEDED");
    assert.equal((await getExcelIntakePreviewSessionView({ id: actor.id, role: "ACCOUNT" }, project.id, activeB.previewSessionId)).state, "ACTIONABLE");

    const sessionSeed = { projectId: project.id, actorId: actor.id, operationKind: "ROUND_TRIP" as const, sourceKind: "XLSX" as const, sourceRevision: 1, sourceSha256: "a".repeat(64), sourceFilename: "round-trip.xlsx", sourceBytes: Buffer.from("PK"), canonicalFingerprint: "b".repeat(64), canonicalPayload: { ok: true }, displayPayload: { ok: true } };
    const [draftOneA, draftTwoA] = await prisma.$transaction(async tx => [
      await createExcelIntakePreviewSession(tx, { ...sessionSeed, draftId: `${prefix}-draft-1` }),
      await createExcelIntakePreviewSession(tx, { ...sessionSeed, draftId: `${prefix}-draft-2` }),
    ]);
    const draftOneB = await prisma.$transaction(tx => createExcelIntakePreviewSession(tx, { ...sessionSeed, sourceRevision: 2, draftId: `${prefix}-draft-1` }));
    assert.equal((await prisma.excelIntakePreviewSession.findUniqueOrThrow({ where: { id: draftOneA.id } })).status, "SUPERSEDED");
    assert.equal((await prisma.excelIntakePreviewSession.findUniqueOrThrow({ where: { id: draftOneB.id } })).status, "ACTIVE");
    assert.equal((await prisma.excelIntakePreviewSession.findUniqueOrThrow({ where: { id: draftTwoA.id } })).status, "ACTIVE");
  } finally {
    if (projectIds.length) {
      await prisma.excelIntakePreviewSession.updateMany({ where: { projectId: { in: projectIds } }, data: { receiptId: null } });
      await prisma.excelIntakeSourceEvidence.deleteMany({ where: { projectId: { in: projectIds } } });
      await prisma.excelIntakeOperationReceipt.deleteMany({ where: { projectId: { in: projectIds } } });
      await prisma.excelIntakePreviewSession.deleteMany({ where: { projectId: { in: projectIds } } });
      await prisma.costFlowHistory.deleteMany({ where: { projectId: { in: projectIds } } });
      await prisma.costFlowWorkspace.deleteMany({ where: { projectId: { in: projectIds } } });
      await prisma.projectMember.deleteMany({ where: { projectId: { in: projectIds } } });
      await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
    }
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  }
});
