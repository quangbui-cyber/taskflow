import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { ProjectUpload } from "@/lib/projectFiles";
import {
  actualCostEvidenceWarnings,
  calculateActualCost,
  nextActualCostVersion,
  normalizeActualCostEvidenceKind,
  normalizeActualCostFundingSource,
  validateUnbudgetedActualCost,
  validateActualCostDecision,
  type ActualCostDecisionAction,
  type ActualCostEvidenceKind,
  type ActualCostSourceKind,
} from "./actualCost";
import type { FinanceData } from "./types";

export type ActualCostActor = { id: string; role: string };

export type ActualCostCommand =
  | {
      command: "CREATE_AND_SUBMIT";
      projectId: string;
      stableLineId: string;
      sourceKind?: ActualCostSourceKind;
      revisionId?: string;
      icLineId?: string;
      recipientKey: string;
      description: string;
      reason?: string;
      fundingSource: string;
      quantity: string;
      days: string;
      unitPrice: string;
      unit?: string;
      basis?: "NET" | "GROSS";
      vatPercent?: string;
      evidenceIds?: string[];
      billable?: boolean;
      saleQuantity?: string;
      saleDays?: string;
      saleUnitPrice?: string;
    }
  | {
      command: "RESUBMIT";
      projectId: string;
      lineId: string;
      expectedVersion: number;
      description: string;
      fundingSource: string;
      quantity: string;
      days: string;
      unitPrice: string;
    }
  | {
      command: "DECIDE";
      projectId: string;
      lineId: string;
      version: number;
      action: ActualCostDecisionAction;
      reason: string;
      reviewToken?: string;
      acknowledgeMissingEvidence?: boolean;
    };

function required(value: string, label: string) {
  const normalized = value.trim();
  if (!normalized) throw new Error(`Thiếu ${label}.`);
  return normalized;
}

async function assertProjectActor(tx: Prisma.TransactionClient, projectId: string, actor: ActualCostActor) {
  const activeActor = await tx.user.findFirst({ where: { id: actor.id, isActive: true }, select: { id: true, role: true } });
  if (!activeActor) throw new Error("Tài khoản không còn hoạt động.");
  const project = await tx.project.findUnique({ where: { id: projectId }, select: { id: true, ownerId: true, members: { select: { userId: true } } } });
  if (!project) throw new Error("Project không tồn tại.");
  const member = project.members.some(item => item.userId === activeActor.id);
  const isDd = !!await tx.workflowRoleGrant.findFirst({ where: { userId: activeActor.id, role: "AC_DD", revokedAt: null }, select: { id: true } });
  if (!member && activeActor.role !== "ADMIN" && !isDd) throw new Error("Bạn không có quyền trên Project này.");
  return { actor: activeActor, project, member, isDd };
}

async function resolveIcSource(tx: Prisma.TransactionClient, projectId: string, revisionId: string, icLineId: string) {
  const workspace = await tx.costFlowWorkspace.findUnique({ where: { projectId }, select: { data: true } });
  const data = workspace?.data as unknown as FinanceData | undefined;
  const revision = data?.revisions.find(item => item.id === revisionId && item.effective);
  const line = revision?.lines.find(item => item.id === icLineId);
  if (!revision || !line) throw new Error("Dòng AC phải tham chiếu đúng dòng IC hiệu lực của Project.");
  return {
    revisionId: revision.id,
    revisionNumber: revision.number,
    lineId: line.id,
    description: line.description,
    unit: line.unit,
    quantity: line.quantity,
    days: line.days,
    unitPrice: line.unitPrice,
    basis: line.basis,
    vatPercent: line.vatPercent,
    cost: line.cost,
    parameterBinding: line.parameterBinding ?? null,
  };
}

