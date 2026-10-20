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
  validateActualCostFundingAllocations,
  type ActualCostDecisionAction,
  type ActualCostEvidenceKind,
  type ActualCostFundingAllocation,
  type ActualCostInternalStatus,
  type ActualCostSourceKind,
} from "./actualCost";
import type { FinanceData } from "./types";
import { resolveSupplierRecipient } from "./supplierReadModel";
import {
  assertActualCostDraftMutationVersion,
  buildActualCostDraftManifest,
  cloneReturnedActualCostRevision,
  ensureActualCostDraft,
  persistActualCostManifest,
  recordActualCostSheetEvent,
} from "./actualCostSheet";

export type ActualCostActor = { id: string; role: string };
export type ActualCostBulkSelection = { lineId: string; version: number; reviewToken: string };
type ActualCostCommandResult = {
  success?: string;
  lineId?: string;
  version?: number;
  revisionId?: string;
  action?: string;
  notificationUserId?: string | null;
  notificationMessage?: string;
  [key: string]: unknown;
};

export type ActualCostCommand =
  | {
      command: "CREATE_SUCCESSOR";
      projectId: string;
      revisionId: string;
      expectedMutationVersion: number;
    }
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
      command: "SAVE_LINE";
      projectId: string;
      lineId?: string;
      sourceKind?: ActualCostSourceKind;
      revisionId?: string;
      icLineId?: string;
      recipientKey: string;
      description: string;
      reason?: string;
      fundingSource: string;
      fundingAllocations?: ActualCostFundingAllocation[];
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
      internalStatus?: ActualCostInternalStatus;
      accountNote?: string;
      sheetRevisionId?: string;
      expectedMutationVersion?: number;
    }
  | {
      command: "SAVE_LINES";
      projectId: string;
      revisionId: string;
      sheetRevisionId?: string;
      expectedMutationVersion?: number;
      lines: Array<Omit<Extract<ActualCostCommand, { command: "SAVE_LINE" }>, "command" | "projectId" | "revisionId" | "sheetRevisionId" | "expectedMutationVersion" | "lineId">>;
    }
  | {
      command: "DELETE_LINE";
      projectId: string;
      lineId: string;
      revisionId: string;
      expectedMutationVersion: number;
      restore?: boolean;
    }
  | {
      command: "UPDATE_LINE_STATUS";
      projectId: string;
      lineId: string;
      internalStatus: ActualCostInternalStatus;
      accountNote?: string;
      revisionId: string;
      expectedMutationVersion: number;
    }
  | {
      command: "UPDATE_LINES_STATUS";
      projectId: string;
      lineIds: string[];
      internalStatus: ActualCostInternalStatus;
      revisionId: string;
      expectedMutationVersion: number;
    }
  | {
      command: "SUBMIT_SHEET";
      projectId: string;
      note?: string;
      missingEvidenceExplanation?: string;
      overBudgetExplanation?: string;
      revisionId: string;
      expectedMutationVersion: number;
    }
  | {
      command: "DECIDE_SHEET";
      projectId: string;
      action: ActualCostDecisionAction;
      reason: string;
      lineNotes?: Record<string, string>;
      acknowledgeMissingEvidence?: boolean;
      revisionId: string;
      manifestHash: string;
      expectedMutationVersion: number;
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
  const isAccount = activeActor.role === "ADMIN" || (member && (activeActor.role === "ACCOUNT" || project.ownerId === activeActor.id));
  return { actor: activeActor, project, member, isDd, isAccount };
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
    const supplier = await resolveSupplierRecipient(tx, projectId, recipientKey);
    if (!supplier) throw new Error("Không tìm thấy NCC legacy hoặc NCC không còn hoạt động.");
    return supplier.recipientKey;
  }
  if (recipientKey.startsWith("SUPPLIER:")) {
    const supplier = await resolveSupplierRecipient(tx, projectId, recipientKey);
    if (!supplier) throw new Error("NCC hoặc tài khoản ngân hàng không còn hoạt động.");
    return supplier.recipientKey;
  }
  throw new Error("Chọn người nhận hoặc NCC hợp lệ.");
}

export async function executeActualCostCommand(
  actor: ActualCostActor,
  command: Extract<ActualCostCommand, { command: "CREATE_SUCCESSOR" }>,
  options?: { notify?: (input: { userId: string; message: string; projectId: string; dedupeKey: string }) => Promise<void> },
): Promise<{ revisionId: string; success: string }>;

export async function executeActualCostCommand(
  actor: ActualCostActor,
  command: Extract<ActualCostCommand, { command: "CREATE_AND_SUBMIT" }>,
  options?: { notify?: (input: { userId: string; message: string; projectId: string; dedupeKey: string }) => Promise<void> },
): Promise<{ lineId: string; versionId: string; version: number; amount: string; notificationUserId: string | null; notificationMessage: string }>;

export async function executeActualCostCommand(
  actor: ActualCostActor,
  command: Extract<ActualCostCommand, { command: "SAVE_LINE" }>,
  options?: { notify?: (input: { userId: string; message: string; projectId: string; dedupeKey: string }) => Promise<void> },
): Promise<{ lineId: string; versionId: string; version?: number; amount: string; success: string }>;

