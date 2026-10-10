import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { EXCEL_INTAKE_SCHEMA_VERSION } from "./excelIntake";
import type { ExcelIntakePreview } from "./excelIntakeParser";
import { emptyFinance, type FinanceData, type PairedRow } from "./types";
import { hydrateLinePricingData, normalizePairedRows } from "./pairedDraft";
import { calculateLineCost, compare, decimal } from "./money";

type Actor = { id: string; role: string };
export type ConfirmExcelIntakeCommand = { projectId: string; expectedVersion: number; idempotencyKey: string; fingerprint: string; preview: ExcelIntakePreview; corrections?: Record<string, string> };
export type ConfirmExcelIntakeResult = { draftId: string; version: number; idempotent: boolean };
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

function previewFingerprint(preview: ExcelIntakePreview) {
  const normalized = { ...preview } as Partial<ExcelIntakePreview>;
  delete normalized.fingerprint;
  delete normalized.adapter;
  delete normalized.confidence;
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

function correctedValue(command: ConfirmExcelIntakeCommand, rowKey: string, field: string, fallback: string | null) {
  return String(command.corrections?.[`${rowKey}.${field}`] ?? fallback ?? "").trim();
}

function buildRows(command: ConfirmExcelIntakeCommand): PairedRow[] {
  const ids = new Map(command.preview.rows.map(row => [row.candidateKey, randomUUID()]));
  const rows = command.preview.rows.map(row => ({
    itemId: ids.get(row.candidateKey)!,
    parentItemId: row.parentCandidateKey ? ids.get(row.parentCandidateKey) ?? null : null,
    rowType: row.rowType,
    name: row.name,
    description: row.description,
    pricingMode: "DETAIL" as const,
    showChildren: true,
    showGroupSubtotal: true,
    packageChildDisplay: "CONTENT" as const,
    sell: {
      unit: correctedValue(command, row.candidateKey, "sell.unit", row.sell.unit),
      quantity: correctedValue(command, row.candidateKey, "sell.quantity", row.sell.quantity),
      days: correctedValue(command, row.candidateKey, "sell.days", row.sell.days),
      unitPrice: correctedValue(command, row.candidateKey, "sell.unitPrice", row.sell.unitPrice),
      vatPercent: correctedValue(command, row.candidateKey, "sell.vatPercent", row.sell.vatPercent),
      basis: (correctedValue(command, row.candidateKey, "sell.basis", row.sell.basis) || "NET") as "NET" | "GROSS",
      notes: correctedValue(command, row.candidateKey, "sell.note", row.sell.note),
    },
    buy: {
      unit: correctedValue(command, row.candidateKey, "buy.unit", row.buy.unit),
      quantity: correctedValue(command, row.candidateKey, "buy.quantity", row.buy.quantity),
      days: correctedValue(command, row.candidateKey, "buy.days", row.buy.days),
      unitPrice: correctedValue(command, row.candidateKey, "buy.unitPrice", row.buy.unitPrice),
      vatPercent: correctedValue(command, row.candidateKey, "buy.vatPercent", row.buy.vatPercent),
      basis: (correctedValue(command, row.candidateKey, "buy.basis", row.buy.basis) || "NET") as "NET" | "GROSS",
      notes: correctedValue(command, row.candidateKey, "buy.note", row.buy.note),
      vendorId: "",
      evidenceIds: [],
      evidenceReason: correctedValue(command, row.candidateKey, "buy.supplier", row.buy.supplier) ? `Nguồn Excel — NCC: ${correctedValue(command, row.candidateKey, "buy.supplier", row.buy.supplier)}` : "",
    },
  }));
  const normalized = normalizePairedRows(rows);
  for (const row of normalized) {
    if (row.rowType === "GROUP") continue;
    for (const side of [row.sell, row.buy]) {
      if (side.quantity && compare(decimal(side.quantity), decimal("0")) <= 0) throw new Error("Số lượng phải lớn hơn 0.");
      if (side.days && compare(decimal(side.days), decimal("0")) <= 0) throw new Error("Số ngày phải lớn hơn 0.");
      if (side.vatPercent && compare(decimal(side.vatPercent), decimal("100")) > 0) throw new Error("VAT phải từ 0 đến 100.");
      if (side.unitPrice === "0" && !side.notes.trim()) throw new Error("Dòng FOC có đơn giá 0 phải kèm ghi chú.");
      if (side.quantity && side.days && side.unitPrice && side.vatPercent) calculateLineCost(side);
    }
  }
  return normalized;
}

export async function confirmExcelIntake(actor: Actor, command: ConfirmExcelIntakeCommand): Promise<ConfirmExcelIntakeResult> {
  if (!command.projectId || !Number.isSafeInteger(command.expectedVersion) || command.expectedVersion < 0) throw new Error("Phiên bản hồ sơ không hợp lệ.");
  if (!/^[A-Za-z0-9._:-]{8,200}$/.test(command.idempotencyKey)) throw new Error("Mã chống ghi trùng không hợp lệ.");
  if (command.preview.schemaVersion !== EXCEL_INTAKE_SCHEMA_VERSION || command.preview.errors.length) throw new Error("Xem trước còn lỗi cần sửa.");
  const calculatedFingerprint = previewFingerprint(command.preview);
  if (calculatedFingerprint !== command.fingerprint || calculatedFingerprint !== command.preview.fingerprint) throw new Error("Xem trước đã thay đổi. Hãy kiểm tra lại trước khi tạo nháp.");
  const corrections = Object.fromEntries(Object.entries(command.corrections ?? {}).sort(([left], [right]) => left.localeCompare(right)));
  const operationFingerprint = createHash("sha256").update(JSON.stringify({ preview: calculatedFingerprint, corrections })).digest("hex");

  return prisma.$transaction(async tx => {
    const [project, currentActor] = await Promise.all([
      tx.project.findUnique({ where: { id: command.projectId }, select: { members: { where: { userId: actor.id }, select: { userId: true } } } }),
      tx.user.findFirst({ where: { id: actor.id, isActive: true }, select: { role: true } }),
    ]);
    if (!project || !currentActor || !["ADMIN", "ACCOUNT"].includes(currentActor.role) || (currentActor.role !== "ADMIN" && !project.members.length)) throw new Error("Bạn không có quyền tạo nháp cho Project này.");
    let workspace = await tx.costFlowWorkspace.findUnique({ where: { projectId: command.projectId } });
    if (!workspace) workspace = await tx.costFlowWorkspace.create({ data: { projectId: command.projectId, data: json(emptyFinance()) } });
    const data = hydrateLinePricingData(workspace.data as unknown as FinanceData);
    const prior = data.excelIntakeReceipts?.find(receipt => receipt.idempotencyKey === command.idempotencyKey);
    if (prior) {
      if (prior.fingerprint !== operationFingerprint || prior.actorId !== actor.id) throw new Error("Mã chống ghi trùng đã được dùng với dữ liệu khác.");
      return { draftId: prior.draftId, version: workspace.version, idempotent: true };
    }
    if (workspace.version !== command.expectedVersion) throw new Error("Dữ liệu đã thay đổi. Tải lại trước khi tạo nháp.");
    const rows = buildRows(command);
    const draftId = randomUUID();
    data.quotationDrafts = [...(data.quotationDrafts ?? []), { linePricingSchemaVersion: 2, id: draftId, version: 1, createdBy: actor.id, workspaceMode: "paired", title: command.preview.metadata.projectName || "Báo giá nhập Excel", clientId: "", customer: command.preview.metadata.customer, notes: `Nguồn ${command.preview.source.sheet} ${command.preview.source.range}`.trim(), rows, globalEvidenceIds: [] }];
    data.excelIntakeReceipts = [...(data.excelIntakeReceipts ?? []).slice(-99), { idempotencyKey: command.idempotencyKey, fingerprint: operationFingerprint, draftId, actorId: actor.id, createdAt: new Date().toISOString() }];
    const updated = await tx.costFlowWorkspace.updateMany({ where: { projectId: command.projectId, version: command.expectedVersion }, data: { data: json(data), version: { increment: 1 } } });
    if (updated.count !== 1) throw new Error("Có thao tác đồng thời. Tải lại rồi thử lại.");
    await tx.costFlowHistory.create({ data: { projectId: command.projectId, version: command.expectedVersion + 1, actorId: actor.id, action: "CONFIRM_EXCEL_INTAKE", snapshot: json(data) } });
    return { draftId, version: command.expectedVersion + 1, idempotent: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 });
}
