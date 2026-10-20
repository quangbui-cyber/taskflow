import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { ProjectUpload } from "@/lib/projectFiles";
import { ordinaryApprovalSteps } from "./approvalChain";
import { resolveSupplierRecipient } from "./supplierReadModel";
import { normalizeVendorInvoice, validateVendorInvoiceFile, type VendorInvoiceMetadata } from "./vendorInvoice";
import type { FinanceData } from "./types";
import { appendDigitalSigningEvent } from "@/lib/workflow/signing";
import { recordApprovalEvent } from "@/lib/workflow/approvalEvents";

export type VendorPaymentSelection = {
  projectId: string;
  stableLineId: string;
  lineId?: string;
  versionId: string;
  approvalId: string;
  approvalAttemptId: string;
  fundingSource: string;
  recipientKey: string;
  approvedAmount: string;
  alreadyApplied: string;
  amount: string;
  sourceKind: string;
  icRevisionId?: string | null;
  icLineId?: string | null;
  description?: string;
};

const positiveVnd = (value: string, label: string) => {
  if (!/^[1-9]\d*$/.test(value)) throw new Error(`${label} phải là số nguyên VND dương.`);
  return BigInt(value);
};

export function validateVendorPaymentSelection(input: { projectId: string; recipientKey: string; invoiceGross: string; lines: VendorPaymentSelection[] }) {
  if (!input.lines.length) throw new Error("Chọn ít nhất một dòng AC đã duyệt.");
  const seen = new Set<string>();
  let total = BigInt(0);
  for (const line of input.lines) {
    const identity = `${line.versionId}:${line.approvalId}`;
    if (seen.has(identity)) throw new Error("Nguồn AC được chọn bị trùng.");
    seen.add(identity);
    if (line.projectId !== input.projectId) throw new Error("AC phải thuộc đúng Project.");
    if (line.sourceKind === "LEGACY_EXPENSE") throw new Error("Dữ liệu chi phí cũ chỉ để đối chiếu và không được tạo ĐNTT mới.");
    if (line.fundingSource !== "VENDOR_PAYMENT") throw new Error("ĐNTT sau AC chỉ nhận nguồn VENDOR_PAYMENT.");
    if (line.recipientKey !== input.recipientKey) throw new Error("Mọi dòng AC phải cùng NCC và tài khoản.");
    const approved = positiveVnd(line.approvedAmount, "AC đã duyệt");
    const applied = BigInt(line.alreadyApplied || "0");
    const amount = positiveVnd(line.amount, "Số tiền áp dụng");
    if (applied < 0 || amount > approved - applied) throw new Error("Số tiền ĐNTT vượt phần AC chưa áp dụng.");
    total += amount;
  }
  if (total !== positiveVnd(input.invoiceGross, "Tổng hóa đơn")) throw new Error("Tổng phân bổ AC phải bằng gross của hóa đơn.");
  return { totalAmount: total.toString(), lines: input.lines };
}

export type CreateVendorPaymentInput = {
  projectId: string;
  title: string;
  recipientKey: string;
  invoice: VendorInvoiceMetadata;
  files: ProjectUpload[];
  selections: Array<Pick<VendorPaymentSelection, "stableLineId" | "versionId" | "approvalId" | "approvalAttemptId" | "amount">>;
  idempotencyKey: string;
  signatureData?: FormDataEntryValue | null;
  signaturePin?: FormDataEntryValue | null;
};