export async function executeActualCostCommand(
  actor: ActualCostActor,
  command: Extract<ActualCostCommand, { command: "SAVE_LINES" }>,
  options?: { notify?: (input: { userId: string; message: string; projectId: string; dedupeKey: string }) => Promise<void> },
): Promise<{ lineIds: string[]; success: string }>;

export async function executeActualCostCommand(
  actor: ActualCostActor,
  command: Extract<ActualCostCommand, { command: "DELETE_LINE" }>,
  options?: { notify?: (input: { userId: string; message: string; projectId: string; dedupeKey: string }) => Promise<void> },
): Promise<{ lineId: string; success: string }>;

export async function executeActualCostCommand(
  actor: ActualCostActor,
  command: Extract<ActualCostCommand, { command: "UPDATE_LINE_STATUS" }>,
  options?: { notify?: (input: { userId: string; message: string; projectId: string; dedupeKey: string }) => Promise<void> },
): Promise<{ lineId: string; versionId: string; success: string }>;

export async function executeActualCostCommand(
  actor: ActualCostActor,
  command: Extract<ActualCostCommand, { command: "SUBMIT_SHEET" }>,
  options?: { notify?: (input: { userId: string; message: string; projectId: string; dedupeKey: string }) => Promise<void> },
): Promise<{ success: string; notificationUserId: string; notificationMessage: string }>;

export async function executeActualCostCommand(
  actor: ActualCostActor,
  command: Extract<ActualCostCommand, { command: "DECIDE_SHEET" }>,
  options?: { notify?: (input: { userId: string; message: string; projectId: string; dedupeKey: string }) => Promise<void> },
): Promise<{ action: ActualCostDecisionAction; success: string; notificationUserId: string | null; notificationMessage: string }>;

export async function executeActualCostCommand(
  actor: ActualCostActor,
  command: Extract<ActualCostCommand, { command: "RESUBMIT" }>,
  options?: { notify?: (input: { userId: string; message: string; projectId: string; dedupeKey: string }) => Promise<void> },
): Promise<{ lineId: string; versionId: string; version: number; amount: string; notificationUserId: string | null; notificationMessage: string }>;

export async function executeActualCostCommand(
  actor: ActualCostActor,
  command: Extract<ActualCostCommand, { command: "DECIDE" }>,
  options?: { notify?: (input: { userId: string; message: string; projectId: string; dedupeKey: string }) => Promise<void> },
): Promise<{ lineId: string; versionId: string; version: number; amount: string; action: string; notificationUserId: string | null; notificationMessage: string }>;

export async function executeActualCostCommand(
  actor: ActualCostActor,
  command: ActualCostCommand,
  options?: { notify?: (input: { userId: string; message: string; projectId: string; dedupeKey: string }) => Promise<void> },
): Promise<ActualCostCommandResult>;

