import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { ProjectUpload } from "@/lib/projectFiles";

export type SettlementCashDirection = "IN" | "OUT";
export type SettlementCashProgress = "CHUA_CHI" | "DANG_CHI_MOT_PHAN" | "DA_CHI_DU";

export type SettlementObligationCashSource = {
  projectId: string;
  dossierId: string;
  dossierVersionId: string;
  requestId: string;
  obligationId: string;
  recipientKey: string;
  recipientType: string;
  recipientName: string;
  bankName: string | null;
  accountLast4: string | null;
  direction: SettlementCashDirection;
  amountDue: string;
  locked: boolean;
  sourceKind: "SETTLEMENT" | "CUSTOMER_AR";
};

export type SettlementCashCommand = {
  projectId: string;
  dossierVersionId: string;
  obligationId: string;
  recipientKey: string;
  direction: SettlementCashDirection;
  amount: string;
  idempotencyKey: string;
  evidenceId: string;
  channel: string;
  reference: string;
  occurredAt: string;
  actorId: string;
};

export type SettlementCashAllocationSource = {
  projectId: string;
  dossierVersionId: string;
  obligationId: string;
  recipientKey: string;
  direction: SettlementCashDirection;
  amount: string;
  cashId: string;
  idempotencyKey: string;
  commandFingerprint: string;
  evidenceId: string;
};

export function settlementObligationDirection(value: string): SettlementCashDirection | null {
  if (value === "IN" || value === "REFUND") return "IN";
  if (value === "OUT" || value === "ADDITIONAL") return "OUT";
  if (value === "BALANCED") return null;
  throw new Error("Chiều nghĩa vụ quyết toán không hợp lệ.");
}

function required(value: string, label: string) {
  if (!value.trim()) throw new Error(`Thiếu ${label}.`);
  return value.trim();
}

function positiveVnd(value: string, label = "số tiền") {
  if (!/^[1-9]\d*$/.test(value)) throw new Error(`${label} phải là số nguyên VND lớn hơn 0.`);
  return BigInt(value);
}

function nonNegativeVnd(value: string, label = "số tiền") {
  if (!/^\d+$/.test(value)) throw new Error(`${label} phải là số nguyên VND không âm.`);
  return BigInt(value);
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stable(child)]));
  }
  return value;
}

export function settlementCashFingerprint(command: SettlementCashCommand) {
  return createHash("sha256").update(JSON.stringify(stable(command))).digest("hex");
}

export function settlementObligationProgress(amountDue: string, allocatedAmount: string) {
  const due = positiveVnd(amountDue, "nghĩa vụ quyết toán");
  const allocated = nonNegativeVnd(allocatedAmount, "số đã thu/chi");
  if (allocated > due) throw new Error("Tổng tiền quyết toán vượt nghĩa vụ đã khóa.");
  const cashProgress: SettlementCashProgress = allocated === BigInt(0)
    ? "CHUA_CHI"
    : allocated === due ? "DA_CHI_DU" : "DANG_CHI_MOT_PHAN";
  return {
    approvedAmount: due.toString(),
    cumulativePaid: allocated.toString(),
    remainingAmount: (due - allocated).toString(),
    cashProgress,
  };
}

