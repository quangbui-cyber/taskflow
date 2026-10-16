import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { ProjectUpload } from "@/lib/projectFiles";
import { maskedAccountLast4, normalizeAccountNumber, normalizeSupplierName, normalizeSupplierTaxCode, supplierAccountFingerprint, supplierDedupeKey } from "./suppliers";

export type SupplierActor = { id: string; role: string };
type LegalInput = { legalName: string; taxCode?: string; address?: string; contactName?: string; contactEmail?: string; contactPhone?: string };
type BankInput = { bankName: string; bankCode?: string; accountHolder: string; accountNumber: string };

function required(value: string, label: string, max = 300) {
  const result = value.trim();
  if (!result) throw new Error(`Thiếu ${label}.`);
  if (result.length > max) throw new Error(`${label} quá dài.`);
  return result;
}

async function requireSupplierEditor(tx: Prisma.TransactionClient, actor: SupplierActor) {
  const active = await tx.user.findFirst({ where: { id: actor.id, isActive: true }, select: { id: true, role: true } });
  if (!active) throw new Error("Tài khoản không còn hoạt động.");
  if (active.role !== "ADMIN" && active.role !== "ACCOUNT") throw new Error("Chỉ Account hoặc Admin được quản lý danh bạ NCC.");
  return active;
}

function legalData(input: LegalInput) {
  const legalName = required(input.legalName, "tên pháp lý");
  const taxCode = normalizeSupplierTaxCode(input.taxCode);
  return {
    legalName,
    normalizedName: normalizeSupplierName(legalName),
    taxCode,
    normalizedTaxCode: taxCode,
    address: String(input.address ?? "").trim().slice(0, 500),
    contactName: String(input.contactName ?? "").trim().slice(0, 200),
    contactEmail: String(input.contactEmail ?? "").trim().slice(0, 254),
    contactPhone: String(input.contactPhone ?? "").trim().slice(0, 80),
  };
}

function bankData(input: BankInput) {
  const bankName = required(input.bankName, "ngân hàng", 200);
  const accountHolder = required(input.accountHolder, "tên tài khoản", 300);
  const accountNumber = normalizeAccountNumber(required(input.accountNumber, "số tài khoản", 100));
  if (accountNumber.length < 4) throw new Error("Số tài khoản không hợp lệ.");
  return { bankName, bankCode: String(input.bankCode ?? "").trim().slice(0, 50), accountHolder, accountNumber, accountLast4: maskedAccountLast4(accountNumber), accountFingerprint: supplierAccountFingerprint(bankName, accountNumber) };
}

