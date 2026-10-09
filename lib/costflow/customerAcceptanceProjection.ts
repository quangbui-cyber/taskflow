import "server-only";

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { calculateLineCost, compare, decimal, normalizeDecimalInput, subtract, totals, type Rational } from "./money";
import { projectQuotation, type CustomerQuotation } from "./quotationProjection";
import type { FinanceData } from "./types";

export const CUSTOMER_ACCEPTANCE_SIGNATURES = ["Đại diện Khách hàng", "Đại diện Creative Station"] as const;

export type CustomerAcceptanceActualInput = { rowId: string; quantity: string; days: string };
export type CustomerAcceptanceAdditionSource = {
  projectId: string;
  versionId: string;
  stableLineId: string;
  state: string;
  sourceKind: string;
  billable: boolean;
  description: string;
  unit: string;
  saleSnapshot: { quantity: string; days: string; unitPrice: string } | null;
  basis: string;
  vatPercent: string;
  vendor?: string;
  buyUnitPrice?: string;
  recipientKey?: string;
  evidenceIds?: string[];
  internalNotes?: string;
  ddEvent?: string;
  margin?: string;
};

export type CustomerAcceptanceRow = {
  id: string;
  kind: "CONTRACT" | "BILLABLE_ADDITION";
  numberLabel: string;
  name: string;
  description: string;
  unit: string;
  contractQuantity: string;
  contractDays: string;
  actualQuantity: string;
  actualDays: string;
  quantityDelta: string;
  daysDelta: string;
  saleUnitPrice: string;
  basis: "NET" | "GROSS";
  vatPercent: string;
  netAmount: string;
  vatAmount: string;
  grossAmount: string;
  notes: string;
};

export type CustomerAcceptanceProjection = {
  schemaVersion: 1;
  project: { id: string; name: string };
  customer: string;
  document: {
    title: string;
    quotationId: string;
    quotationNumber: number;
    snapshotVersion: number;
    createdAt: string;
  };
  rows: CustomerAcceptanceRow[];
  totals: { net: string; vat: string; gross: string };
  selectedActualCostVersionIds: string[];
  signatures: [typeof CUSTOMER_ACCEPTANCE_SIGNATURES[0], typeof CUSTOMER_ACCEPTANCE_SIGNATURES[1]];
};

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

function finiteDecimal(value: string, label: string, allowZero = true) {
  const normalized = normalizeDecimalInput(value);
  const parsed = decimal(normalized);
  if (compare(parsed, decimal("0")) < 0 || (!allowZero && compare(parsed, decimal("0")) === 0)) {
    throw new Error(`${label} phải ${allowZero ? "không âm" : "lớn hơn 0"}.`);
  }
  return normalized;
}