export function validateSettlementCashCommand(input: {
  obligation: SettlementObligationCashSource;
  command: SettlementCashCommand;
  allocations: SettlementCashAllocationSource[];
}) {
  const { obligation, command } = input;
  if (obligation.sourceKind === "CUSTOMER_AR") throw new Error("Customer AR của khách hàng không phải nghĩa vụ cash quyết toán nội bộ.");
  if (!obligation.locked) throw new Error("Nghĩa vụ quyết toán chưa được CEO khóa nên chưa có thẩm quyền thu/chi tiền.");
  if (command.projectId !== obligation.projectId) throw new Error("Nghĩa vụ cash không thuộc đúng Project.");
  if (command.dossierVersionId !== obligation.dossierVersionId || command.obligationId !== obligation.obligationId) throw new Error("Cash phải gắn đúng phiên bản và nghĩa vụ quyết toán bất biến.");
  if (command.recipientKey !== obligation.recipientKey) throw new Error("Cash không thuộc đúng người nhận của nghĩa vụ quyết toán.");
  if (command.direction !== obligation.direction) throw new Error("Chiều giao dịch không khớp nghĩa vụ quyết toán.");
  required(command.evidenceId, "chứng từ thu/chi");
  required(command.idempotencyKey, "mã chống ghi trùng");
  required(command.reference, "mã giao dịch/chứng từ");
  required(command.channel, "hình thức giao dịch");
  const occurredAt = new Date(required(command.occurredAt, "thời điểm giao dịch"));
  if (!Number.isFinite(occurredAt.getTime())) throw new Error("Thời điểm giao dịch không hợp lệ.");
  const amount = positiveVnd(command.amount);
  const related = input.allocations.filter(item => item.projectId === obligation.projectId && item.obligationId === obligation.obligationId);
  const cumulative = related.reduce((total, item) => total + positiveVnd(item.amount), BigInt(0));
  const progress = settlementObligationProgress(obligation.amountDue, cumulative.toString());
  if (amount > BigInt(progress.remainingAmount)) throw new Error("Giao dịch vượt số tiền còn lại của nghĩa vụ quyết toán.");
  return {
    amount: amount.toString(),
    commandFingerprint: settlementCashFingerprint(command),
    cumulativeBefore: cumulative.toString(),
    remainingBefore: progress.remainingAmount,
  };
}

type HarnessOptions = { timeoutAfterCommitKeys?: string[] };

export function createSettlementCashHarness(obligations: SettlementObligationCashSource[], options: HarnessOptions = {}) {
  const state = { obligations: structuredClone(obligations), allocations: [] as SettlementCashAllocationSource[] };
  const timedOut = new Set(options.timeoutAfterCommitKeys ?? []);
  let serial = Promise.resolve();

  const execute = (command: SettlementCashCommand) => {
    const run = serial.then(() => {
      const fingerprint = settlementCashFingerprint(command);
      const existing = state.allocations.find(item => item.projectId === command.projectId && item.idempotencyKey === command.idempotencyKey);
      if (existing) {
        if (existing.commandFingerprint !== fingerprint) throw new Error("Mã chống ghi trùng đã được dùng cho một giao dịch khác.");
        return { cashId: existing.cashId, idempotent: true };
      }
      const obligation = state.obligations.find(item => item.obligationId === command.obligationId);
      if (!obligation) throw new Error("Không tìm thấy nghĩa vụ quyết toán.");
      validateSettlementCashCommand({ obligation, command, allocations: state.allocations });
      const cashId = randomUUID();
      state.allocations.push({
        projectId: command.projectId,
        dossierVersionId: command.dossierVersionId,
        obligationId: command.obligationId,
        recipientKey: command.recipientKey,
        direction: command.direction,
        amount: command.amount,
        cashId,
        idempotencyKey: command.idempotencyKey,
        commandFingerprint: fingerprint,
        evidenceId: command.evidenceId,
      });
      if (timedOut.delete(command.idempotencyKey)) throw new Error("Simulated timeout after commit");
      return { cashId, idempotent: false };
    });
    serial = run.then(() => undefined, () => undefined);
    return run;
  };

  const obligationProgress = (obligationId: string) => {
    const obligation = state.obligations.find(item => item.obligationId === obligationId);
    if (!obligation) throw new Error("Không tìm thấy nghĩa vụ quyết toán.");
    const paid = state.allocations.filter(item => item.obligationId === obligationId).reduce((total, item) => total + BigInt(item.amount), BigInt(0));
    return settlementObligationProgress(obligation.amountDue, paid.toString());
  };

  return {
    execute,
    snapshot: () => structuredClone(state),
    obligationProgress,
    dossierProgress: (): SettlementCashProgress => state.obligations.every(item => obligationProgress(item.obligationId).cashProgress === "DA_CHI_DU")
      ? "DA_CHI_DU"
      : state.allocations.length ? "DANG_CHI_MOT_PHAN" : "CHUA_CHI",
  };
}