export async function createSupplier(actor: SupplierActor, input: LegalInput & BankInput) {
  return prisma.$transaction(async tx => {
    const active = await requireSupplierEditor(tx, actor);
    const legal = legalData(input);
    const bank = bankData(input);
    const dedupeKey = supplierDedupeKey({ name: legal.legalName, taxCode: legal.taxCode, bank: bank.bankName, account: bank.accountNumber });
    const duplicate = await tx.supplier.findFirst({ where: legal.taxCode ? { taxCodeKey: legal.taxCode } : { dedupeKey, status: "ACTIVE" }, select: { id: true } });
    if (duplicate) throw new Error("NCC đã tồn tại trong danh bạ công ty.");
    const supplierId = randomUUID();
    const supplierVersionId = randomUUID();
    const bankAccountId = randomUUID();
    const bankAccountVersionId = randomUUID();
    await tx.supplier.create({ data: { id: supplierId, taxCodeKey: legal.taxCode, dedupeKey } });
    await tx.supplierVersion.create({ data: { id: supplierVersionId, supplierId, version: 1, ...legal, changeReason: "Khởi tạo NCC", createdById: active.id } });
    await tx.supplierBankAccount.create({ data: { id: bankAccountId, supplierId, isPrimary: true } });
    await tx.supplierBankAccountVersion.create({ data: { id: bankAccountVersionId, supplierId, bankAccountId, version: 1, ...bank, changeReason: "Khởi tạo tài khoản", createdById: active.id } });
    return { supplierId, supplierVersionId, bankAccountId, bankAccountVersionId, version: 1 };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function publishSupplierLegalVersion(actor: SupplierActor, input: LegalInput & { supplierId: string; expectedVersion: number; reason: string }) {
  return prisma.$transaction(async tx => {
    const active = await requireSupplierEditor(tx, actor);
    const supplier = await tx.supplier.findFirst({ where: { id: input.supplierId, status: "ACTIVE" } });
    if (!supplier || supplier.currentVersion !== input.expectedVersion) throw new Error("Phiên bản NCC đã thay đổi. Tải lại trước khi lưu.");
    const legal = legalData(input);
    const nextVersion = supplier.currentVersion + 1;
    const id = randomUUID();
    await tx.supplierVersion.create({ data: { id, supplierId: supplier.id, version: nextVersion, ...legal, changeReason: required(input.reason, "lý do thay đổi", 500), createdById: active.id } });
    const updated = await tx.supplier.updateMany({ where: { id: supplier.id, currentVersion: supplier.currentVersion }, data: { currentVersion: nextVersion, taxCodeKey: legal.taxCode, dedupeKey: legal.taxCode ? `TAX:${legal.taxCode}` : supplier.dedupeKey } });
    if (updated.count !== 1) throw new Error("Phiên bản NCC đã thay đổi. Tải lại trước khi lưu.");
    return { supplierId: supplier.id, supplierVersionId: id, version: nextVersion };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function addSupplierBankAccount(actor: SupplierActor, input: BankInput & { supplierId: string; makePrimary?: boolean; reason: string }) {
  return prisma.$transaction(async tx => {
    const active = await requireSupplierEditor(tx, actor);
    const supplier = await tx.supplier.findFirst({ where: { id: input.supplierId, status: "ACTIVE" }, include: { bankAccounts: { where: { status: "ACTIVE" } } } });
    if (!supplier) throw new Error("Không tìm thấy NCC hiện hành.");
    const bank = bankData(input);
    const duplicate = await tx.supplierBankAccountVersion.findFirst({ where: { supplierId: supplier.id, accountFingerprint: bank.accountFingerprint, bankAccount: { status: "ACTIVE" } }, select: { id: true } });
    if (duplicate) throw new Error("Tài khoản ngân hàng đã có trên NCC.");
    if (input.makePrimary) await tx.supplierBankAccount.updateMany({ where: { supplierId: supplier.id, status: "ACTIVE", isPrimary: true }, data: { isPrimary: false } });
    const bankAccountId = randomUUID();
    const bankAccountVersionId = randomUUID();
    await tx.supplierBankAccount.create({ data: { id: bankAccountId, supplierId: supplier.id, isPrimary: input.makePrimary === true || supplier.bankAccounts.length === 0 } });
    await tx.supplierBankAccountVersion.create({ data: { id: bankAccountVersionId, supplierId: supplier.id, bankAccountId, version: 1, ...bank, changeReason: required(input.reason, "lý do thêm tài khoản", 500), createdById: active.id } });
    return { supplierId: supplier.id, bankAccountId, bankAccountVersionId, version: 1 };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function publishSupplierBankVersion(actor: SupplierActor, input: BankInput & { supplierId: string; bankAccountId: string; expectedVersion: number; reason: string }) {
  return prisma.$transaction(async tx => {
    const active = await requireSupplierEditor(tx, actor);
    const account = await tx.supplierBankAccount.findFirst({ where: { id: input.bankAccountId, supplierId: input.supplierId, status: "ACTIVE", supplier: { status: "ACTIVE" } } });
    if (!account || account.currentVersion !== input.expectedVersion) throw new Error("Phiên bản tài khoản đã thay đổi. Tải lại trước khi lưu.");
    const bank = bankData(input);
    const nextVersion = account.currentVersion + 1;
    const id = randomUUID();
    await tx.supplierBankAccountVersion.create({ data: { id, supplierId: input.supplierId, bankAccountId: account.id, version: nextVersion, ...bank, changeReason: required(input.reason, "lý do thay đổi", 500), createdById: active.id } });
    const updated = await tx.supplierBankAccount.updateMany({ where: { id: account.id, supplierId: input.supplierId, currentVersion: account.currentVersion }, data: { currentVersion: nextVersion } });
    if (updated.count !== 1) throw new Error("Phiên bản tài khoản đã thay đổi. Tải lại trước khi lưu.");
    return { supplierId: input.supplierId, bankAccountId: account.id, bankAccountVersionId: id, version: nextVersion };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function setPrimarySupplierBankAccount(actor: SupplierActor, input: { supplierId: string; bankAccountId: string }) {
  return prisma.$transaction(async tx => {
    await requireSupplierEditor(tx, actor);
    const account = await tx.supplierBankAccount.findFirst({ where: { id: input.bankAccountId, supplierId: input.supplierId, status: "ACTIVE" }, select: { id: true } });
    if (!account) throw new Error("Không tìm thấy tài khoản hiện hành.");
    await tx.supplierBankAccount.updateMany({ where: { supplierId: input.supplierId, status: "ACTIVE", isPrimary: true }, data: { isPrimary: false } });
    await tx.supplierBankAccount.update({ where: { id: account.id }, data: { isPrimary: true } });
    return { supplierId: input.supplierId, bankAccountId: account.id };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function archiveSupplierBankAccount(actor: SupplierActor, input: { supplierId: string; bankAccountId: string; reason: string }) {
  return prisma.$transaction(async tx => {
    await requireSupplierEditor(tx, actor);
    required(input.reason, "lý do lưu trữ", 500);
    const accounts = await tx.supplierBankAccount.findMany({ where: { supplierId: input.supplierId, status: "ACTIVE" }, select: { id: true, isPrimary: true } });
    const account = accounts.find(item => item.id === input.bankAccountId);
    if (!account) throw new Error("Không tìm thấy tài khoản hiện hành.");
    if (accounts.length === 1) throw new Error("NCC phải còn ít nhất một tài khoản hoạt động.");
    await tx.supplierBankAccount.update({ where: { id: account.id }, data: { status: "ARCHIVED", isPrimary: false, archivedAt: new Date() } });
    if (account.isPrimary) await tx.supplierBankAccount.update({ where: { id: accounts.find(item => item.id !== account.id)!.id }, data: { isPrimary: true } });
    return { supplierId: input.supplierId, bankAccountId: account.id };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function verifySupplierTuple(actor: SupplierActor, input: { projectId: string; supplierId: string; supplierVersionId: string; bankAccountId: string; bankAccountVersionId: string; decision: "VERIFIED" | "REJECTED"; reason: string; proof?: ProjectUpload }) {
  return prisma.$transaction(async tx => {
    const active = await tx.user.findFirst({ where: { id: actor.id, isActive: true }, select: { id: true, role: true } });
    if (!active) throw new Error("Tài khoản không còn hoạt động.");
    const workspace = await tx.costFlowWorkspace.findUnique({ where: { projectId: input.projectId }, select: { data: true } });
    const config = workspace?.data && typeof workspace.data === "object" && !Array.isArray(workspace.data) ? (workspace.data as Record<string, unknown>).config : null;
    const accountantId = config && typeof config === "object" && !Array.isArray(config) ? (config as Record<string, unknown>).accountantId : null;
    if (active.role !== "ADMIN" && accountantId !== active.id) throw new Error("Chỉ Kế toán được phân công mới được xác minh NCC.");
    const supplier = await tx.supplier.findFirst({ where: { id: input.supplierId, status: "ACTIVE" }, include: { versions: { orderBy: { version: "desc" }, take: 1 }, bankAccounts: { where: { id: input.bankAccountId, status: "ACTIVE" }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } } } });
    const currentSupplierVersion = supplier?.versions[0];
    const account = supplier?.bankAccounts[0];
    const currentBankVersion = account?.versions[0];
    if (!supplier || !currentSupplierVersion || !account || !currentBankVersion || currentSupplierVersion.id !== input.supplierVersionId || currentBankVersion.id !== input.bankAccountVersionId) throw new Error("Chỉ được xác minh đúng phiên bản hiện hành của NCC và tài khoản.");
    if (input.decision === "REJECTED" && !input.reason.trim()) throw new Error("Từ chối xác minh cần nêu lý do.");
    let evidenceId: string | null = null;
    if (input.proof) {
      const evidence = await tx.supplierEvidence.create({ data: { supplierId: supplier.id, name: input.proof.name, mimeType: input.proof.mimeType, byteLength: input.proof.data.byteLength, data: input.proof.data, sha256: createHash("sha256").update(input.proof.data).digest("hex"), createdById: active.id } });
      evidenceId = evidence.id;
    }
    const verification = await tx.supplierVerification.create({ data: { supplierId: supplier.id, supplierVersionId: currentSupplierVersion.id, bankAccountId: account.id, bankAccountVersionId: currentBankVersion.id, decision: input.decision, reason: input.reason.trim().slice(0, 1000), evidenceId, actorId: active.id } });
    return { id: verification.id, supplierId: supplier.id, bankAccountId: account.id, decision: input.decision, evidenceId };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
