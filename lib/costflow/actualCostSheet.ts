import "server-only";

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";

export const ACTUAL_COST_SHEET_STATES = ["DRAFT", "SUBMITTED", "RETURNED", "APPROVED"] as const;
export type ActualCostSheetRevisionState = (typeof ACTUAL_COST_SHEET_STATES)[number];

export type ActualCostManifestItem = {
  lineId: string;
  versionId: string;
  version: number;
  position: number;
};

function stableManifestJson(input: {
  projectId: string;
  revision: number;
  icRevisionId: string;
  lines: ActualCostManifestItem[];
}) {
  return JSON.stringify({
    projectId: input.projectId,
    revision: input.revision,
    icRevisionId: input.icRevisionId,
    lines: [...input.lines]
      .sort((a, b) => a.position - b.position || a.lineId.localeCompare(b.lineId))
      .map(item => ({
        lineId: item.lineId,
        versionId: item.versionId,
        version: item.version,
        position: item.position,
      })),
  });
}

export function actualCostManifestHash(input: {
  projectId: string;
  revision: number;
  icRevisionId: string;
  lines: ActualCostManifestItem[];
}) {
  return createHash("sha256").update(stableManifestJson(input)).digest("hex");
}

export async function ensureActualCostDraft(
  tx: Prisma.TransactionClient,
  input: { projectId: string; icRevisionId: string; actorId: string },
) {
  const sheet = await tx.actualCostSheet.upsert({
    where: { projectId: input.projectId },
    create: { projectId: input.projectId },
    update: {},
  });
  const open = await tx.actualCostSheetRevision.findFirst({
    where: { sheetId: sheet.id, state: { in: ["DRAFT", "SUBMITTED"] } },
    orderBy: { revision: "desc" },
  });
  if (open?.state === "SUBMITTED") {
    throw new Error("Bảng AC đang chờ Duyệt AC và không thể chỉnh sửa.");
  }
  if (open) {
    if (open.icRevisionId !== input.icRevisionId) {
      throw new Error("Bảng AC đang tổng hợp đã gắn với một bản IC khác.");
    }
    return { sheet, revision: open };
  }

  const returned = await tx.actualCostSheetRevision.findFirst({
    where: { sheetId: sheet.id, state: "RETURNED" },
    orderBy: { revision: "desc" },
    select: { id: true },
  });
  if (returned) {
    const revision = await cloneReturnedActualCostRevision(tx, {
      projectId: input.projectId,
      returnedRevisionId: returned.id,
      actorId: input.actorId,
    });
    if (revision.icRevisionId !== input.icRevisionId) {
      throw new Error("Bảng AC gửi lại phải tiếp tục dùng đúng Bản IC của phiên bản đã bị trả lại.");
    }
    return { sheet, revision };
  }

  const revisionNumber = sheet.currentRevision + 1;
  const revision = await tx.actualCostSheetRevision.create({
    data: {
      sheetId: sheet.id,
      projectId: input.projectId,
      revision: revisionNumber,
      icRevisionId: input.icRevisionId,
      state: "DRAFT",
      events: {
        create: {
          projectId: input.projectId,
          action: "CREATE_DRAFT",
          actorId: input.actorId,
          payload: { revision: revisionNumber, icRevisionId: input.icRevisionId },
        },
      },
    },
  });
  await tx.actualCostSheet.update({
    where: { id: sheet.id },
    data: { currentRevision: revisionNumber, mutationVersion: { increment: 1 } },
  });
  return { sheet, revision };
}

export async function assertActualCostDraftMutationVersion(
  tx: Prisma.TransactionClient,
  revisionId: string,
  expectedMutationVersion: number,
) {
  const revision = await tx.actualCostSheetRevision.findUnique({ where: { id: revisionId } });
  if (!revision || revision.state !== "DRAFT") {
    throw new Error("Phiên bản Bảng AC không còn ở trạng thái có thể chỉnh sửa.");
  }
  if (revision.mutationVersion !== expectedMutationVersion) {
    throw new Error("Bảng AC đã có thay đổi mới. Vui lòng tải lại trước khi tiếp tục.");
  }
  return revision;
}

export async function recordActualCostSheetEvent(
  tx: Prisma.TransactionClient,
  input: {
    projectId: string;
    revisionId: string;
    actorId: string;
    action: string;
    lineId?: string;
    versionId?: string;
    payload?: Prisma.InputJsonValue;
  },
) {
  await tx.actualCostSheetEvent.create({
    data: {
      projectId: input.projectId,
      revisionId: input.revisionId,
      actorId: input.actorId,
      action: input.action,
      lineId: input.lineId,
      versionId: input.versionId,
      payload: input.payload ?? {},
    },
  });
  await tx.actualCostSheetRevision.update({
    where: { id: input.revisionId },
    data: { mutationVersion: { increment: 1 } },
  });
}