export async function createVendorPaymentDossier(actor: { id: string; role: string }, input: CreateVendorPaymentInput) {
  return prisma.$transaction(async tx => {
    const active = await tx.user.findFirst({ where: { id: actor.id, isActive: true }, select: { id: true, role: true, managerId: true } });
    const project = await tx.project.findUnique({ where: { id: input.projectId }, select: { members: { where: { userId: actor.id }, select: { userId: true } } } });
    if (!active || !project || (active.role !== "ADMIN" && (active.role !== "ACCOUNT" || !project.members.length))) throw new Error("Chỉ Account của Project hoặc Admin được lập ĐNTT.");
    const supplier = await resolveSupplierRecipient(tx, input.projectId, input.recipientKey);
    if (!supplier) throw new Error("NCC hoặc tài khoản không còn hoạt động.");
    const verification = await tx.supplierVerification.findFirst({ where: { supplierId: supplier.supplierId, supplierVersionId: supplier.frozenSupplierVersionId, bankAccountId: supplier.bankAccountId, bankAccountVersionId: supplier.frozenBankVersionId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true, decision: true } });
    if (verification?.decision !== "VERIFIED") throw new Error("Kế toán phải xác minh đúng phiên bản NCC và tài khoản trước khi lập ĐNTT.");
    const invoice = normalizeVendorInvoice(input.invoice);
    if ((supplier.taxCode ?? "").replace(/[^0-9-]/g, "") !== invoice.sellerTaxCode) throw new Error("MST trên hóa đơn không khớp phiên bản NCC.");
    if (!input.files.length || input.files.length > 2) throw new Error("Cần một file XML hoặc PDF; tối đa một file mỗi định dạng.");
    const files = input.files.map(validateVendorInvoiceFile);
    if (new Set(files.map(file => file.format)).size !== files.length) throw new Error("Mỗi hóa đơn chỉ có một file XML và một file PDF.");

    const existingApps = await tx.vendorInvoiceApplication.findMany({ where: { idempotencyKey: { in: input.selections.map(item => `${input.idempotencyKey}:${item.versionId}`) } }, select: { requestId: true } });
    if (existingApps.length === input.selections.length && new Set(existingApps.map(item => item.requestId)).size === 1) return { requestId: existingApps[0].requestId, idempotent: true };
    if (existingApps.length) throw new Error("Khóa idempotency đã được dùng cho một tập AC khác.");

    const versions = await tx.actualCostVersion.findMany({
      where: { id: { in: input.selections.map(item => item.versionId) } },
      include: { line: true, approvals: true },
    });
    const existingAllocations = await tx.vendorInvoiceActualCost.findMany({
      where: {
        actualCostVersionId: { in: input.selections.map(item => item.versionId) },
        applications: { some: { state: "ACTIVE" } },
      },
      select: { actualCostVersionId: true, allocatedAmount: true },
    });
    const selectionRows: VendorPaymentSelection[] = input.selections.map(selected => {
      const version = versions.find(item => item.id === selected.versionId);
      const approval = version?.approvals.find(item => item.id === selected.approvalId && item.action === "APPROVED" && item.attemptId === selected.approvalAttemptId);
      if (!version || !approval || version.state !== "APPROVED" || version.line.stableLineId !== selected.stableLineId) throw new Error("AC chưa duyệt hoặc không khớp đúng version/approval event.");
      const applied = existingAllocations.filter(item => item.actualCostVersionId === version.id).reduce((sum, item) => sum + BigInt(item.allocatedAmount), BigInt(0));
      return { projectId: version.projectId, stableLineId: version.line.stableLineId, lineId: version.lineId, versionId: version.id, approvalId: approval.id, approvalAttemptId: approval.attemptId, fundingSource: version.fundingSource, recipientKey: version.line.recipientKey, approvedAmount: version.amount, alreadyApplied: applied.toString(), amount: selected.amount, sourceKind: version.line.sourceKind, icRevisionId: version.line.icRevisionId, icLineId: version.line.icLineId, description: version.description };
    });
    validateVendorPaymentSelection({ projectId: input.projectId, recipientKey: supplier.recipientKey, invoiceGross: invoice.grossAmount, lines: selectionRows });

    const workspace = await tx.costFlowWorkspace.findUnique({ where: { projectId: input.projectId }, select: { data: true } });
    const data = workspace?.data as unknown as FinanceData | undefined;
    const chain = ordinaryApprovalSteps({ directManagerId: active.managerId, accountantId: data?.config.accountantId ?? "", ceoId: data?.config.ceoId ?? "" });
    if (chain.some(step => !step.assigneeId)) throw new Error("Cần cấu hình đủ Quản lý, Kế toán và CEO trước khi trình ĐNTT.");
    const attemptId = randomUUID();
    const frozenTuple = { recipientKey: supplier.recipientKey, supplierId: supplier.supplierId, frozenSupplierVersionId: supplier.frozenSupplierVersionId, frozenSupplierVersion: supplier.frozenSupplierVersion, bankAccountId: supplier.bankAccountId, frozenBankVersionId: supplier.frozenBankVersionId, frozenBankVersion: supplier.frozenBankVersion, accountFingerprint: supplier.accountFingerprint };
    const sourceManifest = selectionRows.map(row => ({ stableLineId: row.stableLineId, actualCostVersionId: row.versionId, approvalId: row.approvalId, approvalAttemptId: row.approvalAttemptId, icRevisionId: row.icRevisionId, icLineId: row.icLineId, icEvidenceIds: data?.revisions.find(revision => revision.id === row.icRevisionId)?.lines.find(line => line.id === row.icLineId)?.evidenceIds ?? [] }));
    const request = await tx.workflowRequest.create({ data: { projectId: input.projectId, module: "COSTFLOW", kind: "VENDOR_PAYMENT", title: input.title.trim() || `ĐNTT hóa đơn ${invoice.invoiceNumber}`, creatorId: actor.id, cashAssigneeId: actor.id, state: "SUBMITTED", steps: JSON.parse(JSON.stringify(chain)), currentAttemptId: attemptId, currentStepArrivedAt: new Date(), payload: { normalizedPayment: true, postAcVendorPayment: true, amount: invoice.grossAmount, milestone: `Hóa đơn ${invoice.invoiceNumber}`, invoice: { ...invoice, files: files.map(file => ({ format: file.format, name: file.name, sha256: file.sha256 })) }, vendorSnapshots: [frozenTuple], actualCostManifest: sourceManifest } } });
    const invoiceRow = await tx.vendorInvoice.create({ data: { projectId: input.projectId, supplierId: supplier.supplierId, supplierVersionId: supplier.frozenSupplierVersionId, bankAccountId: supplier.bankAccountId, bankAccountVersionId: supplier.frozenBankVersionId, businessKey: invoice.businessKey, invoiceNumber: invoice.invoiceNumber, symbol: invoice.symbol, issuedAt: new Date(`${invoice.issuedAt}T00:00:00.000Z`), sellerTaxCode: invoice.sellerTaxCode, netAmount: invoice.netAmount, vatAmount: invoice.vatAmount, grossAmount: invoice.grossAmount, state: "SUBMITTED", sourceSnapshot: { frozenTuple, verificationId: verification.id, sourceManifest }, createdById: actor.id, submittedAt: new Date(), files: { create: files.map(file => ({ format: file.format, name: file.name, mimeType: file.mimeType, byteLength: file.byteLength, data: file.data, sha256: file.sha256, metadataHash: createHash("sha256").update(JSON.stringify(invoice)).digest("hex"), createdById: actor.id })) } } });
    await tx.paymentRecipientSnapshot.create({ data: { projectId: input.projectId, requestId: request.id, recipientKey: supplier.recipientKey, recipientType: "VENDOR", displayName: supplier.displayName, bankName: supplier.bankName, accountLast4: supplier.accountLast4, sourceVersion: supplier.frozenSupplierVersion, totalAmount: invoice.grossAmount } });
    for (const [position, row] of selectionRows.entries()) {
      const paymentLine = await tx.paymentRequestLine.create({ data: { projectId: input.projectId, requestId: request.id, stableKey: `VAT:${invoiceRow.id}:${row.stableLineId}`, position, description: row.description ?? `Thanh toán AC ${row.stableLineId}`, amount: row.amount, icRevisionId: row.icRevisionId ?? "UNBUDGETED", icLineId: row.icLineId ?? "UNBUDGETED", sourceSnapshot: { invoiceId: invoiceRow.id, actualCostVersionId: row.versionId, approvalId: row.approvalId, approvalAttemptId: row.approvalAttemptId, icRevisionId: row.icRevisionId, icLineId: row.icLineId, icEvidenceIds: sourceManifest[position].icEvidenceIds }, recipientKey: supplier.recipientKey, evidenceManifest: files.map(file => ({ name: file.name, sha256: file.sha256, kind: `VAT_${file.format}` })) } });
      const allocation = await tx.vendorInvoiceActualCost.create({ data: { invoiceId: invoiceRow.id, projectId: input.projectId, actualCostLineId: row.lineId!, actualCostVersionId: row.versionId, approvalId: row.approvalId, approvalAttemptId: row.approvalAttemptId, stableLineId: row.stableLineId, icRevisionId: row.icRevisionId, icLineId: row.icLineId, recipientKey: row.recipientKey, approvedAmount: row.approvedAmount, allocatedAmount: row.amount, sourceSnapshot: sourceManifest[position] } });
      await tx.vendorInvoiceApplication.create({ data: { invoiceId: invoiceRow.id, invoiceActualCostId: allocation.id, projectId: input.projectId, requestId: request.id, paymentLineId: paymentLine.id, amount: row.amount, idempotencyKey: `${input.idempotencyKey}:${row.versionId}`, sourceSnapshot: sourceManifest[position] } });
    }
    await appendDigitalSigningEvent(tx, { requestId: request.id, version: request.version, kind: request.kind, role: "CREATOR", actorId: actor.id, signatureData: input.signatureData, signaturePin: input.signaturePin, commandKey: `SUBMIT:${attemptId}:CREATOR` });
    await recordApprovalEvent(tx, { requestId: request.id, module: request.module, attemptId, submittedVersion: request.version, mutationVersion: request.version, stepIndex: 0, role: chain[0].role, actorId: actor.id, action: "SUBMIT", recipients: [chain[0].assigneeId] });
    return { requestId: request.id, invoiceId: invoiceRow.id, idempotent: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