type Actor = { id: string; role: string };

function formText(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

async function resolveEvidence(tx: Prisma.TransactionClient, projectId: string, actorId: string, form: FormData, upload: ProjectUpload | null) {
  if (upload) {
    const sha256 = createHash("sha256").update(upload.data).digest("hex");
    return tx.costFlowEvidence.create({ data: { projectId, requestId: null, sourceFileId: `settlement-cash:${randomUUID()}`, kind: "CASH", name: upload.name, mimeType: upload.mimeType, data: upload.data, sha256, createdBy: actorId } });
  }
  const sourceFileId = required(formText(form, "sourceFileId"), "chứng từ thu/chi");
  const source = await tx.projectFile.findFirst({ where: { id: sourceFileId, projectId } });
  if (!source) throw new Error("Chứng từ không thuộc Project này.");
  const sha256 = createHash("sha256").update(source.data).digest("hex");
  return tx.costFlowEvidence.create({ data: { projectId, requestId: null, sourceFileId: source.id, kind: "CASH", name: source.name, mimeType: source.mimeType, data: source.data, sha256, createdBy: actorId } });
}

async function executeSettlementCashOnce(projectId: string, actor: Actor, form: FormData, upload: ProjectUpload | null) {
  return prisma.$transaction(async tx => {
    const actorRow = await tx.user.findFirst({ where: { id: actor.id, isActive: true }, select: { role: true } });
    if (!actorRow || !["ACCOUNT", "ADMIN"].includes(actorRow.role)) throw new Error("Chỉ Kế toán/Admin đang hoạt động được xác nhận tiền quyết toán.");

    const obligationId = required(formText(form, "settlementObligationId"), "nghĩa vụ quyết toán");
    const obligationRow = await tx.settlementRecipientObligation.findFirst({
      where: { id: obligationId, projectId },
      include: {
        dossierVersion: { include: { dossier: true, request: { select: { id: true, state: true } } } },
        locks: { select: { id: true } },
      },
    });
    if (!obligationRow || obligationRow.dossierVersion.request.state !== "APPROVED") throw new Error("Nghĩa vụ không thuộc hồ sơ quyết toán đã duyệt của Project.");
    const direction = formText(form, "direction") as SettlementCashDirection;
    if (direction !== "IN" && direction !== "OUT") throw new Error("Chiều giao dịch không hợp lệ.");
    const evidenceIdentity = upload
      ? createHash("sha256").update(upload.data).digest("hex")
      : required(formText(form, "sourceFileId"), "chứng từ thu/chi");
    const command: SettlementCashCommand = {
      projectId,
      dossierVersionId: obligationRow.dossierVersionId,
      obligationId: obligationRow.id,
      recipientKey: required(formText(form, "recipientKey"), "người nhận"),
      direction,
      amount: required(formText(form, "amount"), "số tiền"),
      idempotencyKey: required(formText(form, "idempotencyKey"), "mã chống ghi trùng"),
      evidenceId: evidenceIdentity,
      channel: required(formText(form, "channel"), "hình thức giao dịch"),
      reference: required(formText(form, "reference"), "mã giao dịch/chứng từ"),
      occurredAt: required(formText(form, "occurredAt"), "thời điểm giao dịch"),
      actorId: actor.id,
    };
    const fingerprint = settlementCashFingerprint(command);
    const existing = await tx.settlementCashAllocation.findUnique({ where: { projectId_idempotencyKey: { projectId, idempotencyKey: command.idempotencyKey } }, include: { cash: true } });
    if (existing) {
      if (existing.commandFingerprint !== fingerprint) throw new Error("Mã chống ghi trùng đã được dùng cho một giao dịch khác.");
      return { success: "Giao dịch quyết toán đã được ghi nhận trước đó.", requestId: obligationRow.dossierVersion.requestId, cashId: existing.cashId, idempotent: true };
    }
    const priorRows = await tx.settlementCashAllocation.findMany({ where: { projectId, obligationId: obligationRow.id }, include: { cash: true } });
    const obligationDirection = settlementObligationDirection(obligationRow.direction);
    if (!obligationDirection) throw new Error("Nghĩa vụ đã cân bằng không phát sinh thu/chi tiền.");
    const obligation: SettlementObligationCashSource = {
      projectId,
      dossierId: obligationRow.dossierVersion.dossierId,
      dossierVersionId: obligationRow.dossierVersionId,
      requestId: obligationRow.dossierVersion.requestId,
      obligationId: obligationRow.id,
      recipientKey: obligationRow.recipientKey,
      recipientType: obligationRow.recipientType,
      recipientName: obligationRow.recipientKey,
      bankName: null,
      accountLast4: null,
      direction: obligationDirection,
      amountDue: obligationRow.amountDue,
      locked: obligationRow.locks.length > 0,
      sourceKind: "SETTLEMENT",
    };
    const allocations = priorRows.map(item => ({
      projectId: item.projectId,
      dossierVersionId: obligationRow.dossierVersionId,
      obligationId: item.obligationId,
      recipientKey: item.recipientKey,
      direction: item.cash.direction as SettlementCashDirection,
      amount: item.amount,
      cashId: item.cashId,
      idempotencyKey: item.idempotencyKey,
      commandFingerprint: item.commandFingerprint,
      evidenceId: item.cash.evidenceId,
    }));
    const validated = validateSettlementCashCommand({ obligation, command, allocations });
    const evidence = await resolveEvidence(tx, projectId, actor.id, form, upload);
    const cash = await tx.costFlowCash.create({ data: {
      projectId,
      requestId: obligationRow.dossierVersion.requestId,
      recipientKey: obligationRow.recipientKey,
      direction,
      channel: command.channel,
      amount: command.amount,
      reference: command.reference,
      idempotencyKey: command.idempotencyKey,
      commandFingerprint: validated.commandFingerprint,
      allocations: [{ dossierVersionId: command.dossierVersionId, obligationId: command.obligationId, amount: command.amount }],
      evidenceId: evidence.id,
      occurredAt: new Date(command.occurredAt),
      confirmedBy: actor.id,
    } });
    await tx.settlementCashAllocation.create({ data: {
      projectId,
      obligationId: obligationRow.id,
      recipientKey: obligationRow.recipientKey,
      cashId: cash.id,
      amount: command.amount,
      idempotencyKey: command.idempotencyKey,
      commandFingerprint: validated.commandFingerprint,
    } });
    const allObligations = await tx.settlementRecipientObligation.findMany({ where: { projectId, dossierVersionId: obligationRow.dossierVersionId }, include: { cashAllocations: true } });
    const dossierProgress: SettlementCashProgress = allObligations.every(item => settlementObligationProgress(item.amountDue, item.cashAllocations.reduce((sum, allocation) => sum + BigInt(allocation.amount), BigInt(0)).toString()).cashProgress === "DA_CHI_DU") ? "DA_CHI_DU" : "DANG_CHI_MOT_PHAN";
    return { success: "Đã ghi nhận tiền quyết toán và chứng từ.", requestId: obligationRow.dossierVersion.requestId, cashId: cash.id, idempotent: false, dossierProgress };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 });
}

export async function executeSettlementCash(projectId: string, actor: Actor, form: FormData, upload: ProjectUpload | null) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await executeSettlementCashOnce(projectId, actor, form, upload);
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2034" || attempt === 2) throw error;
    }
  }
  throw new Error("Không thể hoàn tất giao dịch quyết toán đồng thời.");
}
