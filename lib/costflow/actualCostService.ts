import "server-only";

import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  calculateActualCost,
  nextActualCostVersion,
  normalizeActualCostFundingSource,
  validateActualCostDecision,
  type ActualCostDecisionAction,
} from "./actualCost";
import type { FinanceData } from "./types";

export type ActualCostActor = { id: string; role: string };

export type ActualCostCommand =
  | {
      command: "CREATE_AND_SUBMIT";
      projectId: string;
      stableLineId: string;
      revisionId: string;
      icLineId: string;
      recipientKey: string;
      description: string;
      fundingSource: string;
      quantity: string;
      days: string;
      unitPrice: string;
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
  if (!member && activeActor.role !== "ADMIN") throw new Error("Bạn không có quyền trên Project này.");
  return { actor: activeActor, project, member };
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

export async function executeActualCostCommand(actor: ActualCostActor, command: ActualCostCommand) {
  const result = await prisma.$transaction(async tx => {
    const context = await assertProjectActor(tx, command.projectId, actor);

    if (command.command === "CREATE_AND_SUBMIT") {
      if (!context.member) throw new Error("Chỉ thành viên Project được lập AC.");
      const sourceSnapshot = await resolveIcSource(tx, command.projectId, required(command.revisionId, "phiên bản IC"), required(command.icLineId, "dòng IC"));
      const recipientKey = await assertRecipient(tx, command.projectId, required(command.recipientKey, "người nhận"));
      const fundingSource = normalizeActualCostFundingSource(command.fundingSource);
      const calculated = calculateActualCost(command);
      const line = await tx.actualCostLine.create({
        data: {
          projectId: command.projectId,
          stableLineId: required(command.stableLineId, "mã dòng ổn định"),
          sourceKind: "IC_LINKED",
          icRevisionId: sourceSnapshot.revisionId,
          icLineId: sourceSnapshot.lineId,
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
              unit: sourceSnapshot.unit,
              amount: calculated.amount,
              rawAmount: calculated.rawAmount,
              sourceSnapshot: sourceSnapshot as unknown as Prisma.InputJsonValue,
              createdById: context.actor.id,
              submittedAt: new Date(),
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
      include: { versions: { orderBy: { version: "desc" }, take: 1, include: { approvals: true } } },
    });
    if (!line || !line.versions[0]) throw new Error("Không tìm thấy AC trong Project này.");
    const current = line.versions[0];

    if (command.command === "RESUBMIT") {
      if (!context.member || line.createdById !== context.actor.id) throw new Error("Chỉ người lập AC trong Project được gửi lại.");
      if (command.expectedVersion !== line.currentVersion) throw new Error("Phiên bản đã thay đổi. Tải lại trước khi gửi lại.");
      const nextVersion = nextActualCostVersion(line.currentVersion, current.state);
      const fundingSource = normalizeActualCostFundingSource(command.fundingSource);
      const calculated = calculateActualCost(command);
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
    if (current.state !== "SUBMITTED" || current.approvals.length) throw new Error("Phiên bản AC đã được quyết định.");
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
    await prisma.notification.create({
      data: {
        dedupeKey: `actual-cost:${result.lineId}:${result.version}:${result.action ?? "SUBMITTED"}`,
        userId: result.notificationUserId,
        type: "costflow",
        message: result.notificationMessage,
        projectId: command.projectId,
      },
    }).catch(() => undefined);
  }
  return {
    lineId: result.lineId,
    versionId: result.versionId,
    version: result.version,
    amount: result.amount,
    ...("approvalId" in result ? { approvalId: result.approvalId, approvalAttemptId: result.approvalAttemptId, action: result.action } : {}),
  };
}
