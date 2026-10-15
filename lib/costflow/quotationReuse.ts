import "server-only";

import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { blankSide, normalizePairedRows, pairedFromLegacy } from "./pairedDraft";
import { normalizeQuotationTotalLayout, normalizeQuotationTotals, type QuotationTotalLayoutRow, type QuotationTotalLine } from "./quotationTotals";
import { normalizeParameterSnapshot, type QuotationParameterSnapshot } from "./quotationParameters";
import type { FinanceData, PairedDraft, PairedRow, Quotation, QuotationReuseKind } from "./types";

type Actor = { id: string; role: string };
type SnapshotRow = Omit<PairedRow, "buy" | "icLineId" | "quotationLineId">;

export type QuotationReuseSnapshot = {
  linePricingSchemaVersion?: 2;
  parameterConfig?: QuotationParameterSnapshot;
  notes: string;
  rows: SnapshotRow[];
  totalLines: QuotationTotalLine[];
  totalLayout: QuotationTotalLayoutRow[];
};

export type QuotationReuseCatalogItem = {
  kind: QuotationReuseKind;
  id: string;
  sourceProjectId?: string;
  title: string;
  projectName?: string;
  customer?: string;
  createdAt: string;
  description?: string;
};

const asFinance = (value: Prisma.JsonValue): FinanceData => value as unknown as FinanceData;
const asSnapshot = (value: Prisma.JsonValue): QuotationReuseSnapshot => value as unknown as QuotationReuseSnapshot;
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

export function quotationReuseSnapshot(quotation: Quotation): QuotationReuseSnapshot {
  const rows = pairedFromLegacy(quotation, undefined).map(row => ({
    itemId: row.itemId,
    parentItemId: row.parentItemId,
    rowType: row.rowType,
    name: row.name,
    description: row.description,
    pricingMode: row.pricingMode,
    showChildren: row.showChildren,
    showGroupSubtotal: row.showGroupSubtotal,
    packageChildDisplay: row.packageChildDisplay,
    saleRemoved: row.saleRemoved,
    sell: structuredClone(row.sell),
  }));
  const totalLines = normalizeQuotationTotals(structuredClone(quotation.totalLines ?? []));
  return {
    linePricingSchemaVersion: 2,
    parameterConfig: quotation.parameterConfig ? structuredClone(quotation.parameterConfig) : undefined,
    notes: quotation.notes,
    rows,
    totalLines,
    totalLayout: normalizeQuotationTotalLayout(totalLines, structuredClone(quotation.totalLayout ?? [])),
  };
}

function draftRows(snapshot: QuotationReuseSnapshot): PairedRow[] {
  const ids = new Map(snapshot.rows.map(row => [row.itemId, randomUUID()]));
  return normalizePairedRows(snapshot.rows.map(row => ({
    ...structuredClone(row),
    itemId: ids.get(row.itemId)!,
    parentItemId: row.parentItemId ? ids.get(row.parentItemId) ?? null : null,
    buy: { ...blankSide(), vendorId: "", evidenceIds: [], evidenceReason: "" },
  })));
}

async function activeActor(actor: Actor) {
  const current = await prisma.user.findFirst({ where: { id: actor.id, isActive: true }, select: { role: true } });
  if (!current) throw new Error("Tài khoản không còn hoạt động.");
  return current;
}