export async function executeActualCostCommand(
  actor: ActualCostActor,
  command: ActualCostCommand,
  options: { notify?: (input: { userId: string; message: string; projectId: string; dedupeKey: string }) => Promise<void> } = {},
): Promise<ActualCostCommandResult> {
  if (["CREATE_AND_SUBMIT", "RESUBMIT", "DECIDE"].includes(command.command)) {
    throw new Error("Bảng AC chỉ được gửi, duyệt hoặc trả lại toàn bộ; thao tác duyệt từng khoản đã ngừng sử dụng.");
  }
  const result = await prisma.$transaction(async tx => {
    const context = await assertProjectActor(tx, command.projectId, actor);

    if (command.command === "CREATE_SUCCESSOR") {
      if (!context.isAccount) throw new Error("Chỉ Account dự án được tạo phiên bản Bảng AC gửi lại.");
      const returned = await tx.actualCostSheetRevision.findFirst({
        where: { id: command.revisionId, projectId: command.projectId, state: "RETURNED" },
        include: { sheet: { select: { currentRevision: true } } },
      });
      if (!returned || returned.revision !== returned.sheet.currentRevision || returned.mutationVersion !== command.expectedMutationVersion) {
        throw new Error("Bảng AC đã thay đổi. Vui lòng tải lại trước khi tạo phiên bản gửi lại.");
      }
      const draft = await cloneReturnedActualCostRevision(tx, {
        projectId: command.projectId,
        returnedRevisionId: returned.id,
        actorId: context.actor.id,
      });
      return { revisionId: draft.id, success: `Đã tạo Bảng AC-R${draft.revision} để chỉnh sửa và gửi lại toàn bộ.` };
    }

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

    if (command.command === "SAVE_LINE" || command.command === "SAVE_LINES") {
      const saveOne = async (command: Extract<ActualCostCommand, { command: "SAVE_LINE" }>) => {
      if (!context.member && context.actor.role !== "ADMIN") throw new Error("Chỉ thành viên Project được lưu dòng AC.");
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
        unit = command.unit?.trim() || icSource.unit;
        basis = command.basis ?? icSource.basis;
        vatPercent = command.vatPercent ?? icSource.vatPercent;
        fundingSource = normalizeActualCostFundingSource(command.fundingSource);
      } else {
        const validated = validateUnbudgetedActualCost({
          ...command,
          reason: command.reason ?? "",
          unit: command.unit ?? "",
          evidenceIds: command.evidenceIds ?? [],
          billable: command.billable ?? false,
        });
        sourceSnapshot = { sourceKind, reason: validated.reason };
        unit = validated.unit;
        basis = command.basis ?? "GROSS";
        vatPercent = command.vatPercent ?? "0";
        fundingSource = validated.fundingSource;
        billable = validated.billable;
        saleSnapshot = validated.saleSnapshot;
      }
      if (command.evidenceIds?.length) {
        const requestedEvidenceIds = [...new Set((command.evidenceIds as unknown[]).filter((id): id is string => typeof id === "string" && !!id))];
        const evidence = await tx.costFlowEvidence.findMany({
          where: { projectId: command.projectId, id: { in: requestedEvidenceIds } },
          select: { id: true, kind: true },
        });
        if (evidence.length !== requestedEvidenceIds.length) throw new Error("Chứng từ AC phải thuộc đúng Project.");
        evidenceLinks = evidence.map(item => ({ evidenceId: item.id, kind: normalizeActualCostEvidenceKind(item.kind) }));
      }
      const draft = await ensureActualCostDraft(tx, {
        projectId: command.projectId,
        icRevisionId: required(command.revisionId ?? revisionId ?? "", "Bản IC dùng để so sánh"),
        actorId: context.actor.id,
      });
      if (command.sheetRevisionId) {
        if (draft.revision.id === command.sheetRevisionId) {
          await assertActualCostDraftMutationVersion(tx, command.sheetRevisionId, command.expectedMutationVersion ?? -1);
        } else {
          const returnedSource = await tx.actualCostSheetRevision.findFirst({
            where: { id: command.sheetRevisionId, projectId: command.projectId, state: "RETURNED", sheetId: draft.sheet.id },
            select: { id: true },
          });
          if (!returnedSource) throw new Error("Phiên bản Bảng AC đã thay đổi. Vui lòng tải lại.");
          if (draft.revision.mutationVersion !== 0) {
            throw new Error("Bảng AC đã có thay đổi mới. Vui lòng tải lại trước khi tiếp tục.");
          }
        }
      } else if (draft.revision.mutationVersion !== 0) {
        throw new Error("Bảng AC đã có thay đổi mới. Vui lòng tải lại trước khi tiếp tục.");
      }
      const calculated = calculateActualCost({ ...command, basis, vatPercent });
      const allocations = command.fundingAllocations?.length
        ? validateActualCostFundingAllocations(calculated.amount, command.fundingAllocations)
        : [{ source: fundingSource, amount: calculated.amount }];
      sourceSnapshot.internalStatus = context.isAccount ? command.internalStatus ?? "PENDING_ACCOUNT_REVIEW" : "PENDING_ACCOUNT_REVIEW";
      sourceSnapshot.fundingAllocations = allocations;
      if (context.isAccount && command.accountNote) sourceSnapshot.accountNote = command.accountNote;

      if (command.lineId) {
        const existingLine = await tx.actualCostLine.findFirst({
          where: { id: command.lineId, projectId: command.projectId },
          include: { versions: { orderBy: { version: "desc" }, take: 1, include: { applications: true } } },
        });
        if (!existingLine || !existingLine.versions[0]) throw new Error("Không tìm thấy dòng AC để cập nhật.");
        if (!context.isAccount && existingLine.createdById !== context.actor.id) {
          throw new Error("Bạn chỉ được sửa khoản thực chi do mình phụ trách; Account dự án có thể sửa toàn bảng.");
        }
        if (await tx.actualCostApplication.count({ where: { lineId: existingLine.id, state: "ACTIVE", request: { state: { notIn: ["WITHDRAWN", "REJECTED", "CANCELLED"] } } } })) {
          throw new Error("AC đang được hồ sơ thanh toán/hoàn ứng sử dụng và đã bị khóa.");
        }
        const current = existingLine.versions[0];
        let targetVersionId = current.id;
        if (current.state !== "DRAFT") {
          const nextVersion = existingLine.currentVersion + 1;
          const newVer = await tx.actualCostVersion.create({
            data: {
              projectId: command.projectId,
              lineId: existingLine.id,
              version: nextVersion,
              state: "DRAFT",
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
            },
          });
          await tx.actualCostLine.update({ where: { id: existingLine.id }, data: { currentVersion: nextVersion, recipientKey } });
          targetVersionId = newVer.id;
        } else {
          await tx.actualCostVersion.update({
            where: { id: current.id },
            data: {
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
            },
          });
          await tx.actualCostLine.update({ where: { id: existingLine.id }, data: { recipientKey } });
        }
        if (command.evidenceIds) {
          await tx.actualCostEvidenceLink.deleteMany({ where: { versionId: targetVersionId } });
          if (evidenceLinks.length) {
            await tx.actualCostEvidenceLink.createMany({
              data: evidenceLinks.map(link => ({
                projectId: command.projectId,
                versionId: targetVersionId,
                evidenceId: link.evidenceId,
                kind: link.kind,
                actorId: context.actor.id,
              })),
            });
          }
        }
        await tx.actualCostFundingAllocation.deleteMany({ where: { versionId: targetVersionId } });
        await tx.actualCostFundingAllocation.createMany({
          data: allocations.map((allocation, position) => ({
            projectId: command.projectId,
            versionId: targetVersionId,
            source: allocation.source,
            amount: allocation.amount,
            recipientKey,
            position,
            createdById: context.actor.id,
          })),
        });
        await recordActualCostSheetEvent(tx, {
          projectId: command.projectId,
          revisionId: draft.revision.id,
          actorId: context.actor.id,
          action: "UPDATE_LINE",
          lineId: existingLine.id,
          versionId: targetVersionId,
          payload: {
            before: {
              versionId: current.id,
              description: current.description,
              recipientKey: existingLine.recipientKey,
              quantity: current.quantity,
              days: current.days,
              unitPrice: current.unitPrice,
              amount: current.amount,
              internalStatus: typeof (current.sourceSnapshot as Record<string, unknown> | null)?.internalStatus === "string"
                ? String((current.sourceSnapshot as Record<string, unknown>).internalStatus) : "",
            },
            after: {
              versionId: targetVersionId,
              description: required(command.description, "nội dung AC"),
              recipientKey,
              quantity: command.quantity,
              days: command.days,
              unitPrice: command.unitPrice,
              amount: calculated.amount,
              internalStatus: String(sourceSnapshot.internalStatus),
            },
          },
        });
        return { lineId: existingLine.id, versionId: targetVersionId, amount: calculated.amount, success: "Đã lưu cập nhật dòng AC." };
      }

      // Create new line
      const stableLineId = `ac-${Date.now()}-${randomUUID().slice(0, 8)}`;
      const line = await tx.actualCostLine.create({
        data: {
          projectId: command.projectId,
          stableLineId,
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
              state: "DRAFT",
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
              evidenceLinks: evidenceLinks.length ? {
                create: evidenceLinks.map(link => ({ projectId: command.projectId, evidenceId: link.evidenceId, kind: link.kind, actorId: context.actor.id })),
              } : undefined,
            },
          },
        },
        include: { versions: true },
      });
      await tx.actualCostFundingAllocation.createMany({
        data: allocations.map((allocation, position) => ({
          projectId: command.projectId,
          versionId: line.versions[0].id,
          source: allocation.source,
          amount: allocation.amount,
          recipientKey,
          position,
          createdById: context.actor.id,
        })),
      });
      await recordActualCostSheetEvent(tx, {
        projectId: command.projectId,
        revisionId: draft.revision.id,
        actorId: context.actor.id,
        action: "ADD_LINE",
        lineId: line.id,
        versionId: line.versions[0].id,
      });
      return { lineId: line.id, versionId: line.versions[0].id, version: 1, amount: calculated.amount, success: "Đã tạo dòng AC mới." };
      };
      if (command.command === "SAVE_LINE") return saveOne(command);
      if (!Array.isArray(command.lines) || command.lines.length < 1 || command.lines.length > 100) {
        throw new Error("Mỗi lần chỉ dán từ 1 đến 100 khoản thực chi.");
      }
      const lineIds: string[] = [];
      let sheetRevisionId = command.sheetRevisionId;
      let expectedMutationVersion = command.expectedMutationVersion;
      for (const input of command.lines) {
        const result = await saveOne({
          ...input,
          command: "SAVE_LINE",
          projectId: command.projectId,
          revisionId: command.revisionId,
          sheetRevisionId,
          expectedMutationVersion,
        });
        lineIds.push(result.lineId);
        const draft = await tx.actualCostSheetRevision.findFirst({
          where: { projectId: command.projectId, state: "DRAFT" },
          orderBy: { revision: "desc" },
          select: { id: true, mutationVersion: true },
        });
        if (!draft) throw new Error("Không tìm thấy bản nháp Bảng AC sau khi ghi nhận khoản chi.");
        sheetRevisionId = draft.id;
        expectedMutationVersion = draft.mutationVersion;
      }
      return { lineIds, success: `Đã lưu ${lineIds.length} khoản thực chi vào Bảng AC.` };
    }

    if (command.command === "DELETE_LINE") {
      await assertActualCostDraftMutationVersion(tx, command.revisionId, command.expectedMutationVersion);
      const line = await tx.actualCostLine.findFirst({
        where: { id: command.lineId, projectId: command.projectId },
        include: { versions: { orderBy: { version: "desc" }, take: 1 } },
      });
      if (!line) throw new Error("Không tìm thấy dòng AC.");
      if (!context.isAccount && line.createdById !== context.actor.id) {
        throw new Error("Bạn chỉ được thay đổi khoản thực chi do mình phụ trách; Account dự án có thể sửa toàn bảng.");
      }
      if (await tx.actualCostApplication.count({ where: { lineId: line.id, state: "ACTIVE" } })) {
        throw new Error("Không thể xóa dòng AC đã được gắn vào hồ sơ thanh toán.");
      }
      await tx.actualCostLine.update({
        where: { id: line.id },
        data: command.restore
          ? { draftRemovedAt: null, draftRemovedById: null }
          : { draftRemovedAt: new Date(), draftRemovedById: context.actor.id },
      });
      await recordActualCostSheetEvent(tx, {
        projectId: command.projectId,
        revisionId: command.revisionId,
        actorId: context.actor.id,
        action: command.restore ? "RESTORE_LINE" : "REMOVE_LINE",
        lineId: line.id,
        versionId: line.versions[0]?.id,
      });
      return { lineId: command.lineId, success: command.restore ? "Đã khôi phục khoản thực chi." : "Đã loại khoản thực chi khỏi bản nháp." };
    }

    if (command.command === "UPDATE_LINE_STATUS") {
      if (!context.isAccount) throw new Error("Chỉ Account dự án được xác nhận đã kiểm tra khoản thực chi.");
      await assertActualCostDraftMutationVersion(tx, command.revisionId, command.expectedMutationVersion);
      const line = await tx.actualCostLine.findFirst({
        where: { id: command.lineId, projectId: command.projectId },
        include: { versions: { orderBy: { version: "desc" }, take: 1 } },
      });
      if (!line || !line.versions[0]) throw new Error("Không tìm thấy dòng AC.");
      const current = line.versions[0];
      const snapshot = (current.sourceSnapshot && typeof current.sourceSnapshot === "object" ? current.sourceSnapshot : {}) as Record<string, unknown>;
      snapshot.internalStatus = command.internalStatus;
      if (command.accountNote !== undefined) snapshot.accountNote = command.accountNote;
      await tx.actualCostVersion.update({
        where: { id: current.id },
        data: { sourceSnapshot: snapshot as Prisma.InputJsonValue },
      });
      await recordActualCostSheetEvent(tx, {
        projectId: command.projectId,
        revisionId: command.revisionId,
        actorId: context.actor.id,
        action: "REVIEW_LINE",
        lineId: line.id,
        versionId: current.id,
        payload: { internalStatus: command.internalStatus, accountNote: command.accountNote ?? "" },
      });
      return { lineId: line.id, versionId: current.id, success: "Đã cập nhật trạng thái kiểm tra dòng AC." };
    }

    if (command.command === "UPDATE_LINES_STATUS") {
      if (!context.isAccount) throw new Error("Chỉ Account dự án được xác nhận đã kiểm tra các khoản thực chi.");
      await assertActualCostDraftMutationVersion(tx, command.revisionId, command.expectedMutationVersion);
      const lineIds = [...new Set((command.lineIds as unknown[]).filter((lineId): lineId is string => typeof lineId === "string" && !!lineId))];
      if (!lineIds.length) throw new Error("Chưa chọn khoản thực chi cần cập nhật.");
      const lines = await tx.actualCostLine.findMany({
        where: { projectId: command.projectId, id: { in: lineIds }, draftRemovedAt: null },
        include: { versions: { orderBy: { version: "desc" }, take: 1 } },
      });
      if (lines.length !== lineIds.length || lines.some(line => !line.versions[0])) throw new Error("Danh sách khoản thực chi không hợp lệ.");
      for (const line of lines) {
        const current = line.versions[0];
        const snapshot = (current.sourceSnapshot && typeof current.sourceSnapshot === "object" ? structuredClone(current.sourceSnapshot) : {}) as Record<string, unknown>;
        snapshot.internalStatus = command.internalStatus;
        await tx.actualCostVersion.update({ where: { id: current.id }, data: { sourceSnapshot: snapshot as Prisma.InputJsonValue } });
        await tx.actualCostSheetEvent.create({
          data: { projectId: command.projectId, revisionId: command.revisionId, actorId: context.actor.id, action: "REVIEW_LINE", lineId: line.id, versionId: current.id, payload: { internalStatus: command.internalStatus } },
        });
      }
      await tx.actualCostSheetRevision.update({ where: { id: command.revisionId }, data: { mutationVersion: { increment: 1 } } });
      return { success: `Đã cập nhật ${lines.length} khoản thực chi.`, count: lines.length };
    }

    if (command.command === "SUBMIT_SHEET") {
      if (!context.isAccount) throw new Error("Chỉ Account dự án được chốt và gửi toàn bộ Bảng AC.");
      await assertActualCostDraftMutationVersion(tx, command.revisionId, command.expectedMutationVersion);
      const activeDd = await tx.workflowRoleGrant.findFirst({ where: { role: "AC_DD", revokedAt: null, user: { isActive: true } }, select: { userId: true } });
      if (!activeDd) throw new Error("Hệ thống chưa cấu hình người duyệt AC (DD).");
      if (context.actor.id === activeDd.userId) {
        throw new Error("Người chốt gửi Bảng AC và người Duyệt AC không được là cùng một người.");
      }
      const built = await buildActualCostDraftManifest(tx, { projectId: command.projectId, revisionId: command.revisionId });
      const versions = await tx.actualCostVersion.findMany({
        where: { projectId: command.projectId, id: { in: built.manifest.map(item => item.versionId) } },
        include: { line: true, evidenceLinks: true, fundingAllocations: true },
      });
      if (versions.length !== built.manifest.length) throw new Error("Bảng AC có dữ liệu không thuộc đúng Project.");

      // Preflight checks
      for (const ver of versions) {
        const snapshot = (ver.sourceSnapshot && typeof ver.sourceSnapshot === "object" ? ver.sourceSnapshot : {}) as Record<string, unknown>;
        if (snapshot.internalStatus !== "ACCOUNT_REVIEWED") {
          throw new Error(`Dòng "${ver.description}" chưa được Account kiểm tra. 100% dòng phải được kiểm tra trước khi gửi.`);
        }
        if (ver.line.sourceKind === "UNBUDGETED" && !snapshot.reason) {
          throw new Error(`Dòng "${ver.description}" phát sinh ngoài IC nhưng thiếu lý do.`);
        }
        const allocatedGross = ver.fundingAllocations.reduce((sum, allocation) => sum + BigInt(allocation.amount), BigInt(0));
        if (!ver.fundingAllocations.length || allocatedGross.toString() !== ver.amount) {
          throw new Error(`Dòng "${ver.description}" chưa phân bổ đủ nguồn tiền bằng tổng thực chi.`);
        }
      }
      if (versions.some(version => actualCostEvidenceWarnings(version.evidenceLinks.map(link => link.kind)).length > 0)
        && !command.missingEvidenceExplanation?.trim()) {
        throw new Error("Bảng AC còn thiếu chứng từ. Hãy nhập giải trình để Phó Giám đốc xem xét.");
      }
      const icGroups = new Map<string, { icGross: bigint; actualGross: bigint }>();
      for (const version of versions) {
        if (version.line.sourceKind !== "IC_LINKED") continue;
        const snapshot = version.sourceSnapshot && typeof version.sourceSnapshot === "object"
          ? version.sourceSnapshot as Record<string, unknown> : {};
        const cost = snapshot.cost && typeof snapshot.cost === "object" ? snapshot.cost as Record<string, unknown> : {};
        const gross = String(cost.gross ?? "");
        if (!/^\d+$/.test(gross)) throw new Error(`Dòng "${version.description}" thiếu số tiền Bản IC dùng để so sánh.`);
        const key = `${version.line.icRevisionId}:${version.line.icLineId}`;
        const group = icGroups.get(key) ?? { icGross: BigInt(gross), actualGross: BigInt(0) };
        group.actualGross += BigInt(version.amount);
        icGroups.set(key, group);
      }
      if ([...icGroups.values()].some(group => group.actualGross > group.icGross) && !command.overBudgetExplanation?.trim()) {
        throw new Error("Bảng AC có hạng mục vượt Bản IC. Hãy nhập giải trình để Phó Giám đốc xem xét.");
      }

      const totalGross = versions.reduce((sum, version) => sum + BigInt(version.amount || "0"), BigInt(0));
      await persistActualCostManifest(tx, { projectId: command.projectId, revisionId: command.revisionId, manifest: built.manifest, manifestHash: built.manifestHash });
      await tx.actualCostVersion.updateMany({ where: { id: { in: built.manifest.map(item => item.versionId) }, state: "DRAFT" }, data: { state: "SUBMITTED", submittedAt: new Date() } });

      // Create or update WorkflowRequest
      const reqTitle = `Duyệt toàn bộ Bảng AC-R${built.revision.revision}`;
      const payload = {
        sheetRevisionId: built.revision.id,
        sheetVersion: built.revision.revision,
        manifestHash: built.manifestHash,
        totalGross: totalGross.toString(),
        totalLines: versions.length,
        note: command.note ?? "",
        missingEvidenceExplanation: command.missingEvidenceExplanation ?? "",
        overBudgetExplanation: command.overBudgetExplanation ?? "",
      };
      const request = await tx.workflowRequest.create({
          data: {
            projectId: command.projectId,
            module: "COSTFLOW",
            kind: "ACTUAL_COST_APPROVAL",
            title: reqTitle,
            creatorId: context.actor.id,
            cashAssigneeId: context.actor.id,
            state: "SUBMITTED",
            steps: [{ role: "AC_DD", assigneeId: activeDd.userId, status: "PENDING" }],
            payload: payload as Prisma.InputJsonValue,
          },
      });
      const submitted = await tx.actualCostSheetRevision.updateMany({
        where: { id: built.revision.id, projectId: command.projectId, state: "DRAFT", mutationVersion: command.expectedMutationVersion },
        data: {
          state: "SUBMITTED",
          manifestHash: built.manifestHash,
          submittedById: context.actor.id,
          submittedAt: new Date(),
          workflowRequestId: request.id,
          note: command.note ?? "",
          missingEvidenceExplanation: command.missingEvidenceExplanation ?? "",
          overBudgetExplanation: command.overBudgetExplanation ?? "",
          mutationVersion: { increment: 1 },
        },
      });
      if (submitted.count !== 1) throw new Error("Bảng AC đã có thay đổi mới. Vui lòng tải lại trước khi gửi.");
      await tx.actualCostSheetEvent.create({
        data: {
          projectId: command.projectId,
          revisionId: built.revision.id,
          actorId: context.actor.id,
          action: "SUBMIT_SHEET",
          payload: { manifestHash: built.manifestHash, workflowRequestId: request.id, totalLines: versions.length },
        },
      });

      return {
        revisionId: built.revision.id,
        version: built.revision.revision,
        action: "SUBMITTED",
        success: `Đã gửi toàn bộ Bảng AC-R${built.revision.revision} cho DD.`,
        notificationUserId: activeDd.userId,
        notificationMessage: `Toàn bộ Bảng AC-R${built.revision.revision} đang chờ bạn xem xét.`,
      };
    }

    if (command.command === "DECIDE_SHEET") {
      if (!context.isDd) throw new Error("Chỉ Phó Giám đốc được Duyệt AC.");
      const revision = await tx.actualCostSheetRevision.findFirst({
        where: { id: command.revisionId, projectId: command.projectId },
        include: {
          lines: {
            orderBy: { position: "asc" },
            include: { line: true, version: { include: { evidenceLinks: true } } },
          },
        },
      });
      if (!revision || revision.state !== "SUBMITTED") throw new Error("Bảng AC này không còn chờ duyệt.");
      if (revision.mutationVersion !== command.expectedMutationVersion || revision.manifestHash !== command.manifestHash) {
        throw new Error("Bảng AC đã thay đổi hoặc mã đối chiếu không hợp lệ. Vui lòng tải lại.");
      }
      if (revision.submittedById === context.actor.id) throw new Error("Người gửi Bảng AC không được đồng thời là người Duyệt AC.");
      if (!revision.workflowRequestId) throw new Error("Bảng AC chưa gắn với hồ sơ Trình duyệt.");
      if (command.action === "RETURNED" && !command.reason.trim()) throw new Error("Cần nhập lý do trả lại toàn bộ Bảng AC.");
      const warningRows = revision.lines.map(item => ({
        item,
        warnings: actualCostEvidenceWarnings(item.version.evidenceLinks.map(link => link.kind)),
      }));
      if (command.action === "APPROVED" && warningRows.some(row => row.warnings.length) && !command.acknowledgeMissingEvidence) {
        throw new Error("DD phải xác nhận rõ việc duyệt toàn bộ Bảng AC dù còn thiếu chứng từ.");
      }
      const updated = await tx.actualCostSheetRevision.updateMany({
        where: { id: revision.id, state: "SUBMITTED", mutationVersion: command.expectedMutationVersion, manifestHash: command.manifestHash },
        data: {
          state: command.action,
          decidedById: context.actor.id,
          decidedAt: new Date(),
          returnedAt: command.action === "RETURNED" ? new Date() : null,
          decisionReason: command.reason.trim(),
          mutationVersion: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw new Error("Bảng AC đã được quyết định bởi một thao tác khác.");
      await tx.actualCostVersion.updateMany({
        where: { id: { in: revision.lines.map(item => item.versionId) }, state: "SUBMITTED" },
        data: { state: command.action },
      });
      const attemptId = randomUUID();
      for (const row of warningRows) {
        await tx.actualCostApproval.create({
          data: {
            projectId: command.projectId,
            lineId: row.item.lineId,
            versionId: row.item.versionId,
            attemptId,
            retryKey: `${revision.id}:${row.item.versionId}:${command.action}`,
            action: command.action,
            actorId: context.actor.id,
            reason: command.reason.trim(),
            warningCodes: row.warnings,
          },
        });
      }
      await tx.workflowRequest.update({
        where: { id: revision.workflowRequestId },
        data: { state: command.action, version: { increment: 1 } },
      });
      await tx.actualCostSheetEvent.create({
        data: {
          projectId: command.projectId,
          revisionId: revision.id,
          actorId: context.actor.id,
          action: command.action === "APPROVED" ? "APPROVE_SHEET" : "RETURN_SHEET",
          payload: { reason: command.reason.trim(), lineNotes: command.lineNotes ?? {} },
        },
      });
      return {
        revisionId: revision.id,
        version: revision.revision,
        action: command.action,
        success: command.action === "APPROVED"
          ? `Đã Duyệt AC toàn bộ Bảng AC-R${revision.revision}.`
          : `Đã trả lại toàn bộ Bảng AC-R${revision.revision} cho Account.`,
        notificationUserId: revision.submittedById,
        notificationMessage: command.action === "APPROVED"
          ? `Toàn bộ Bảng AC-R${revision.revision} đã được duyệt.`
          : `Toàn bộ Bảng AC-R${revision.revision} đã được trả lại.`,
      };
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
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: command.command === "SAVE_LINES" ? 60000 : 15000 });

  if ("notificationUserId" in result && result.notificationUserId) {
    const notificationSubject = ("lineId" in result ? result.lineId : undefined)
      ?? ("revisionId" in result ? result.revisionId : undefined) ?? command.projectId;
    const notification = {
      dedupeKey: `actual-cost:${notificationSubject}:${"version" in result ? result.version ?? 0 : 0}:${"action" in result ? result.action : "UPDATED"}`,
      userId: result.notificationUserId,
      message: result.notificationMessage,
      projectId: command.projectId,
    };
    await (options.notify
      ? options.notify(notification)
      : prisma.notification.create({ data: { ...notification, type: "costflow" } }).then(() => undefined)
    ).catch(() => undefined);
  }
  return result;
}

export async function executeActualCostBulkDecision(actor: ActualCostActor, input: {
  projectId: string;
  action: ActualCostDecisionAction;
  reason: string;
  acknowledgeMissingEvidence: boolean;
  selections: ActualCostBulkSelection[];
}) {
  throw new Error("Bảng AC chỉ được duyệt hoặc trả lại toàn bộ; thao tác duyệt nhiều khoản riêng lẻ đã ngừng sử dụng.");
  if (!input.selections.length) throw new Error("Chọn ít nhất một dòng AC để quyết định.");
  if (new Set(input.selections.map(item => item.lineId)).size !== input.selections.length) throw new Error("Dòng AC bị chọn trùng.");
  const result = await prisma.$transaction(async tx => {
    const context = await assertProjectActor(tx, input.projectId, actor);
    const activeDd = await tx.workflowRoleGrant.findMany({ where: { role: "AC_DD", revokedAt: null, user: { isActive: true } }, select: { userId: true } });
    if (!context.isDd || !activeDd.some(item => item.userId === context.actor.id)) throw new Error("Chỉ AC_DD đang hoạt động được quyết định AC.");
    const lines = await tx.actualCostLine.findMany({
      where: { projectId: input.projectId, id: { in: input.selections.map(item => item.lineId) } },
      include: { versions: { orderBy: { version: "desc" }, take: 1, include: { approvals: true, evidenceLinks: true } } },
    });
    if (lines.length !== input.selections.length) throw new Error("Một hoặc nhiều dòng AC không thuộc đúng Project.");
    const validated = input.selections.map(selection => {
      const line = lines.find(item => item.id === selection.lineId);
      const version = line?.versions[0];
      if (!line || !version || line.currentVersion !== selection.version || version.version !== selection.version || selection.reviewToken !== `${version.id}:${version.version}`) {
        throw new Error("Một hoặc nhiều phiên bản AC đã thay đổi. Chưa có quyết định nào được lưu.");
      }
      if (version.state !== "SUBMITTED" || version.approvals.length) throw new Error("Một hoặc nhiều phiên bản AC đã được quyết định. Chưa có quyết định nào được lưu.");
      const decision = validateActualCostDecision({ action: input.action, actorId: context.actor.id, activeDdIds: activeDd.map(item => item.userId), expectedVersion: selection.version, currentVersion: line.currentVersion, reason: input.reason });
      const warningCodes = actualCostEvidenceWarnings(version.evidenceLinks.map(link => link.kind));
      if (decision.action === "APPROVED" && warningCodes.length && !input.acknowledgeMissingEvidence) throw new Error("DD phải xác nhận rõ việc duyệt các dòng còn thiếu chứng từ.");
      return { line, version, decision, warningCodes };
    });
    const notifications: { lineId: string; version: number; userId: string; action: ActualCostDecisionAction }[] = [];
    for (const item of validated) {
      const updated = await tx.actualCostVersion.updateMany({ where: { id: item.version.id, projectId: input.projectId, state: "SUBMITTED" }, data: { state: item.decision.action } });
      if (updated.count !== 1) throw new Error("Một hoặc nhiều phiên bản AC đã thay đổi. Chưa có quyết định nào được lưu.");
      await tx.actualCostApproval.create({ data: {
        projectId: input.projectId,
        lineId: item.line.id,
        versionId: item.version.id,
        attemptId: randomUUID(),
        retryKey: `${item.version.id}:${item.decision.action}`,
        action: item.decision.action,
        actorId: context.actor.id,
        reason: item.decision.reason,
        warningCodes: item.warningCodes,
      } });
      notifications.push({ lineId: item.line.id, version: item.version.version, userId: item.line.createdById, action: item.decision.action });
    }
    return notifications;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 });
  await Promise.all(result.map(item => prisma.notification.create({ data: {
    dedupeKey: `actual-cost:${item.lineId}:${item.version}:${item.action}`,
    userId: item.userId,
    message: item.action === "APPROVED" ? "AC đã được DD duyệt." : "AC đã được DD trả lại để chỉnh sửa.",
    projectId: input.projectId,
    type: "costflow",
  } }).catch(() => undefined)));
  return { count: result.length, action: input.action };
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