export async function buildActualCostDraftManifest(
  tx: Prisma.TransactionClient,
  input: { projectId: string; revisionId: string },
) {
  const revision = await tx.actualCostSheetRevision.findFirst({
    where: { id: input.revisionId, projectId: input.projectId, state: "DRAFT" },
  });
  if (!revision) throw new Error("Không tìm thấy phiên bản Bảng AC đang tổng hợp.");

  const lines = await tx.actualCostLine.findMany({
    where: { projectId: input.projectId, draftRemovedAt: null },
    include: { versions: { orderBy: { version: "desc" }, take: 1 } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const manifest = lines.map((line, position) => {
    const version = line.versions[0];
    if (!version) throw new Error("Bảng AC có dòng chưa có dữ liệu phiên bản.");
    if (line.sourceKind === "IC_LINKED" && line.icRevisionId !== revision.icRevisionId) {
      throw new Error("Bảng AC có dòng không thuộc Bản IC dùng để so sánh đã chọn.");
    }
    return { lineId: line.id, versionId: version.id, version: version.version, position };
  });
  if (!manifest.length) throw new Error("Bảng AC chưa có khoản thực chi nào để gửi.");
  return {
    revision,
    manifest,
    manifestHash: actualCostManifestHash({
      projectId: input.projectId,
      revision: revision.revision,
      icRevisionId: revision.icRevisionId,
      lines: manifest,
    }),
  };
}

export async function persistActualCostManifest(
  tx: Prisma.TransactionClient,
  input: { projectId: string; revisionId: string; manifest: ActualCostManifestItem[]; manifestHash: string },
) {
  const revision = await tx.actualCostSheetRevision.findFirst({
    where: { id: input.revisionId, projectId: input.projectId, state: "DRAFT" },
  });
  if (!revision) throw new Error("Phiên bản Bảng AC không còn có thể chốt gửi.");
  if (revision.manifestHash) throw new Error("Phiên bản Bảng AC đã được chốt trước đó.");

  await tx.actualCostSheetRevisionLine.createMany({
    data: input.manifest.map(item => ({
      projectId: input.projectId,
      revisionId: input.revisionId,
      lineId: item.lineId,
      versionId: item.versionId,
      position: item.position,
    })),
  });
  await tx.actualCostSheetRevision.update({
    where: { id: input.revisionId },
    data: { manifestHash: input.manifestHash },
  });
}

export async function cloneReturnedActualCostRevision(
  tx: Prisma.TransactionClient,
  input: { projectId: string; returnedRevisionId: string; actorId: string },
) {
  const returned = await tx.actualCostSheetRevision.findFirst({
    where: { id: input.returnedRevisionId, projectId: input.projectId, state: "RETURNED" },
    include: {
      sheet: true,
      lines: {
        orderBy: { position: "asc" },
        include: {
          line: true,
          version: { include: { evidenceLinks: true, fundingAllocations: { orderBy: { position: "asc" } } } },
        },
      },
    },
  });
  if (!returned) throw new Error("Không tìm thấy Bảng AC đã trả lại.");
  const open = await tx.actualCostSheetRevision.findFirst({
    where: { sheetId: returned.sheetId, state: { in: ["DRAFT", "SUBMITTED"] } },
  });
  if (open) throw new Error("Project đã có một phiên bản Bảng AC đang xử lý.");

  const nextRevision = returned.sheet.currentRevision + 1;
  const draft = await tx.actualCostSheetRevision.create({
    data: {
      sheetId: returned.sheetId,
      projectId: input.projectId,
      revision: nextRevision,
      state: "DRAFT",
      icRevisionId: returned.icRevisionId,
      events: {
        create: {
          projectId: input.projectId,
          actorId: input.actorId,
          action: "CREATE_SUCCESSOR",
          payload: { returnedRevisionId: returned.id, returnedRevision: returned.revision },
        },
      },
    },
  });
  await tx.actualCostSheet.update({
    where: { id: returned.sheetId },
    data: { currentRevision: nextRevision, mutationVersion: { increment: 1 } },
  });
  for (const item of returned.lines) {
    const nextVersion = item.line.currentVersion + 1;
    const created = await tx.actualCostVersion.create({
      data: {
        projectId: input.projectId,
        lineId: item.lineId,
        version: nextVersion,
        state: "DRAFT",
        description: item.version.description,
        fundingSource: item.version.fundingSource,
        quantity: item.version.quantity,
        days: item.version.days,
        unitPrice: item.version.unitPrice,
        unit: item.version.unit,
        basis: item.version.basis,
        vatPercent: item.version.vatPercent,
        amount: item.version.amount,
        rawAmount: item.version.rawAmount,
        sourceSnapshot: item.version.sourceSnapshot ?? undefined,
        billable: item.version.billable,
        saleSnapshot: item.version.saleSnapshot ?? undefined,
        createdById: input.actorId,
        evidenceLinks: item.version.evidenceLinks.length ? {
          create: item.version.evidenceLinks.map(link => ({
            projectId: input.projectId,
            evidenceId: link.evidenceId,
            kind: link.kind,
            actorId: input.actorId,
          })),
        } : undefined,
        fundingAllocations: item.version.fundingAllocations.length ? {
          create: item.version.fundingAllocations.map(allocation => ({
            projectId: input.projectId,
            source: allocation.source,
            amount: allocation.amount,
            recipientKey: allocation.recipientKey,
            position: allocation.position,
            createdById: input.actorId,
          })),
        } : undefined,
      },
    });
    await tx.actualCostLine.update({
      where: { id: item.lineId },
      data: { currentVersion: nextVersion, draftRemovedAt: null, draftRemovedById: null },
    });
    await tx.actualCostSheetEvent.create({
      data: {
        projectId: input.projectId,
        revisionId: draft.id,
        actorId: input.actorId,
        action: "CARRY_FORWARD_LINE",
        lineId: item.lineId,
        versionId: created.id,
        payload: { fromRevisionId: returned.id, fromVersionId: item.versionId },
      },
    });
  }
  return draft;
}