export async function loadQuotationReuseCatalog(projectId: string, actor: Actor): Promise<QuotationReuseCatalogItem[]> {
  const current = await activeActor(actor);
  if (!["ACCOUNT", "ADMIN"].includes(current.role)) throw new Error("Chỉ Account/Admin được tạo báo giá.");
  const destination = await prisma.project.findFirst({
    where: { id: projectId, ...(current.role === "ADMIN" ? {} : { members: { some: { userId: actor.id } } }) },
    select: { id: true },
  });
  if (!destination) throw new Error("Bạn không có quyền trên project này.");
  const [templates, projects] = await Promise.all([
    prisma.quotationTemplate.findMany({ where: { status: "ACTIVE" }, orderBy: { createdAt: "desc" } }),
    prisma.project.findMany({
      where: { id: { not: projectId }, costFlow: { isNot: null }, ...(current.role === "ADMIN" ? {} : { members: { some: { userId: actor.id } } }) },
      select: { id: true, name: true, costFlow: { select: { data: true } } },
    }),
  ]);
  const historical = projects.flatMap(project => (asFinance(project.costFlow!.data).quotations ?? []).map(quotation => ({
    kind: "HISTORICAL_QUOTATION" as const,
    id: quotation.id,
    sourceProjectId: project.id,
    title: quotation.title,
    projectName: project.name,
    customer: quotation.customer,
    createdAt: quotation.createdAt,
  })));
  return [
    ...templates.map(template => ({ kind: "TEMPLATE" as const, id: template.id, title: template.name, description: template.description, createdAt: template.createdAt.toISOString() })),
    ...historical,
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function initializeQuotationReuseDraft(
  tx: Prisma.TransactionClient,
  projectId: string,
  actor: Actor,
  data: FinanceData,
  form: FormData,
) {
  const kind = String(form.get("reuseKind") ?? "") as QuotationReuseKind;
  const sourceId = String(form.get("reuseSourceId") ?? "");
  const mode = String(form.get("workspaceMode") ?? "");
  if (!["TEMPLATE", "HISTORICAL_QUOTATION"].includes(kind) || !sourceId) throw new Error("Chọn template hoặc báo giá cũ hợp lệ.");
  if (!["quote", "paired"].includes(mode)) throw new Error("Chọn màn tạo báo giá hợp lệ.");
  const destination = await tx.project.findUnique({ where: { id: projectId }, select: { name: true, client: { select: { id: true, name: true } } } });
  if (!destination) throw new Error("Không tìm thấy project đích.");

  let snapshot: QuotationReuseSnapshot;
  let label: string;
  let sourceDate: string;
  if (kind === "TEMPLATE") {
    const template = await tx.quotationTemplate.findFirst({ where: { id: sourceId, status: "ACTIVE" } });
    if (!template) throw new Error("Template không còn hoạt động.");
    snapshot = asSnapshot(template.snapshot);
    label = template.name;
    sourceDate = template.createdAt.toISOString();
  } else {
    const sourceProjectId = String(form.get("sourceProjectId") ?? "");
    if (!sourceProjectId || sourceProjectId === projectId) throw new Error("Báo giá dùng lại phải thuộc project khác.");
    const sourceProject = await tx.project.findFirst({
      where: { id: sourceProjectId, ...(actor.role === "ADMIN" ? {} : { members: { some: { userId: actor.id } } }) },
      select: { name: true, costFlow: { select: { data: true } } },
    });
    const quotation = sourceProject?.costFlow ? (asFinance(sourceProject.costFlow.data).quotations ?? []).find(item => item.id === sourceId) : undefined;
    if (!sourceProject || !quotation) throw new Error("Báo giá nguồn không tồn tại hoặc bạn không có quyền xem.");
    snapshot = quotationReuseSnapshot(quotation);
    label = `${sourceProject.name} · BG-${quotation.number} · ${quotation.title}`;
    sourceDate = quotation.createdAt;
  }

  const draft: PairedDraft = {
    linePricingSchemaVersion: 2,
    id: randomUUID(),
    version: 1,
    createdBy: actor.id,
    workspaceMode: mode as "quote" | "paired",
    title: destination.name,
    clientId: destination.client?.id ?? "",
    customer: destination.client?.name ?? "",
    notes: snapshot.notes,
    parameterConfig: snapshot.parameterConfig ? structuredClone(normalizeParameterSnapshot(snapshot.parameterConfig)) : undefined,
    rows: draftRows(snapshot),
    totalLines: normalizeQuotationTotals(structuredClone(snapshot.totalLines)),
    totalLayout: normalizeQuotationTotalLayout(snapshot.totalLines, structuredClone(snapshot.totalLayout)),
    globalEvidenceIds: [],
    reuseSource: { kind, label, sourceDate },
  };
  data.quotationDrafts = [...(data.quotationDrafts ?? []), draft];
  return draft;
}

export async function proposeQuotationTemplate(actor: Actor, projectId: string, quotationId: string, proposedName: string, note: string) {
  const current = await activeActor(actor);
  if (!["ACCOUNT", "ADMIN"].includes(current.role)) throw new Error("Chỉ Account/Admin được đề xuất template.");
  const project = await prisma.project.findFirst({
    where: { id: projectId, ...(current.role === "ADMIN" ? {} : { members: { some: { userId: actor.id } } }) },
    select: { costFlow: { select: { data: true } } },
  });
  const quotation = project?.costFlow ? (asFinance(project.costFlow.data).quotations ?? []).find(item => item.id === quotationId) : undefined;
  if (!quotation) throw new Error("Báo giá đã chốt không tồn tại hoặc bạn không có quyền xem.");
  const name = proposedName.trim().slice(0, 200);
  if (!name) throw new Error("Nhập tên template đề xuất.");
  const duplicate = await prisma.quotationTemplateProposal.findFirst({ where: { sourceProjectId: projectId, sourceQuotationId: quotationId, proposedBy: actor.id, status: "PENDING" }, select: { id: true } });
  if (duplicate) throw new Error("Bạn đã có một đề xuất đang chờ duyệt cho báo giá này.");
  return prisma.quotationTemplateProposal.create({ data: { sourceProjectId: projectId, sourceQuotationId: quotationId, proposedName: name, note: note.trim().slice(0, 2000), snapshot: json(quotationReuseSnapshot(quotation)), proposedBy: actor.id } });
}

export async function reviewQuotationTemplateProposal(actor: Actor, proposalId: string, decision: "APPROVE" | "REJECT", reason: string) {
  const current = await activeActor(actor);
  if (current.role !== "ADMIN") throw new Error("Chỉ Admin được duyệt template.");
  return prisma.$transaction(async tx => {
    const proposal = await tx.quotationTemplateProposal.findFirst({ where: { id: proposalId, status: "PENDING" } });
    if (!proposal) throw new Error("Đề xuất không còn ở trạng thái chờ duyệt.");
    const reviewedAt = new Date();
    if (decision === "REJECT") {
      const rejectionReason = reason.trim().slice(0, 2000);
      if (!rejectionReason) throw new Error("Nhập lý do từ chối.");
      await tx.quotationTemplateProposal.update({ where: { id: proposal.id }, data: { status: "REJECTED", rejectionReason, reviewedBy: actor.id, reviewedAt } });
      return null;
    }
    const template = await tx.quotationTemplate.create({ data: { name: proposal.proposedName, description: proposal.note, snapshot: json(proposal.snapshot), proposalId: proposal.id, createdBy: actor.id } });
    await tx.quotationTemplateProposal.update({ where: { id: proposal.id }, data: { status: "APPROVED", reviewedBy: actor.id, reviewedAt, templateId: template.id } });
    return template;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function setQuotationTemplateArchived(actor: Actor, templateId: string, archived: boolean) {
  const current = await activeActor(actor);
  if (current.role !== "ADMIN") throw new Error("Chỉ Admin được quản trị template.");
  const result = await prisma.quotationTemplate.updateMany({ where: { id: templateId }, data: { status: archived ? "ARCHIVED" : "ACTIVE", archivedAt: archived ? new Date() : null } });
  if (result.count !== 1) throw new Error("Không tìm thấy template.");
}
