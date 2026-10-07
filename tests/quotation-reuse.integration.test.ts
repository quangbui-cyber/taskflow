import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { FinanceData, Quotation } from "../lib/costflow/types";

test("quotation reuse catalog, independent drafts, review gate and template lifecycle", { skip: !process.env.COSTFLOW_TEST_DATABASE_URL }, async () => {
  const url = new URL(process.env.COSTFLOW_TEST_DATABASE_URL!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/costflow_test");
  process.env.DATABASE_URL = process.env.COSTFLOW_TEST_DATABASE_URL;
  const { prisma } = await import("../lib/prisma");
  const { emptyFinance } = await import("../lib/costflow/types");
  const { executeFinance } = await import("../lib/costflow/service");
  const { loadQuotationReuseCatalog, proposeQuotationTemplate, reviewQuotationTemplateProposal, setQuotationTemplateArchived } = await import("../lib/costflow/quotationReuse");
  const prefix = `reuse-${randomUUID()}`;
  const ids: string[] = [];
  try {
    const [admin, account, outsider] = await Promise.all([
      prisma.user.create({ data: { name: "Reuse Admin", email: `${prefix}-admin@example.test`, role: "ADMIN", passwordHash: "unused" } }),
      prisma.user.create({ data: { name: "Reuse Account", email: `${prefix}-account@example.test`, role: "ACCOUNT", passwordHash: "unused" } }),
      prisma.user.create({ data: { name: "Reuse Outsider", email: `${prefix}-outside@example.test`, role: "ACCOUNT", passwordHash: "unused" } }),
    ]);
    ids.push(admin.id, account.id, outsider.id);
    const client = await prisma.client.create({ data: { name: `${prefix}-client` } });
    const destination = await prisma.project.create({ data: { name: "Destination project", ownerId: account.id, clientId: client.id, members: { create: { userId: account.id } } } });
    const sourceProject = await prisma.project.create({ data: { name: "Accessible source", ownerId: account.id, members: { create: { userId: account.id } } } });
    const forbiddenProject = await prisma.project.create({ data: { name: "Forbidden source", ownerId: outsider.id, members: { create: { userId: outsider.id } } } });
    const makeQuotation = (title: string): Quotation => ({
      id: randomUUID(), number: 1, parentId: null, title, customer: "Old customer", notes: "Customer note", poIds: [], briefIds: [], evidenceIds: [], createdBy: account.id, createdAt: new Date("2026-09-01T00:00:00.000Z").toISOString(),
      lines: [{ id: randomUUID(), description: "Backdrop", unit: "bộ", quantity: "2", unitPrice: "1000", basis: "NET", vatPercent: "8", cost: { rawNet: "2000", rawVat: "160", rawGross: "2160", net: "2000", vat: "160", gross: "2160" } }],
      salesRows: [{ itemId: randomUUID(), parentItemId: null, rowType: "ITEM", name: "Backdrop", description: "In bạt", pricingMode: "DETAIL", showChildren: true, showGroupSubtotal: true, packageChildDisplay: "CONTENT", sell: { unit: "bộ", quantity: "2", unitPrice: "1000", vatPercent: "8", basis: "NET", notes: "Ghi chú khách" } }],
      totalLines: [], totalLayout: [],
    });
    const sourceQuotation = makeQuotation("Old quote");
    const forbiddenQuotation = makeQuotation("Secret quote");
    const sourceData = emptyFinance(); sourceData.quotations = [sourceQuotation];
    const forbiddenData = emptyFinance(); forbiddenData.quotations = [forbiddenQuotation];
    await prisma.costFlowWorkspace.createMany({ data: [
      { projectId: sourceProject.id, data: JSON.parse(JSON.stringify(sourceData)) },
      { projectId: forbiddenProject.id, data: JSON.parse(JSON.stringify(forbiddenData)) },
    ] });

    const catalog = await loadQuotationReuseCatalog(destination.id, account);
    assert.ok(catalog.some(item => item.id === sourceQuotation.id && item.sourceProjectId === sourceProject.id));
    assert.ok(!catalog.some(item => item.id === forbiddenQuotation.id));
    assert.ok(!catalog.some(item => item.sourceProjectId === destination.id));

    const act = async (fields: Record<string, string>, expectedVersion: number) => {
      const form = new FormData();
      for (const [key, value] of Object.entries(fields)) form.set(key, value);
      return executeFinance(destination.id, expectedVersion, account, form, null);
    };
    const created = await act({ command: "CREATE_REUSE_DRAFT", reuseKind: "HISTORICAL_QUOTATION", reuseSourceId: sourceQuotation.id, sourceProjectId: sourceProject.id, workspaceMode: "quote" }, 0);
    const workspace = await prisma.costFlowWorkspace.findUniqueOrThrow({ where: { projectId: destination.id } });
    const draft = (workspace.data as unknown as FinanceData).quotationDrafts!.find(item => item.id === created.draftId)!;
    assert.equal(draft.title, destination.name);
    assert.equal(draft.customer, client.name);
    assert.equal(draft.rows[0].sell.unitPrice, "1000");
    assert.equal(draft.rows[0].buy.unitPrice, "");
    assert.deepEqual(draft.globalEvidenceIds, []);
    assert.equal(draft.priceReviewRequired, true);

    const saveFields = { command: "FINALIZE_PAIRED_QUOTATION", draftId: draft.id, workspaceMode: "quote", saveIc: "no", globalEvidenceIds: "[]", rows: JSON.stringify(draft.rows), title: draft.title, clientId: draft.clientId, notes: draft.notes, totalLines: JSON.stringify(draft.totalLines ?? []), totalLayout: JSON.stringify(draft.totalLayout ?? []) };
    await assert.rejects(() => act(saveFields, 1), /Xác nhận đã rà soát/);
    const finalized = await act({ ...saveFields, priceReviewConfirmed: "yes" }, 1);
    const finalData = (await prisma.costFlowWorkspace.findUniqueOrThrow({ where: { projectId: destination.id } })).data as unknown as FinanceData;
    const quote = finalData.quotations!.find(item => item.id === finalized.quotationId)!;
    assert.equal(quote.parentId, null);
    assert.equal("reuseSource" in quote, false);
    assert.equal(finalData.quotationDrafts!.find(item => item.id === draft.id)!.reuseSource, undefined);

    await assert.rejects(() => act({ command: "CREATE_REUSE_DRAFT", reuseKind: "HISTORICAL_QUOTATION", reuseSourceId: forbiddenQuotation.id, sourceProjectId: forbiddenProject.id, workspaceMode: "paired" }, 2), /không tồn tại hoặc bạn không có quyền/);
    const proposal = await proposeQuotationTemplate(account, sourceProject.id, sourceQuotation.id, "Template backdrop", "Dùng cho activation");
    const template = await reviewQuotationTemplateProposal(admin, proposal.id, "APPROVE", "");
    assert.ok(template);
    assert.ok((await loadQuotationReuseCatalog(destination.id, account)).some(item => item.kind === "TEMPLATE" && item.id === template!.id));
    await setQuotationTemplateArchived(admin, template!.id, true);
    assert.ok(!(await loadQuotationReuseCatalog(destination.id, account)).some(item => item.id === template!.id));
    assert.equal((await prisma.quotationTemplate.findUniqueOrThrow({ where: { id: template!.id } })).status, "ARCHIVED");
  } finally {
    await prisma.quotationTemplate.deleteMany({ where: { OR: [{ name: { startsWith: prefix } }, { createdBy: { in: ids } }] } });
    await prisma.quotationTemplateProposal.deleteMany({ where: { proposedBy: { in: ids } } });
    const projects = await prisma.project.findMany({ where: { ownerId: { in: ids } }, select: { id: true } });
    const projectIds = projects.map(project => project.id);
    await prisma.costFlowHistory.deleteMany({ where: { projectId: { in: projectIds } } });
    await prisma.costFlowWorkspace.deleteMany({ where: { projectId: { in: projectIds } } });
    await prisma.project.deleteMany({ where: { ownerId: { in: ids } } });
    await prisma.client.deleteMany({ where: { name: { startsWith: prefix } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  }
});