async function assertRecipient(tx: Prisma.TransactionClient, projectId: string, recipientKey: string) {
  if (recipientKey.startsWith("USER:")) {
    const userId = recipientKey.slice(5);
    const member = await tx.projectMember.findUnique({ where: { projectId_userId: { projectId, userId } }, select: { user: { select: { isActive: true } } } });
    if (!member?.user.isActive) throw new Error("Người nhận phải là thành viên đang hoạt động của Project.");
    return recipientKey;
  }
  if (recipientKey.startsWith("VENDOR:")) {
    const workspace = await tx.costFlowWorkspace.findUnique({ where: { projectId }, select: { data: true } });
    const data = workspace?.data as unknown as FinanceData | undefined;
    if (!data?.beneficiaries.some(item => `VENDOR:${item.id}` === recipientKey)) throw new Error("NCC phải thuộc đúng Project.");
    return recipientKey;
  }
  throw new Error("Chọn người nhận hoặc NCC hợp lệ.");
}

export async function executeActualCostCommand(
  actor: ActualCostActor,
  command: ActualCostCommand,
  options: { notify?: (input: { userId: string; message: string; projectId: string; dedupeKey: string }) => Promise<void> } = {},
) {
  const result = await prisma.$transaction(async tx => {
    const context = await assertProjectActor(tx, command.projectId, actor);

    if (command.command === "CREATE_AND_SUBMIT") {
      if (!context.member) throw new Error("Chỉ thành viên Project được lập AC.");
      const sourceKind = command.sourceKind ?? "IC_LINKED";
      if (sourceKind !== "IC_LINKED" && sourceKind !== "UNBUDGETED") throw new Error("Nguồn AC không hợp lệ.");
      const recipientKey = await assertRecipient(tx, command.projectId, required(command.recipientKey, "người nhận"));
      let sourceSnapshot: Record<string, unknown>;
      let revisionId: string | null = null;
      let icLineId: string | null = null;
      let unit: string;
      let basis: "NET" | "GROSS";
      let vatPercent: string;
      let fundingSource: ReturnType<typeof normalizeActualCostFundingSource>;
      let billable = false;
      let saleSnapshot: { quantity: string; days: string; unitPrice: string } | null = null;
      let evidenceLinks: { evidenceId: string; kind: ActualCostEvidenceKind }[] = [];
      if (sourceKind === "IC_LINKED") {
        const icSource = await resolveIcSource(tx, command.projectId, required(command.revisionId ?? "", "phiên bản IC"), required(command.icLineId ?? "", "dòng IC"));
        sourceSnapshot = structuredClone(icSource) as unknown as Record<string, unknown>;
        revisionId = icSource.revisionId;
        icLineId = icSource.lineId;
        unit = icSource.unit;
        basis = icSource.basis;
        vatPercent = icSource.vatPercent;
        fundingSource = normalizeActualCostFundingSource(command.fundingSource);
      } else {
        const validated = validateUnbudgetedActualCost({
          ...command,
          reason: command.reason ?? "",
          unit: command.unit ?? "",
          evidenceIds: command.evidenceIds ?? [],
          billable: command.billable ?? false,
        });
        const evidence = await tx.costFlowEvidence.findMany({ where: { projectId: command.projectId, id: { in: validated.evidenceIds } }, select: { id: true, kind: true } });
        if (evidence.length !== validated.evidenceIds.length) throw new Error("Chứng từ AC phải thuộc đúng Project.");
        evidenceLinks = evidence.map(item => ({ evidenceId: item.id, kind: normalizeActualCostEvidenceKind(item.kind) }));
        sourceSnapshot = { sourceKind, reason: validated.reason };
        unit = validated.unit;
        basis = command.basis ?? "GROSS";
        vatPercent = command.vatPercent ?? "0";
        fundingSource = validated.fundingSource;
        billable = validated.billable;
        saleSnapshot = validated.saleSnapshot;
      }
      const calculated = calculateActualCost({ ...command, basis, vatPercent });
      const line = await tx.actualCostLine.create({
        data: {
          projectId: command.projectId,
          stableLineId: required(command.stableLineId, "mã dòng ổn định"),
          sourceKind,
          icRevisionId: revisionId,
          icLineId,
          recipientKey,
          createdById: context.actor.id,
          currentVersion: 1,
          versions: {
            create: {
              projectId: command.projectId,
              version: 1,
              state: "SUBMITTED",
              description: required(command.description, "nội dung AC"),
              fundingSource,
              quantity: command.quantity,
              days: command.days,
              unitPrice: command.unitPrice,
              unit,
              basis,
              vatPercent,
              amount: calculated.amount,
              rawAmount: calculated.rawAmount,
              sourceSnapshot: sourceSnapshot as unknown as Prisma.InputJsonValue,
              billable,
              saleSnapshot: saleSnapshot as Prisma.InputJsonValue ?? undefined,
              createdById: context.actor.id,
              submittedAt: new Date(),
              evidenceLinks: evidenceLinks.length ? {
                create: evidenceLinks.map(link => ({ projectId: command.projectId, evidenceId: link.evidenceId, kind: link.kind, actorId: context.actor.id })),
              } : undefined,
            },
          },
        },
        include: { versions: true },
      });
      const version = line.versions[0];
      const dd = await tx.workflowRoleGrant.findFirst({ where: { role: "AC_DD", revokedAt: null, user: { isActive: true } }, select: { userId: true } });
      return { lineId: line.id, versionId: version.id, version: 1, amount: version.amount, notificationUserId: dd?.userId ?? null, notificationMessage: "Có AC mới chờ DD xem xét." };
    }

    const line = await tx.actualCostLine.findFirst({
      where: { id: command.lineId, projectId: command.projectId },
      include: { versions: { orderBy: { version: "desc" }, take: 1, include: { approvals: true, evidenceLinks: true } } },
    });
    if (!line || !line.versions[0]) throw new Error("Không tìm thấy AC trong Project này.");
    const current = line.versions[0];

    if (command.command === "RESUBMIT") {
      if (!context.member || line.createdById !== context.actor.id) throw new Error("Chỉ người lập AC trong Project được gửi lại.");
      if (await tx.actualCostApplication.count({ where: { lineId: line.id, state: "ACTIVE", request: { state: { notIn: ["WITHDRAWN", "REJECTED", "CANCELLED"] } } } })) throw new Error("AC đang được hồ sơ thanh toán/hoàn ứng sử dụng và đã bị khóa.");
      if (command.expectedVersion !== line.currentVersion) throw new Error("Phiên bản đã thay đổi. Tải lại trước khi gửi lại.");
      const nextVersion = nextActualCostVersion(line.currentVersion, current.state);
      const fundingSource = normalizeActualCostFundingSource(command.fundingSource);
      const basis = current.basis === "NET" ? "NET" : "GROSS";
      const calculated = calculateActualCost({ ...command, basis, vatPercent: current.vatPercent });
      const version = await tx.actualCostVersion.create({
        data: {
          projectId: command.projectId,
          lineId: line.id,
          version: nextVersion,
          state: "SUBMITTED",
          description: required(command.description, "nội dung AC"),
          fundingSource,
          quantity: command.quantity,
          days: command.days,
          unitPrice: command.unitPrice,
          unit: current.unit,
          basis: current.basis,
          vatPercent: current.vatPercent,
          amount: calculated.amount,
          rawAmount: calculated.rawAmount,
          sourceSnapshot: current.sourceSnapshot ?? undefined,
          billable: current.billable,
          saleSnapshot: current.saleSnapshot ?? undefined,
          createdById: context.actor.id,
          submittedAt: new Date(),
          evidenceLinks: current.evidenceLinks.length ? {
            create: current.evidenceLinks.map(link => ({ projectId: command.projectId, evidenceId: link.evidenceId, kind: link.kind, actorId: context.actor.id })),
          } : undefined,
        },
      });
      const updated = await tx.actualCostLine.updateMany({ where: { id: line.id, projectId: command.projectId, currentVersion: command.expectedVersion }, data: { currentVersion: nextVersion } });
      if (updated.count !== 1) throw new Error("Phiên bản đã thay đổi. Tải lại trước khi gửi lại.");
      const dd = await tx.workflowRoleGrant.findFirst({ where: { role: "AC_DD", revokedAt: null, user: { isActive: true } }, select: { userId: true } });
      return { lineId: line.id, versionId: version.id, version: nextVersion, amount: version.amount, notificationUserId: dd?.userId ?? null, notificationMessage: "AC đã được gửi lại cho DD." };
    }

    const activeDd = await tx.workflowRoleGrant.findMany({ where: { role: "AC_DD", revokedAt: null, user: { isActive: true } }, select: { userId: true } });
    if (!["APPROVED", "RETURNED"].includes(command.action)) throw new Error("Quyết định AC không hợp lệ.");
    const decision = validateActualCostDecision({
      action: command.action,
      actorId: context.actor.id,
      activeDdIds: activeDd.map(item => item.userId),
      expectedVersion: command.version,
      currentVersion: line.currentVersion,
      reason: command.reason,
    });
    if (current.version !== command.version) throw new Error("Phiên bản đã thay đổi. Tải lại trước khi quyết định.");
    if (command.reviewToken !== `${current.id}:${current.version}`) throw new Error("Phiên bản xem xét không còn hợp lệ. Tải lại trước khi quyết định.");
    if (current.state !== "SUBMITTED" || current.approvals.length) throw new Error("Phiên bản AC đã được quyết định.");
    const warningCodes = actualCostEvidenceWarnings(current.evidenceLinks.map(link => link.kind));
    if (decision.action === "APPROVED" && warningCodes.length && !command.acknowledgeMissingEvidence) {
      throw new Error("DD phải xác nhận rõ việc duyệt dù còn thiếu chứng từ.");
    }
    const attemptId = randomUUID();
    const updated = await tx.actualCostVersion.updateMany({ where: { id: current.id, projectId: command.projectId, state: "SUBMITTED" }, data: { state: decision.action } });
    if (updated.count !== 1) throw new Error("Phiên bản AC đã được quyết định.");
    const approval = await tx.actualCostApproval.create({
      data: {
        projectId: command.projectId,
        lineId: line.id,
        versionId: current.id,
        attemptId,
        retryKey: `${current.id}:${decision.action}`,
        action: decision.action,
        actorId: context.actor.id,
        reason: decision.reason,
        warningCodes,
      },
    });
    return {
      lineId: line.id,
      versionId: current.id,
      approvalId: approval.id,
      approvalAttemptId: attemptId,
      version: current.version,
      amount: current.amount,
      action: decision.action,
      notificationUserId: line.createdById,
      notificationMessage: decision.action === "APPROVED" ? "AC đã được DD duyệt." : "AC đã được DD trả lại để chỉnh sửa.",
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 });

  if (result.notificationUserId) {
    const notification = {
      dedupeKey: `actual-cost:${result.lineId}:${result.version}:${result.action ?? "SUBMITTED"}`,
      userId: result.notificationUserId,
      message: result.notificationMessage,
      projectId: command.projectId,
    };
    await (options.notify
      ? options.notify(notification)
      : prisma.notification.create({ data: { ...notification, type: "costflow" } }).then(() => undefined)
    ).catch(() => undefined);
  }
  return {
    lineId: result.lineId,
    versionId: result.versionId,
    version: result.version,
    amount: result.amount,
    ...("approvalId" in result ? { approvalId: result.approvalId, approvalAttemptId: result.approvalAttemptId, action: result.action } : {}),
  };
}

export async function attachActualCostEvidence(
  actor: ActualCostActor,
  input: { projectId: string; lineId: string; expectedVersion: number; kind: ActualCostEvidenceKind },
  uploads: ProjectUpload[],
) {
  if (!uploads.length || uploads.length > 10) throw new Error("Chọn từ 1 đến 10 file chứng từ.");
  return prisma.$transaction(async tx => {
    const context = await assertProjectActor(tx, input.projectId, actor);
    if (!context.member && !context.isDd) throw new Error("Bạn không có quyền bổ sung chứng từ AC.");
    const line = await tx.actualCostLine.findFirst({
      where: { id: input.lineId, projectId: input.projectId },
      include: { versions: { where: { version: input.expectedVersion }, include: { evidenceLinks: true }, take: 1 } },
    });
    const current = line?.versions[0];
    if (!line || !current || line.currentVersion !== input.expectedVersion) throw new Error("Phiên bản AC đã thay đổi. Tải lại trước khi bổ sung chứng từ.");
    if (await tx.actualCostApplication.count({ where: { lineId: line.id, state: "ACTIVE", request: { state: { notIn: ["WITHDRAWN", "REJECTED", "CANCELLED"] } } } })) throw new Error("AC đang được hồ sơ thanh toán/hoàn ứng sử dụng và đã bị khóa.");
    const evidence = await Promise.all(uploads.map(upload => tx.costFlowEvidence.create({
      data: {
        projectId: input.projectId,
        sourceFileId: `actual-cost-upload:${randomUUID()}`,
        kind: input.kind,
        name: upload.name,
        mimeType: upload.mimeType,
        data: upload.data,
        sha256: createHash("sha256").update(upload.data).digest("hex"),
        createdBy: context.actor.id,
      },
      select: { id: true, kind: true, name: true, mimeType: true, sha256: true, createdAt: true },
    })));
    const nextVersion = line.currentVersion + 1;
    const version = await tx.actualCostVersion.create({
      data: {
        projectId: input.projectId,
        lineId: line.id,
        version: nextVersion,
        state: current.state === "RETURNED" ? "RETURNED" : "SUBMITTED",
        description: current.description,
        fundingSource: current.fundingSource,
        quantity: current.quantity,
        days: current.days,
        unitPrice: current.unitPrice,
        unit: current.unit,
        basis: current.basis,
        vatPercent: current.vatPercent,
        amount: current.amount,
        rawAmount: current.rawAmount,
        sourceSnapshot: current.sourceSnapshot ?? undefined,
        billable: current.billable,
        saleSnapshot: current.saleSnapshot ?? undefined,
        createdById: context.actor.id,
        submittedAt: current.state === "RETURNED" ? null : new Date(),
        evidenceLinks: {
          create: [
            ...current.evidenceLinks.map(link => ({ projectId: input.projectId, evidenceId: link.evidenceId, kind: link.kind, actorId: link.actorId })),
            ...evidence.map(item => ({ projectId: input.projectId, evidenceId: item.id, kind: input.kind, actorId: context.actor.id })),
          ],
        },
      },
    });
    const updated = await tx.actualCostLine.updateMany({ where: { id: line.id, projectId: input.projectId, currentVersion: input.expectedVersion }, data: { currentVersion: nextVersion } });
    if (updated.count !== 1) throw new Error("Phiên bản AC đã thay đổi. Tải lại trước khi bổ sung chứng từ.");
    return { lineId: line.id, versionId: version.id, version: nextVersion, evidence };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 });
}

export async function findActualCostEvidenceForActor(projectId: string, evidenceId: string, actor: ActualCostActor) {
  const active = await prisma.user.findFirst({ where: { id: actor.id, isActive: true }, select: { id: true, role: true } });
  if (!active) return null;
  const [member, dd, evidence] = await Promise.all([
    prisma.projectMember.findUnique({ where: { projectId_userId: { projectId, userId: actor.id } }, select: { userId: true } }),
    prisma.workflowRoleGrant.findFirst({ where: { userId: actor.id, role: "AC_DD", revokedAt: null }, select: { id: true } }),
    prisma.costFlowEvidence.findFirst({
      where: { id: evidenceId, projectId },
      select: {
        id: true, name: true, mimeType: true, data: true,
        actualCostLinks: { where: { projectId, version: { line: { projectId } } }, select: { id: true }, take: 1 },
        request: { select: { creatorId: true, cashAssigneeId: true, steps: true, readers: { where: { userId: actor.id }, select: { id: true }, take: 1 } } },
      },
    }),
  ]);
  if (!evidence) return null;
  const steps = Array.isArray(evidence.request?.steps) ? evidence.request.steps : [];
  const assigned = !!evidence.request && (
    evidence.request.creatorId === actor.id || evidence.request.cashAssigneeId === actor.id || evidence.request.readers.length > 0 ||
    steps.some(step => !!step && typeof step === "object" && "assigneeId" in step && step.assigneeId === actor.id)
  );
  if (!member && !dd && active.role !== "ADMIN" && !assigned) return null;
  return { id: evidence.id, name: evidence.name, mimeType: evidence.mimeType, data: evidence.data };
}