function rationalDecimal(value: Rational) {
  const negative = value.numerator < BigInt(0);
  const numerator = negative ? -value.numerator : value.numerator;
  const whole = numerator / value.denominator;
  let remainder = numerator % value.denominator;
  let fraction = "";
  for (let index = 0; remainder && index < 128; index++) {
    remainder *= BigInt(10);
    fraction += String(remainder / value.denominator);
    remainder %= value.denominator;
  }
  if (remainder) throw new Error("Sai số số lượng không thể biểu diễn chính xác.");
  fraction = fraction.replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

function vatPercent(value: string) {
  const normalized = value.trim().replace(/%$/, "");
  if (!normalized || normalized.includes("/") || normalized.includes("%")) throw new Error("VAT của dòng báo giá không hợp lệ để nghiệm thu.");
  return finiteDecimal(normalized, "VAT");
}

function basis(value: string): "NET" | "GROSS" {
  if (value !== "NET" && value !== "GROSS") throw new Error("Căn cứ giá bán không hợp lệ.");
  return value;
}

function actualCost(quantity: string, days: string, unitPrice: string, rowBasis: "NET" | "GROSS", rowVat: string) {
  return calculateLineCost({ quantity, days, unitPrice, basis: rowBasis, vatPercent: rowVat });
}

export function buildCustomerAcceptanceProjection(input: {
  project: { id: string; name: string };
  quotation: CustomerQuotation;
  snapshot: { version: number; createdAt: string };
  actualRows: CustomerAcceptanceActualInput[];
  additions: CustomerAcceptanceAdditionSource[];
  selectedActualCostVersionIds: string[];
}): CustomerAcceptanceProjection {
  if (!input.quotation.id || !input.quotation.number || input.quotation.incomplete || input.quotation.amountIncomplete) {
    throw new Error("Chỉ báo giá đã chốt và đầy đủ mới được dùng để lập nghiệm thu khách hàng.");
  }
  if (!Number.isSafeInteger(input.snapshot.version) || input.snapshot.version < 1) throw new Error("Phiên bản snapshot không hợp lệ.");
  const contractRows = input.quotation.rows.filter(row => !row.summary && !!row.unitPrice && !!row.quantity && !!row.days);
  const actualById = new Map<string, CustomerAcceptanceActualInput>();
  for (const actual of input.actualRows) {
    if (actualById.has(actual.rowId)) throw new Error("Dòng nghiệm thu khách hàng bị nhập trùng.");
    actualById.set(actual.rowId, actual);
  }
  for (const rowId of actualById.keys()) {
    if (!contractRows.some(row => row.id === rowId)) throw new Error("Dòng thực tế không còn thuộc báo giá đã chọn.");
  }
  const rows: CustomerAcceptanceRow[] = contractRows.map(row => {
    const actual = actualById.get(row.id);
    if (!actual) throw new Error(`Thiếu số lượng/ngày thực tế cho ${row.name}.`);
    const contractQuantity = finiteDecimal(row.quantity, "Số lượng hợp đồng");
    const contractDays = finiteDecimal(row.days, "Số ngày hợp đồng", false);
    const actualQuantity = finiteDecimal(actual.quantity, "Số lượng thực tế");
    const actualDays = finiteDecimal(actual.days, "Số ngày thực tế", false);
    const saleUnitPrice = finiteDecimal(row.unitPrice, "Đơn giá bán");
    const rowBasis = basis(row.basis);
    const rowVat = vatPercent(row.vat);
    const amount = actualCost(actualQuantity, actualDays, saleUnitPrice, rowBasis, rowVat);
    return {
      id: row.id,
      kind: "CONTRACT",
      numberLabel: row.numberLabel,
      name: row.name,
      description: row.description,
      unit: row.unit,
      contractQuantity,
      contractDays,
      actualQuantity,
      actualDays,
      quantityDelta: rationalDecimal(subtract(decimal(actualQuantity), decimal(contractQuantity))),
      daysDelta: rationalDecimal(subtract(decimal(actualDays), decimal(contractDays))),
      saleUnitPrice,
      basis: rowBasis,
      vatPercent: rowVat,
      netAmount: amount.net,
      vatAmount: amount.vat,
      grossAmount: amount.gross,
      notes: row.notes,
    };
  });

  const selected = input.selectedActualCostVersionIds.map(value => value.trim()).filter(Boolean);
  if (new Set(selected).size !== selected.length) throw new Error("Dòng phát sinh thu thêm bị chọn trùng.");
  const additionById = new Map(input.additions.map(addition => [addition.versionId, addition]));
  for (const [index, versionId] of selected.entries()) {
    const addition = additionById.get(versionId);
    if (!addition) throw new Error("Dòng phát sinh đã cũ hoặc không còn khả dụng.");
    if (addition.projectId !== input.project.id) throw new Error("Dòng phát sinh không thuộc đúng Project.");
    if (addition.state !== "APPROVED") throw new Error("Dòng phát sinh phải được DD duyệt.");
    if (addition.sourceKind !== "UNBUDGETED") throw new Error("Chỉ dòng phát sinh ngoài IC mới được chọn thu thêm.");
    if (!addition.billable) throw new Error("Dòng phát sinh chưa được đánh dấu thu thêm từ khách.");
    if (!addition.saleSnapshot) throw new Error("Dòng thu thêm thiếu snapshot giá bán.");
    const actualQuantity = finiteDecimal(addition.saleSnapshot.quantity, "Số lượng bán phát sinh");
    const actualDays = finiteDecimal(addition.saleSnapshot.days, "Số ngày bán phát sinh", false);
    const saleUnitPrice = finiteDecimal(addition.saleSnapshot.unitPrice, "Đơn giá bán phát sinh");
    const rowBasis = basis(addition.basis);
    const rowVat = finiteDecimal(addition.vatPercent, "VAT phát sinh");
    const amount = actualCost(actualQuantity, actualDays, saleUnitPrice, rowBasis, rowVat);
    rows.push({
      id: addition.versionId,
      kind: "BILLABLE_ADDITION",
      numberLabel: `PS${index + 1}`,
      name: addition.description,
      description: "Phát sinh được chọn cho phiên bản nghiệm thu này",
      unit: addition.unit,
      contractQuantity: "0",
      contractDays: "0",
      actualQuantity,
      actualDays,
      quantityDelta: actualQuantity,
      daysDelta: actualDays,
      saleUnitPrice,
      basis: rowBasis,
      vatPercent: rowVat,
      netAmount: amount.net,
      vatAmount: amount.vat,
      grossAmount: amount.gross,
      notes: "",
    });
  }
  const aggregate = totals(rows.map(row => actualCost(row.actualQuantity, row.actualDays, row.saleUnitPrice, row.basis, row.vatPercent)));
  return {
    schemaVersion: 1,
    project: { id: input.project.id, name: input.project.name },
    customer: input.quotation.customer,
    document: {
      title: input.quotation.title,
      quotationId: input.quotation.id,
      quotationNumber: input.quotation.number,
      snapshotVersion: input.snapshot.version,
      createdAt: input.snapshot.createdAt,
    },
    rows,
    totals: { net: aggregate.net, vat: aggregate.vat, gross: aggregate.gross },
    selectedActualCostVersionIds: selected,
    signatures: [...CUSTOMER_ACCEPTANCE_SIGNATURES],
  };
}

export function customerAcceptanceProjectionHash(projection: CustomerAcceptanceProjection) {
  return createHash("sha256").update(JSON.stringify(projection)).digest("hex");
}

export function customerAcceptanceArtifactRows(projection: CustomerAcceptanceProjection): string[][] {
  return [
    ["BIÊN BẢN NGHIỆM THU / THANH LÝ"],
    ["Dự án", projection.project.name, "Khách hàng", projection.customer],
    ["Nguồn báo giá", `BG-${projection.document.quotationNumber}`, "Snapshot", `v${projection.document.snapshotVersion}`],
    ["STT", "Hạng mục", "ĐVT", "SL HĐ", "Ngày HĐ", "SL TT", "Ngày TT", "Δ SL", "Δ ngày", "Đơn giá bán", "NET", "VAT", "GROSS"],
    ...projection.rows.map(row => [row.numberLabel, row.name, row.unit, row.contractQuantity, row.contractDays, row.actualQuantity, row.actualDays, row.quantityDelta, row.daysDelta, row.saleUnitPrice, row.netAmount, row.vatAmount, row.grossAmount]),
    ["TỔNG CỘNG", "", "", "", "", "", "", "", "", "", projection.totals.net, projection.totals.vat, projection.totals.gross],
    [projection.signatures[0], "", "", "", "", "", "", projection.signatures[1]],
  ];
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export async function createCustomerAcceptanceSnapshot(tx: Prisma.TransactionClient, input: {
  projectId: string;
  quotationId: string;
  liquidationId?: string;
  actorId: string;
  actualRows: CustomerAcceptanceActualInput[];
  selectedActualCostVersionIds: string[];
}) {
  const [project, workspace, latest, liquidation] = await Promise.all([
    tx.project.findUnique({ where: { id: input.projectId }, select: { id: true, name: true } }),
    tx.costFlowWorkspace.findUnique({ where: { projectId: input.projectId }, select: { data: true } }),
    tx.customerAcceptanceSnapshot.findFirst({ where: { projectId: input.projectId }, orderBy: { version: "desc" }, select: { version: true } }),
    input.liquidationId ? tx.customerLiquidation.findFirst({ where: { id: input.liquidationId, projectId: input.projectId }, select: { id: true } }) : null,
  ]);
  if (!project || !workspace) throw new Error("Project không tồn tại hoặc chưa có dữ liệu CostFlow.");
  if (input.liquidationId && !liquidation) throw new Error("Phiên bản thanh lý không thuộc đúng Project.");
  const data = workspace.data as unknown as FinanceData;
  const quotation = data.quotations?.find(item => item.id === input.quotationId);
  if (!quotation) throw new Error("Báo giá không thuộc Project hoặc không còn tồn tại.");
  const selected = input.selectedActualCostVersionIds.map(value => value.trim()).filter(Boolean);
  const versions = selected.length ? await tx.actualCostVersion.findMany({
    where: { id: { in: selected } },
    include: { line: { select: { projectId: true, stableLineId: true, sourceKind: true, currentVersion: true } } },
  }) : [];
  if (versions.length !== new Set(selected).size) throw new Error("Dòng phát sinh đã cũ hoặc không còn khả dụng.");
  const additions: CustomerAcceptanceAdditionSource[] = versions.map(version => {
    if (version.line.currentVersion !== version.version) throw new Error("Dòng phát sinh đã có phiên bản mới. Tải lại trước khi xuất.");
    const sale = object(version.saleSnapshot);
    return {
      projectId: version.line.projectId,
      versionId: version.id,
      stableLineId: version.line.stableLineId,
      state: version.state,
      sourceKind: version.line.sourceKind,
      billable: version.billable,
      description: version.description,
      unit: version.unit,
      saleSnapshot: sale ? { quantity: String(sale.quantity ?? ""), days: String(sale.days ?? ""), unitPrice: String(sale.unitPrice ?? "") } : null,
      basis: version.basis,
      vatPercent: version.vatPercent,
    };
  });
  const version = (latest?.version ?? 0) + 1;
  const createdAt = new Date();
  const projection = buildCustomerAcceptanceProjection({
    project,
    quotation: projectQuotation(quotation),
    snapshot: { version, createdAt: createdAt.toISOString() },
    actualRows: input.actualRows,
    additions,
    selectedActualCostVersionIds: selected,
  });
  const snapshot = await tx.customerAcceptanceSnapshot.create({ data: {
    projectId: input.projectId,
    version,
    quotationId: quotation.id,
    liquidationId: liquidation?.id,
    projection: json(projection),
    selectedActualCostVersionIds: json(selected),
    createdById: input.actorId,
    createdAt,
  } });
  return { id: snapshot.id, version, projection, projectionHash: customerAcceptanceProjectionHash(projection) };
}

export function parseCustomerAcceptanceProjection(value: unknown): CustomerAcceptanceProjection | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<CustomerAcceptanceProjection>;
  if (candidate.schemaVersion !== 1 || !candidate.project || !candidate.document || !candidate.totals || !Array.isArray(candidate.rows) || !Array.isArray(candidate.selectedActualCostVersionIds)) return null;
  if (JSON.stringify(candidate.signatures) !== JSON.stringify(CUSTOMER_ACCEPTANCE_SIGNATURES)) return null;
  return candidate as CustomerAcceptanceProjection;
}

export async function getCustomerAcceptanceExport(projectId: string, snapshotId: string, actor: { id: string; role: string }, format: "PDF" | "XLSX") {
  const active = await prisma.user.findFirst({ where: { id: actor.id, isActive: true }, select: { id: true, role: true } });
  if (!active) return null;
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { members: { select: { userId: true } } } });
  if (!project || (active.role !== "ADMIN" && !project.members.some(member => member.userId === active.id))) return null;
  const snapshot = await prisma.customerAcceptanceSnapshot.findFirst({ where: { id: snapshotId, projectId }, select: { id: true, version: true, projection: true } });
  const projection = snapshot ? parseCustomerAcceptanceProjection(snapshot.projection) : null;
  if (!snapshot || !projection || projection.project.id !== projectId || projection.document.snapshotVersion !== snapshot.version) return null;
  const projectionHash = customerAcceptanceProjectionHash(projection);
  const existing = await prisma.customerAcceptanceExport.findUnique({ where: { snapshotId_format: { snapshotId, format } }, select: { projectionHash: true } });
  if (existing && existing.projectionHash !== projectionHash) return null;
  if (!existing) await prisma.customerAcceptanceExport.create({ data: { snapshotId, format, projectionHash, createdById: active.id } });
  return { snapshotId, version: snapshot.version, projection, projectionHash };
}

export function customerAcceptanceJson(projection: CustomerAcceptanceProjection) {
  return json(projection);
}
