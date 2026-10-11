import "server-only";
import { randomUUID, createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { calculateCost, calculateLineCost, compare, decimal, round, sum } from "./money";
import { closeBlockers } from "./reconciliation";
import { emptyFinance, type FinanceData, type IcLine, type QuotationLine, type RequestPayload } from "./types";
import { decide, validateSteps, type ApprovalStep, type Decision } from "@/lib/workflow/approval";
import type { ProjectUpload } from "@/lib/projectFiles";
import { currentPurchaseOrders } from "./budgetSources";
import { completeIcLines, draftLineIssues } from "./budgetDraft";
import { workingIcRevision } from "./budgetRevisions";
import { validateIcLineOrigins } from "./budgetLineage";
import { quotationLineAncestors } from "./budgetQuotation";
import { validateIcEvidence, requestEvidenceIds } from "./icEvidence";
import { createPairedFromQuoteDraft, savePairedDraft, finalizePairedQuotation } from "./pairedService";
import { assertApprovalToken, correctionItems, recordApprovalEvent } from "@/lib/workflow/approvalEvents";
import { assertEligibleApprovalReceiver } from "@/lib/workflow/permissions";
import { initializeQuotationReuseDraft } from "./quotationReuse";
import { blankPairedRow, hydrateLinePricingData } from "./pairedDraft";
import { normalizeParameterBinding, parameterFinalizationIssues } from "./quotationParameters";
import { effectiveBaseline, icDecisionPolicy } from "./icEffectiveness";
import { normalizePaymentDraft } from "./paymentPolicy";
import type { PaymentDraftLineInput } from "./paymentTypes";
import { diffPaymentDossiers, type PaymentDossierSnapshot, type PaymentDocumentSnapshot } from "./paymentDiff";
import { derivePaymentProgress } from "./paymentCash";
import { projectPaymentLedger, type BeneficiaryVerification } from "./paymentReadModel";
import { resolveProductionApprovedActualCost } from "./approvedActualCost";
import { loadActualCosts } from "./actualCostReadModel";
import { operationAssignmentIds } from "./actualCostControlCenter";
import { approvedActualSettlementRoute, calculateSelectedAdvanceSettlement, type AdvanceSourceSelection } from "./paymentSettlement";
import { deriveCustomerAccounting, validateLiquidationAmounts } from "./customerAccounting";
import { projectQuotation } from "./quotationProjection";
import { createCustomerAcceptanceSnapshot, parseCustomerAcceptanceProjection, type CustomerAcceptanceActualInput } from "./customerAcceptanceProjection";
import { appendDigitalSigningEvent, finalizeDigitalApprovedSnapshot, requiresDigitalSignature, type DigitalSigningRole } from "@/lib/workflow/signing";

type Actor = { id: string; role: string };
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
function requireValue(value: string, label: string) { if (!value) throw new Error(`Thiếu ${label}.`); return value; }
function positive(value: string) { if (compare(decimal(value), decimal("0")) <= 0) throw new Error("Số tiền phải lớn hơn 0."); return value; }
function bounded(value: string, label: string, max = 160) { const result = requireValue(value, label); if (result.length > max) throw new Error(`${label} quá dài.`); return result; }
function calendarDate(value: string, label: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label} không hợp lệ.`);
  const result = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(result.getTime()) || result.toISOString().slice(0, 10) !== value) throw new Error(`${label} không hợp lệ.`);
  return result;
}

export async function loadFinance(projectId: string, actor: Actor) {
  const activeActor = await prisma.user.findFirst({where:{id:actor.id,isActive:true},select:{role:true}});
  if (!activeActor) return null;
  const [project, workspace] = await Promise.all([
    prisma.project.findUnique({ where: { id: projectId }, select: { id: true, name: true, ownerId: true, client: { select: { id: true, name: true } }, members: { select: { userId: true } } } }),
    prisma.costFlowWorkspace.findUnique({ where: { projectId } }),
  ]);
  if (!project) return null;
  const savedData = workspace?.data ? hydrateLinePricingData(workspace.data as unknown as FinanceData) : undefined;
  const ddGrant = await prisma.workflowRoleGrant.findFirst({ where: { userId: actor.id, role: "AC_DD", revokedAt: null }, select: { id: true } });
  const fullAccess = activeActor.role === "ADMIN" || !!ddGrant || savedData?.config.accountantId === actor.id || project.members.some(m => m.userId === actor.id);
  const requests = await prisma.workflowRequest.findMany({ where: { projectId, module: "COSTFLOW" }, include: { decisions: { orderBy: { createdAt: "asc" } }, approvalEvents: { orderBy: { createdAt: "asc" } }, signingLifecycle: { select: { mode: true, evidenceState: true } } }, orderBy: { createdAt: "desc" } });
  const readerIds = fullAccess ? [] : (await prisma.workflowRequestReader.findMany({ where: { userId: actor.id, request: { projectId, module: "COSTFLOW" } }, select: { requestId: true } })).map(row => row.requestId);
  const visible = fullAccess ? requests : requests.filter(r => readerIds.includes(r.id) || r.creatorId === actor.id || r.cashAssigneeId === actor.id || (r.steps as ApprovalStep[]).some(s => s.assigneeId === actor.id));
  if (!fullAccess && !visible.length) return null;
  const cash = await prisma.costFlowCash.findMany({ where: { projectId, ...(!fullAccess ? { requestId: { in: visible.map(r => r.id) } } : {}) }, include: { normalizedAllocations: { select: { requestLineId: true, amount: true, direction: true } } }, orderBy: { createdAt: "desc" } });
  const normalizedPaymentRequests = await prisma.workflowRequest.findMany({
    where: { id: { in: visible.map(request => request.id) }, paymentLines: { some: {} } },
    select: {
      id: true,
      kind: true,
      title: true,
      state: true,
      parentId: true,
      payload: true,
      paymentLines: { orderBy: { position: "asc" }, select: { id: true, stableKey: true, position: true, description: true, amount: true, icRevisionId: true, icLineId: true, sourceSnapshot: true, recipientKey: true, evidenceManifest: true } },
      paymentRecipients: { orderBy: { recipientKey: "asc" }, select: { recipientKey: true, recipientType: true, displayName: true, bankName: true, accountLast4: true, sourceVersion: true, totalAmount: true } },
      paymentDiscussions: { orderBy: { createdAt: "asc" }, select: { id: true, lineId: true, authorId: true, body: true, createdAt: true, author: { select: { name: true } } } },
    },
  });
  const supplements = (savedData?.evidenceSupplements ?? []).filter(s => fullAccess || visible.some(r => r.id === s.requestId));
  const linkedIds = requestEvidenceIds(visible, supplements);
  const evidence = await prisma.costFlowEvidence.findMany({ where: { projectId, ...(!fullAccess ? { OR: [{ requestId: { in: visible.map(r => r.id) } }, { id: { in: linkedIds } }] } : {}) }, select: { id: true, name: true, kind: true, requestId: true, sha256: true, mimeType: true } });
  const visibleActors = new Set(visible.flatMap(r => [r.creatorId, r.cashAssigneeId, ...(r.steps as ApprovalStep[]).map(s => s.assigneeId), ...r.decisions.map(d => d.actorId)]));
  const users = await prisma.user.findMany({ where: fullAccess ? { isActive: true } : { id: { in: [...visibleActors] } }, select: { id: true, name: true, role: true }, orderBy: { name: "asc" } });
  const files = fullAccess ? await prisma.projectFile.findMany({ where: { projectId }, select: { id: true, name: true }, orderBy: { createdAt: "desc" } }) : [];
  const history = fullAccess ? await prisma.costFlowHistory.findMany({ where: { projectId }, select: { id: true, actorId: true, action: true, version: true, createdAt: true }, orderBy: { version: "desc" }, take: 50 }) : [];
  const clients = fullAccess ? await prisma.client.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }) : [];
  const normalizedById = new Map(normalizedPaymentRequests.map(request => [request.id, request]));
  const paymentSnapshot = (request: typeof normalizedPaymentRequests[number]): PaymentDossierSnapshot => {
    const paymentPayload = request.payload && typeof request.payload === "object" ? request.payload as Record<string, unknown> : {};
    return {
      title: request.title,
      milestone: typeof paymentPayload.milestone === "string" ? paymentPayload.milestone : "",
      explanation: typeof paymentPayload.explanation === "string" ? paymentPayload.explanation : "",
      lines: request.paymentLines.map(line => ({
        stableKey: line.stableKey,
        position: line.position,
        description: line.description,
        amount: line.amount,
        icRevisionId: line.icRevisionId,
        icLineId: line.icLineId,
        recipientKey: line.recipientKey,
        documents: Array.isArray(line.evidenceManifest) ? line.evidenceManifest.filter((document): document is PaymentDocumentSnapshot => !!document && typeof document === "object" && "name" in document && typeof document.name === "string") : [],
      })),
    };
  };
  const paymentDossiers = normalizedPaymentRequests.map(request => {
    const paymentPayload = request.payload && typeof request.payload === "object" ? request.payload as Record<string, unknown> : {};
    const parent = request.parentId ? normalizedById.get(request.parentId) : undefined;
    return {
      requestId: request.id,
      kind: request.kind,
      title: request.title,
      state: request.state,
      milestone: typeof paymentPayload.milestone === "string" ? paymentPayload.milestone : "",
      totalAmount: typeof paymentPayload.amount === "string" ? paymentPayload.amount : "0",
      lines: request.paymentLines,
      recipients: request.paymentRecipients.map(recipient => {
        const paidOut = cash
          .filter(item => item.requestId === request.id && item.recipientKey === recipient.recipientKey && item.direction === "OUT" && item.normalizedAllocations.length > 0)
          .reduce((total, item) => total + BigInt(item.amount), BigInt(0));
        return { ...recipient, ...derivePaymentProgress(recipient.totalAmount, paidOut.toString()) };
      }),
      discussions: request.paymentDiscussions.map(discussion => ({ ...discussion, createdAt: discussion.createdAt.toISOString() })),
      diff: parent ? diffPaymentDossiers(paymentSnapshot(parent), paymentSnapshot(request)) : null,
    };
  });
  const paymentLedger = projectPaymentLedger({
    normalized: normalizedPaymentRequests.map(request => ({
      requestId: request.id,
      projectId,
      kind: request.kind,
      title: request.title,
      milestone: typeof (request.payload as Record<string, unknown> | null)?.milestone === "string" ? String((request.payload as Record<string, unknown>).milestone) : "",
      approvalState: request.state,
      recipients: request.paymentRecipients.map(recipient => {
        let beneficiaryVerification: BeneficiaryVerification = recipient.recipientType === "VENDOR" ? "UNVERIFIED" : "NOT_APPLICABLE";
        if (recipient.recipientType === "VENDOR" && recipient.recipientKey.startsWith("VENDOR:")) {
          const beneficiary = savedData?.beneficiaries.find(item => `VENDOR:${item.id}` === recipient.recipientKey);
          if (beneficiary && beneficiary.version === recipient.sourceVersion && beneficiary.verifiedVersion === beneficiary.version) beneficiaryVerification = "VERIFIED";
        }
        return { recipientKey: recipient.recipientKey, recipientType: recipient.recipientType, displayName: recipient.displayName, totalAmount: recipient.totalAmount, beneficiaryVerification };
      }),
      lines: request.paymentLines.map(line => ({ id: line.id, recipientKey: line.recipientKey, amount: line.amount })),
    })),
    legacy: visible.map(request => ({ id: request.id, projectId: request.projectId, kind: request.kind, title: request.title, state: request.state, payload: request.payload })),
    cash: cash.map(item => ({ id: item.id, projectId: item.projectId, requestId: item.requestId, recipientKey: item.recipientKey, direction: item.direction, amount: item.amount, evidenceId: item.evidenceId, normalizedAllocations: item.normalizedAllocations })),
    financialCloseState: savedData?.closed ? "CLOSED" : "OPEN",
  });
  const actualCosts = fullAccess ? await loadActualCosts(projectId, actor, paymentLedger) : null;
  const [customerLiquidations, customerCashIns] = fullAccess ? await Promise.all([
    prisma.customerLiquidation.findMany({ where: { projectId }, include: { evidence: { select: { id: true, name: true, sha256: true } } }, orderBy: { version: "asc" } }),
    prisma.customerCashIn.findMany({ where: { projectId }, include: { evidence: { select: { id: true, name: true, sha256: true } } }, orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }] }),
  ]) : [[], []];
  let quotation: { net: string; gross: string } | null = null;
  const latestQuotation = savedData?.quotations?.at(-1);
  if (latestQuotation) {
    try {
      const amount = projectQuotation(latestQuotation).amount;
      quotation = { net: amount.net, gross: amount.gross };
    } catch {
      quotation = null;
    }
  }
  const purchaseOrderNet = savedData ? round(sum(currentPurchaseOrders(savedData.pos).map(po => decimal(po.net)))) : "0";
  const customerAccounting = deriveCustomerAccounting({
    liquidations: customerLiquidations.map(item => ({ id: item.id, version: item.version, documentNumber: item.documentNumber, signedAt: item.signedAt.toISOString(), netAmount: item.netAmount, vatAmount: item.vatAmount, grossAmount: item.grossAmount, evidence: item.evidence, createdAt: item.createdAt.toISOString() })),
    cashIns: customerCashIns.map(item => ({ id: item.id, liquidationId: item.liquidationId, milestone: item.milestone, occurredAt: item.occurredAt.toISOString(), amount: item.amount, reference: item.reference, evidence: item.evidence, createdAt: item.createdAt.toISOString() })),
    quotation,
    purchaseOrderNet,
    actualCosts: (actualCosts?.lines ?? []).flatMap(line => line.cost ? [{ stableLineId: line.stableLineId, source: line.source, cost: line.cost }] : []),
  });
  const canManageCustomerAccounting = activeActor.role === "ADMIN" || project.members.some(item => item.userId === actor.id);
  const customerAcceptanceSnapshots = fullAccess ? (await prisma.customerAcceptanceSnapshot.findMany({
    where: { projectId },
    select: { id: true, version: true, quotationId: true, projection: true, createdAt: true },
    orderBy: { version: "desc" },
    take: 20,
  })).flatMap(snapshot => {
    const projection = parseCustomerAcceptanceProjection(snapshot.projection);
    return projection ? [{ id: snapshot.id, version: snapshot.version, quotationId: snapshot.quotationId, projection, createdAt: snapshot.createdAt.toISOString() }] : [];
  }) : [];
  const settlementDossier = fullAccess ? await prisma.projectSettlementDossier.findUnique({
    where: { projectId },
    include: {
      versions: {
        orderBy: { version: "desc" },
        include: {
          request: { select: { id: true, state: true, version: true, currentStep: true, currentAttemptId: true, steps: true } },
          obligations: { orderBy: { recipientKey: "asc" } },
          evidence: { select: { id: true, evidenceId: true, kind: true, sha256: true, addedById: true, createdAt: true } },
          locks: { select: { id: true, actualCostApplicationId: true, advanceApplicationId: true, sourceCashAllocationId: true, lockedAt: true } },
        },
      },
    },
  }) : null;
  return { project: { ...project, members: fullAccess ? project.members : [], client: fullAccess ? project.client : null }, clients, fullAccess, canManageCustomerAccounting, version: workspace?.version ?? 0, data: fullAccess && savedData ? savedData : { ...emptyFinance(), closed: savedData?.closed ?? false }, requests: visible.map(({ signingLifecycle, ...request }) => ({ ...request, signingMode: signingLifecycle?.mode ?? null, signingEvidenceState: signingLifecycle?.evidenceState ?? null })), cash, users, files, evidence, supplements, history, paymentDossiers, paymentLedger, actualCosts, customerAccounting, customerAcceptanceSnapshots, settlementDossier };
}

export async function executeFinance(projectId: string, expectedVersion: number, actor: Actor, form: FormData, upload: ProjectUpload | null) {
  return prisma.$transaction(async tx => {
    const project = await tx.project.findUnique({ where: { id: projectId }, select: { ownerId: true, members: { select: { userId: true } } } });
    if (!project) throw new Error("Không tìm thấy project.");
    const member = project.members.some(m => m.userId === actor.id);
    const currentActor = await tx.user.findFirst({ where: { id: actor.id, isActive: true }, select: { role: true, managerId: true } });
    if (!currentActor) throw new Error("Tài khoản không còn hoạt động.");
    const isAdmin = currentActor.role === "ADMIN";
    const canCreate = (member || isAdmin) && ["ADMIN", "ACCOUNT"].includes(currentActor.role);
    let workspace = await tx.costFlowWorkspace.findUnique({ where: { projectId } });
    if (!workspace) {
      if (!member && !isAdmin) throw new Error("Bạn không có quyền trên project này.");
      workspace = await tx.costFlowWorkspace.create({ data: { projectId, data: json(emptyFinance()) } });
    }

    const data = hydrateLinePricingData(workspace.data as unknown as FinanceData);
    const cash = await tx.costFlowCash.findMany({ where: { projectId } });
    const requests = await tx.workflowRequest.findMany({ where: { projectId, module: "COSTFLOW" } });
    const command = requireValue(text(form, "command"), "thao tác");
    let savedRevisionId: string | undefined;
    let savedQuotationId: string | undefined;
    let savedDraftId: string | undefined;
    let savedBeneficiaryId: string | undefined;
    let savedCustomerAcceptanceId: string | undefined;
    let savedCustomerAcceptanceVersion: number | undefined;
    let savedScopes: string[] | undefined;
    let customerCashFingerprint: string | undefined;
    let customerCashIdempotencyKey: string | undefined;
    const request = requests.find(r => r.id === text(form, "requestId"));
    let affectedRequestId = request?.id;
    const payload = request?.payload as RequestPayload | undefined;
    const approvalSubmittedVersion = async () => request?.currentAttemptId
      ? (await tx.workflowApprovalEvent.findFirst({ where: { requestId: request.id, attemptId: request.currentAttemptId, action: "SUBMIT" }, select: { submittedVersion: true }, orderBy: { createdAt: "desc" } }))?.submittedVersion ?? null
      : null;
    if (command === "SUPPLEMENT_IC_EVIDENCE") {
      const existing = data.evidenceSupplements?.find(s => s.operationId === text(form, "operationId"));
      if (existing) {
        const ids = JSON.parse(text(form, "evidenceIds") || "[]");
        if (!canCreate || existing.actorId !== actor.id || existing.requestId !== request?.id || existing.lineId !== text(form, "lineId") || existing.requestVersion !== Number(text(form, "requestVersion")) || existing.reason !== text(form, "reason") || JSON.stringify(existing.evidenceIds) !== JSON.stringify(ids)) throw new Error("Mã thao tác đã dùng với nội dung khác.");
        return { success: "Bổ sung này đã được lưu.", version: workspace.version };
      }
    }
    if (command === "ADD_CUSTOMER_CASH_IN") {
      if (!member && !isAdmin) throw new Error("Bạn không có quyền ghi nhận tiền khách hàng trên Project này.");
      customerCashIdempotencyKey = bounded(text(form, "idempotencyKey"), "mã chống ghi trùng", 200);
      if (!upload) throw new Error("Thiếu chứng từ tiền khách hàng đã thu.");
      customerCashFingerprint = createHash("sha256").update(JSON.stringify({
        milestone: text(form, "milestone"),
        occurredAt: text(form, "occurredAt"),
        amount: text(form, "amount"),
        reference: text(form, "reference"),
        evidenceSha256: createHash("sha256").update(upload.data).digest("hex"),
      })).digest("hex");
      const existing = await tx.customerCashIn.findUnique({ where: { projectId_idempotencyKey: { projectId, idempotencyKey: customerCashIdempotencyKey } }, select: { id: true, commandFingerprint: true } });
      if (existing) {
        if (existing.commandFingerprint !== customerCashFingerprint) throw new Error("Mã chống ghi trùng đã được dùng với nội dung khác.");
        return { success: "Khoản thu này đã được ghi nhận trước đó.", cashId: existing.id, idempotent: true, version: workspace.version };
      }
    }
    if (workspace.version !== expectedVersion) throw new Error("Dữ liệu đã thay đổi. Tải lại trang trước khi thao tác.");
    const steps = request?.steps as ApprovalStep[] | undefined;
    const canReadRequest = !!request && (member || isAdmin || request.creatorId === actor.id || request.cashAssigneeId === actor.id || !!steps?.some(s => s.assigneeId === actor.id));
    if (!member && !isAdmin && (!canReadRequest || !["DECIDE", "CASH", "TRANSFER", "IC_MANAGER_EXPLANATION", "ADD_PAYMENT_LINE_DISCUSSION"].includes(command))) throw new Error("Bạn chỉ được xử lý hồ sơ được phân công.");
    if (data.closed && command !== "CONFIGURE" && !(command === "CREATE_REQUEST" && text(form, "kind") === "REOPEN") && !(["DECIDE", "TRANSFER"].includes(command) && request?.kind === "REOPEN")) throw new Error("Tài chính đã đóng. Cần yêu cầu Quản lý mở lại.");
    const needCreator = () => { if (!canCreate) throw new Error("Chỉ Account/người lập được phân công mới được lập hoặc sửa hồ sơ tài chính."); };
    const activeUser = async (id: string) => {
      if (!id || !await tx.user.findFirst({ where: { id, isActive: true }, select: { id: true } })) throw new Error("Thiếu người xử lý đang hoạt động.");
      return id;
    };
    const snapshotFile = async (fileId: string, kind: string, requestId?: string) => {
      if (!fileId) return null;
      if (!member && !isAdmin) throw new Error("Người ngoài project cần tải chứng từ mới vào hồ sơ được giao.");
      const file = await tx.projectFile.findFirst({ where: { id: fileId, projectId } });
      if (!file) throw new Error("Chứng từ phải thuộc đúng project.");
      const saved = await tx.costFlowEvidence.create({ data: { projectId, requestId, sourceFileId: file.id, kind, name: file.name, mimeType: file.mimeType, data: file.data, sha256: createHash("sha256").update(file.data).digest("hex"), createdBy: actor.id } });
      return saved.id;
    };
    const snapshotUpload = async (kind: string) => {
      if (!upload) throw new Error("Thiếu chứng từ tải lên.");
      return tx.costFlowEvidence.create({ data: { projectId, sourceFileId: `UPLOAD:${randomUUID()}`, kind, name: upload.name, mimeType: upload.mimeType, data: upload.data, sha256: createHash("sha256").update(upload.data).digest("hex"), createdBy: actor.id } });
    };
    const ordinarySteps = async (): Promise<ApprovalStep[]> => {
      const chain = validateSteps([{ role: "MANAGER", assigneeId: currentActor.managerId ?? "" }, { role: "ACCOUNTANT", assigneeId: data.config.accountantId }, { role: "CEO", assigneeId: data.config.ceoId }]);
      for (const step of chain) await activeUser(step.assigneeId);
      return chain;
    };
    const createRequest = async (kind: string, body: RequestPayload, chain: ApprovalStep[], state = "SUBMITTED") => {
      const parentId = text(form, "parentRequestId");
      const parent = parentId ? requests.find(r => r.id === parentId && r.kind === kind && r.creatorId === actor.id && ["RETURNED", "REJECTED", "WITHDRAWN", "CANCELLED"].includes(r.state)) : undefined;
      if (parentId && !parent) throw new Error("Hồ sơ nguồn không thuộc đúng loại/project/người lập hoặc chưa ở trạng thái được gửi lại.");
      if (parent) {
        const response = String(body.explanation ?? "").trim();
        if (!response) throw new Error("Cần một phản hồi chung cho các nội dung được yêu cầu sửa trước khi gửi lại.");
        body.resubmission = { sourceRequestId: parent.id, sourceAttemptId: parent.currentAttemptId ?? "", response };
      }
      const attemptId = state === "SUBMITTED" ? randomUUID() : null;
      const saved = await tx.workflowRequest.create({ data: { projectId, module: "COSTFLOW", kind, title: requireValue(text(form, "title"), "tên hồ sơ"), creatorId: actor.id, cashAssigneeId: actor.id, parentId: parentId || null, steps: json(chain), payload: json(body), state, currentAttemptId: attemptId, currentStepArrivedAt: attemptId ? new Date() : null } });
      affectedRequestId = saved.id;
      if (attemptId) await appendDigitalSigningEvent(tx, { requestId: saved.id, version: saved.version, kind: saved.kind, role: "CREATOR", actorId: actor.id, signatureData: form.get("signatureData"), signaturePin: form.get("signaturePin"), commandKey: `SUBMIT:${attemptId}:CREATOR` });
      if (attemptId) await recordApprovalEvent(tx, { requestId: saved.id, module: saved.module, attemptId, submittedVersion: saved.version, mutationVersion: saved.version, stepIndex: 0, role: chain[0]?.role ?? "MANAGER", actorId: actor.id, action: "SUBMIT", recipients: chain[0]?.assigneeId ? [chain[0].assigneeId] : [] });
      return saved;
    };
    const recipient = async (key: string) => {
      if (key.startsWith("USER:")) {
        const id = key.slice(5);
        if (!project.members.some(m => m.userId === id)) throw new Error("Nhân viên nhận tạm ứng phải thuộc project.");
        await activeUser(id);
      } else if (key.startsWith("VENDOR:")) {
        if (!data.beneficiaries.some(b => `VENDOR:${b.id}` === key)) throw new Error("Chưa có thông tin người thụ hưởng NCC.");
      } else throw new Error("Chọn người nhận/NCC.");
      return key;
    };
    const requireEffectiveIc = (id: string) => {
      const revision = data.revisions.find(r => r.id === id && r.effective);
      if (!revision) throw new Error("Cần IC đang có hiệu lực.");
      return revision;
    };
    const assertClose = () => {
      const blockers = closeBlockers(data, cash);
      if (blockers.length) throw new Error(blockers.join(" "));
    };
    const resolvePaymentDraft = async () => {
      const parsedLines = JSON.parse(text(form, "lines") || "[]") as Array<{
        stableKey?: unknown;
        description?: unknown;
        amount?: unknown;
        revisionId?: unknown;
        lineId?: unknown;
        recipientKey?: unknown;
        evidenceIds?: unknown;
      }>;
      if (!Array.isArray(parsedLines)) throw new Error("Danh sách khoản đề nghị không hợp lệ.");
      const sourceEvidenceIds = [...new Set(parsedLines.flatMap(line => Array.isArray(line.evidenceIds) ? line.evidenceIds.filter((id): id is string => typeof id === "string") : []))];
      const evidenceRows = sourceEvidenceIds.length ? await tx.costFlowEvidence.findMany({
        where: { projectId, id: { in: sourceEvidenceIds } },
        select: { id: true, name: true, kind: true, mimeType: true, sha256: true },
      }) : [];
      if (evidenceRows.length !== sourceEvidenceIds.length) throw new Error("Minh chứng của khoản đề nghị phải thuộc đúng Project.");
      const evidenceById = new Map(evidenceRows.map(row => [row.id, row]));
      const resolvedLines: PaymentDraftLineInput[] = [];
      for (const rawLine of parsedLines) {
        const revisionId = String(rawLine.revisionId ?? "").trim();
        const lineId = String(rawLine.lineId ?? "").trim();
        const revision = requireEffectiveIc(revisionId);
        const sourceLine = revision.lines.find(line => line.id === lineId);
        if (!sourceLine) throw new Error("Mỗi khoản phải truy được một dòng thuộc IC hiệu lực của Project.");
        const recipientKey = await recipient(String(rawLine.recipientKey ?? "").trim());
        let recipientInput: PaymentDraftLineInput["recipient"];
        if (recipientKey.startsWith("USER:")) {
          const userId = recipientKey.slice(5);
          const savedUser = await tx.user.findFirst({ where: { id: userId, isActive: true }, select: { name: true } });
          if (!savedUser) throw new Error("Người nhận nội bộ không còn hoạt động.");
          recipientInput = { projectId, key: recipientKey, type: "EMPLOYEE", name: savedUser.name };
        } else {
          const beneficiary = data.beneficiaries.find(item => `VENDOR:${item.id}` === recipientKey);
          if (!beneficiary) throw new Error("Không tìm thấy người thụ hưởng NCC trong Project.");
          const accountDigits = beneficiary.account.replace(/\D/g, "");
          recipientInput = { projectId, key: recipientKey, type: "VENDOR", name: beneficiary.name, bankName: beneficiary.bank, accountLast4: accountDigits ? accountDigits.slice(-4) : undefined, sourceVersion: beneficiary.version };
        }
        resolvedLines.push({
          stableKey: String(rawLine.stableKey ?? ""),
          description: String(rawLine.description ?? ""),
          amount: String(rawLine.amount ?? ""),
          source: { projectId, revisionId, lineId, budgetGross: (sourceLine.cost ?? calculateLineCost(sourceLine)).gross },
          recipient: recipientInput,
          evidenceIds: Array.isArray(rawLine.evidenceIds) ? rawLine.evidenceIds.filter((id): id is string => typeof id === "string") : [],
        });
      }
      const projection = normalizePaymentDraft({ projectId, kind: "ADVANCE", budgetEffectStatus: "EFFECTIVE", milestone: text(form, "milestone"), explanation: text(form, "explanation"), clientTotal: text(form, "clientTotal"), lines: resolvedLines });
      const vendorIds = [...new Set(projection.lines.filter(line => line.recipient.type === "VENDOR").map(line => line.recipient.key.slice("VENDOR:".length)))];
      const vendorProofIds = vendorIds.map(id => data.beneficiaries.find(beneficiary => beneficiary.id === id)?.proofId).filter((id): id is string => !!id);
      const vendorProofs = vendorProofIds.length ? await tx.costFlowEvidence.findMany({ where: { projectId, id: { in: vendorProofIds } }, select: { id: true, sha256: true } }) : [];
      const vendorProofById = new Map(vendorProofs.map(proof => [proof.id, proof]));
      const vendorSnapshots = vendorIds.map(id => {
        const beneficiary = data.beneficiaries.find(item => item.id === id);
        const proof = beneficiary ? vendorProofById.get(beneficiary.proofId) : undefined;
        if (!beneficiary || !proof) throw new Error("Mỗi NCC cần thông tin người thụ hưởng và căn cứ xác minh hiện hành trước khi gửi.");
        return { recipientKey: `VENDOR:${id}`, sourceVersion: beneficiary.version, proofId: beneficiary.proofId, proofSha256: proof.sha256 };
      });
      return { projection, evidenceById, vendorSnapshots };
    };
    const resolveApprovedActuals = async () => {
      let lineRefs: { stableLineId: string; versionId: string; approvalEventId: string; approvalAttemptId: string }[] | undefined;
      const rawRefs = text(form, "acLineRefs");
      if (rawRefs) {
        const parsed = JSON.parse(rawRefs) as unknown;
        if (!Array.isArray(parsed)) throw new Error("Danh sách nguồn AC đã duyệt không hợp lệ.");
        lineRefs = parsed.map(item => {
          if (!item || typeof item !== "object") throw new Error("Nguồn AC đã duyệt không hợp lệ.");
          const value = item as Record<string, unknown>;
          return { stableLineId: String(value.stableLineId ?? ""), versionId: String(value.versionId ?? ""), approvalEventId: String(value.approvalEventId ?? ""), approvalAttemptId: String(value.approvalAttemptId ?? "") };
        });
      }
      return resolveProductionApprovedActualCost({
        projectId,
        versionId: text(form, "acVersionId"),
        approvalEventId: text(form, "acApprovalEventId"),
        approvalAttemptId: text(form, "acApprovalAttemptId"),
        lineIds: lineRefs?.map(ref => ref.stableLineId) ?? form.getAll("acLineIds").map(String).filter(Boolean),
        lineRefs,
      });
    };
    const applyActualCosts = async (requestId: string, approvedLines: Awaited<ReturnType<typeof resolveApprovedActuals>>) => {
      for (const approved of approvedLines) {
        if (!approved.lineId) throw new Error("Dòng AC đã duyệt thiếu định danh nguồn.");
        const activeUse = await tx.actualCostApplication.findFirst({ where: { versionId: approved.versionId, state: "ACTIVE", request: { state: { notIn: ["WITHDRAWN", "REJECTED", "CANCELLED"] } } }, select: { id: true } });
        if (activeUse) throw new Error("Dòng AC đã được một hồ sơ settlement đang hoạt động sử dụng.");
        await tx.actualCostApplication.create({ data: {
          projectId,
          lineId: approved.lineId,
          versionId: approved.versionId,
          approvalId: approved.approvalEventId,
          requestId,
          recipientKey: approved.recipientKey,
          amount: approved.approvedAmount,
          createdById: actor.id,
        } });
      }
    };
    const resolveSelectedAdvances = async (recipientKey: string): Promise<AdvanceSourceSelection[]> => {
      const raw = text(form, "selectedAdvances");
      if (!raw) return [];
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed) || !parsed.length) throw new Error("Account phải chọn rõ nguồn tạm ứng; hệ thống không áp dụng FIFO.");
      const requested = parsed.map(item => {
        if (!item || typeof item !== "object") throw new Error("Nguồn tạm ứng được chọn không hợp lệ.");
        const value = item as Record<string, unknown>;
        const advanceLineId = String(value.advanceLineId ?? "");
        const selectedAmount = String(value.selectedAmount ?? "");
        if (!advanceLineId || !/^[1-9]\d*$/.test(selectedAmount)) throw new Error("Nguồn và số tiền tạm ứng được chọn phải hợp lệ.");
        return { advanceLineId, selectedAmount };
      });
      if (new Set(requested.map(item => item.advanceLineId)).size !== requested.length) throw new Error("Nguồn tạm ứng bị chọn trùng hoặc đã tái sử dụng.");
      const rows = await tx.paymentRequestLine.findMany({
        where: { projectId, id: { in: requested.map(item => item.advanceLineId) } },
        include: {
          request: { select: { id: true, projectId: true, kind: true, state: true } },
          cashAllocations: { where: { direction: "OUT" }, select: { amount: true } },
          advanceApplications: { select: { amount: true } },
        },
      });
      if (rows.length !== requested.length) throw new Error("Nguồn tạm ứng không thuộc Project hoặc không còn khả dụng.");
      return requested.map(selection => {
        const row = rows.find(candidate => candidate.id === selection.advanceLineId)!;
        if (row.request.projectId !== projectId || row.request.kind !== "ADVANCE" || row.request.state !== "APPROVED") throw new Error("Chỉ được chọn dòng tạm ứng đã duyệt trong cùng Project.");
        if (row.recipientKey !== recipientKey) throw new Error("Không được chọn nguồn tạm ứng chéo người nhận.");
        return {
          projectId,
          recipientKey,
          advanceRequestId: row.request.id,
          advanceLineId: row.id,
          grossOutAmount: row.cashAllocations.reduce((sum, allocation) => sum + BigInt(allocation.amount), BigInt(0)).toString(),
          alreadyAppliedAmount: row.advanceApplications.reduce((sum, application) => sum + BigInt(application.amount), BigInt(0)).toString(),
          selectedAmount: selection.selectedAmount,
        };
      });
    };
    const applySelectedAdvances = async (requestId: string, approvedLines: Awaited<ReturnType<typeof resolveApprovedActuals>>, sources: AdvanceSourceSelection[]) => {
      if (!sources.length) return;
      const expenseId = approvedLines.length === 1 ? approvedLines[0].stableLineId : `AC_SET:${requestId}`;
      for (const source of sources) {
        await tx.advanceApplication.create({ data: {
          projectId,
          advanceRequestId: source.advanceRequestId,
          advanceLineId: source.advanceLineId,
          expenseId,
          recipientKey: source.recipientKey,
          amount: source.selectedAmount,
          createdBy: actor.id,
        } });
      }
    };

    switch (command) {
      case "SAVE_CUSTOMER_ACCEPTANCE": {
        needCreator();
        const rawActualRows = JSON.parse(text(form, "actualRows") || "[]") as unknown;
        if (!Array.isArray(rawActualRows) || rawActualRows.some(row => !row || typeof row !== "object" || Array.isArray(row))) throw new Error("Dữ liệu nghiệm thu thực tế không hợp lệ.");
        const actualRows: CustomerAcceptanceActualInput[] = rawActualRows.map(row => {
          const value = row as Record<string, unknown>;
          if (typeof value.rowId !== "string" || typeof value.quantity !== "string" || typeof value.days !== "string") throw new Error("Dữ liệu nghiệm thu thực tế không hợp lệ.");
          return { rowId: value.rowId, quantity: value.quantity, days: value.days };
        });
        const result = await createCustomerAcceptanceSnapshot(tx, {
          projectId,
          quotationId: requireValue(text(form, "quotationId"), "phiên bản báo giá"),
          liquidationId: text(form, "liquidationId") || undefined,
          actorId: actor.id,
          actualRows,
          selectedActualCostVersionIds: form.getAll("selectedActualCostVersionIds").map(String),
        });
        savedCustomerAcceptanceId = result.id;
        savedCustomerAcceptanceVersion = result.version;
        break;
      }
      case "SAVE_CUSTOMER_LIQUIDATION": {
        if (!member && !isAdmin) throw new Error("Bạn không có quyền lưu thanh lý khách hàng trên Project này.");
        const documentNumber = bounded(text(form, "documentNumber"), "số biên bản thanh lý", 120);
        const signedAt = calendarDate(text(form, "signedAt"), "Ngày ký thanh lý");
        const amounts = validateLiquidationAmounts({ netAmount: text(form, "netAmount"), vatAmount: text(form, "vatAmount"), grossAmount: text(form, "grossAmount") });
        const evidence = await snapshotUpload("CUSTOMER_LIQUIDATION");
        const latest = await tx.customerLiquidation.findFirst({ where: { projectId }, orderBy: { version: "desc" }, select: { version: true } });
        await tx.customerLiquidation.create({ data: {
          projectId,
          version: (latest?.version ?? 0) + 1,
          documentNumber,
          signedAt,
          ...amounts,
          evidenceId: evidence.id,
          sourceSnapshot: json({ documentNumber, signedAt: signedAt.toISOString(), ...amounts, evidence: { id: evidence.id, name: evidence.name, sha256: evidence.sha256 } }),
          createdById: actor.id,
        } });
        break;
      }
      case "ADD_CUSTOMER_CASH_IN": {
        if (!member && !isAdmin || !customerCashFingerprint || !customerCashIdempotencyKey) throw new Error("Bạn không có quyền ghi nhận tiền khách hàng trên Project này.");
        const milestone = bounded(text(form, "milestone"), "mốc thu tiền", 120);
        const occurredAt = calendarDate(text(form, "occurredAt"), "Ngày thu tiền");
        const amount = positive(text(form, "amount"));
        if (!/^\d+$/.test(amount)) throw new Error("Số tiền khách hàng đã thu phải là số nguyên VND dương.");
        const reference = bounded(text(form, "reference"), "mã tham chiếu", 160);
        const evidence = await snapshotUpload("CUSTOMER_CASH_IN");
        const liquidation = await tx.customerLiquidation.findFirst({ where: { projectId }, orderBy: { version: "desc" }, select: { id: true } });
        await tx.customerCashIn.create({ data: { projectId, liquidationId: liquidation?.id, milestone, occurredAt, amount, reference, evidenceId: evidence.id, idempotencyKey: customerCashIdempotencyKey, commandFingerprint: customerCashFingerprint, createdById: actor.id } });
        break;
      }
      case "CREATE_PAYMENT_DOSSIER": {
        needCreator();
        const kind = text(form, "kind");
        if (kind !== "ADVANCE") throw new Error("Lát cắt đa khoản hiện chỉ hỗ trợ Đề nghị tạm ứng.");
        const { projection, evidenceById, vendorSnapshots } = await resolvePaymentDraft();
        const chain = await ordinarySteps();
        const expectedSettlementDate = calendarDate(text(form, "expectedSettlementDate"), "hạn hoàn ứng dự kiến").toISOString().slice(0, 10);
        const attemptId = randomUUID();
        const saved = await tx.workflowRequest.create({
          data: {
            projectId,
            module: "COSTFLOW",
            kind: "ADVANCE",
            title: requireValue(text(form, "title"), "tên hồ sơ"),
            creatorId: actor.id,
            cashAssigneeId: actor.id,
            state: "SUBMITTED",
            steps: json(chain),
            currentAttemptId: attemptId,
            currentStepArrivedAt: new Date(),
            payload: json({
              normalizedPayment: true,
              milestone: projection.milestone,
              explanation: projection.explanation,
              expectedSettlementDate,
              amount: projection.totalAmount,
              recipientTotals: projection.recipientTotals,
              warnings: projection.warnings,
              vendorSnapshots,
            }),
          },
        });
        affectedRequestId = saved.id;
        await appendDigitalSigningEvent(tx, { requestId: saved.id, version: saved.version, kind: saved.kind, role: "CREATOR", actorId: actor.id, signatureData: form.get("signatureData"), signaturePin: form.get("signaturePin"), commandKey: `SUBMIT:${attemptId}:CREATOR` });
        await recordApprovalEvent(tx, { requestId: saved.id, module: saved.module, attemptId, submittedVersion: saved.version, mutationVersion: saved.version, stepIndex: 0, role: chain[0]?.role ?? "MANAGER", actorId: actor.id, action: "SUBMIT", recipients: chain[0]?.assigneeId ? [chain[0].assigneeId] : [] });
        for (const [recipientKey, totalAmount] of Object.entries(projection.recipientTotals)) {
          const resolved = projection.lines.find(line => line.recipient.key === recipientKey)!.recipient;
          await tx.paymentRecipientSnapshot.create({ data: { projectId, requestId: saved.id, recipientKey, recipientType: resolved.type, displayName: resolved.name, bankName: resolved.bankName, accountLast4: resolved.accountLast4, sourceVersion: resolved.sourceVersion, totalAmount } });
        }
        for (const line of projection.lines) {
          await tx.paymentRequestLine.create({ data: {
            projectId,
            requestId: saved.id,
            stableKey: line.stableKey,
            position: line.position,
            description: line.description,
            amount: line.amount,
            icRevisionId: line.source.revisionId,
            icLineId: line.source.lineId,
            sourceSnapshot: json({ ...line.source, effective: true }),
            recipientKey: line.recipient.key,
            evidenceManifest: json(line.evidenceIds.map(id => evidenceById.get(id))),
          } });
        }
        break;
      }
      case "RESUBMIT_PAYMENT_DOSSIER": {
        needCreator();
        if (!request || request.creatorId !== actor.id || request.kind !== "ADVANCE" || request.state !== "DRAFT" || !request.parentId) throw new Error("Chỉ người lập được sửa và gửi lại bản nháp ĐNTU liên kết.");
        const parent = await tx.workflowRequest.findFirst({
          where: { id: request.parentId, projectId, module: "COSTFLOW", kind: request.kind },
          include: { paymentLines: { orderBy: { position: "asc" } } },
        });
        if (!parent || !["RETURNED", "REJECTED"].includes(parent.state) || !parent.paymentLines.length) throw new Error("Bản nguồn không còn ở trạng thái cho phép gửi lại.");
        const response = requireValue(text(form, "explanation"), "phản hồi chung cho nội dung được yêu cầu sửa");
        const { projection, evidenceById, vendorSnapshots } = await resolvePaymentDraft();
        const chain = await ordinarySteps();
        const expectedSettlementDate = calendarDate(text(form, "expectedSettlementDate"), "hạn hoàn ứng dự kiến").toISOString().slice(0, 10);
        const attemptId = randomUUID();
        const parentPayload = parent.payload && typeof parent.payload === "object" ? parent.payload as Record<string, unknown> : {};
        const beforeSnapshot: PaymentDossierSnapshot = {
          title: parent.title,
          milestone: typeof parentPayload.milestone === "string" ? parentPayload.milestone : "",
          explanation: typeof parentPayload.explanation === "string" ? parentPayload.explanation : "",
          lines: parent.paymentLines.map(line => ({
            stableKey: line.stableKey,
            position: line.position,
            description: line.description,
            amount: line.amount,
            icRevisionId: line.icRevisionId,
            icLineId: line.icLineId,
            recipientKey: line.recipientKey,
            documents: Array.isArray(line.evidenceManifest) ? line.evidenceManifest.filter((document): document is PaymentDocumentSnapshot => !!document && typeof document === "object" && "name" in document && typeof document.name === "string") : [],
          })),
        };
        const nextTitle = requireValue(text(form, "title"), "tên hồ sơ");
        const afterSnapshot: PaymentDossierSnapshot = {
          title: nextTitle,
          milestone: projection.milestone,
          explanation: projection.explanation,
          lines: projection.lines.map(line => ({ stableKey: line.stableKey, position: line.position, description: line.description, amount: line.amount, icRevisionId: line.source.revisionId, icLineId: line.source.lineId, recipientKey: line.recipient.key, documents: line.evidenceIds.map(id => evidenceById.get(id)).filter((document): document is NonNullable<typeof document> => !!document) })),
        };
        const diff = diffPaymentDossiers(beforeSnapshot, afterSnapshot);
        await tx.paymentLineDiscussion.deleteMany({ where: { requestId: request.id } });
        await tx.paymentRequestLine.deleteMany({ where: { requestId: request.id } });
        await tx.paymentRecipientSnapshot.deleteMany({ where: { requestId: request.id } });
        for (const [recipientKey, totalAmount] of Object.entries(projection.recipientTotals)) {
          const resolved = projection.lines.find(line => line.recipient.key === recipientKey)!.recipient;
          await tx.paymentRecipientSnapshot.create({ data: { projectId, requestId: request.id, recipientKey, recipientType: resolved.type, displayName: resolved.name, bankName: resolved.bankName, accountLast4: resolved.accountLast4, sourceVersion: resolved.sourceVersion, totalAmount } });
        }
        for (const line of projection.lines) {
          await tx.paymentRequestLine.create({ data: { projectId, requestId: request.id, stableKey: line.stableKey, position: line.position, description: line.description, amount: line.amount, icRevisionId: line.source.revisionId, icLineId: line.source.lineId, sourceSnapshot: json({ ...line.source, effective: true }), recipientKey: line.recipient.key, evidenceManifest: json(line.evidenceIds.map(id => evidenceById.get(id))) } });
        }
        await appendDigitalSigningEvent(tx, { requestId: request.id, version: request.version + 1, kind: request.kind, role: "CREATOR", actorId: actor.id, signatureData: form.get("signatureData"), signaturePin: form.get("signaturePin"), commandKey: `SUBMIT:${attemptId}:CREATOR` });
        if ((await tx.workflowRequest.updateMany({ where: { id: request.id, version: request.version, state: "DRAFT" }, data: { title: nextTitle, state: "SUBMITTED", steps: json(chain), currentStep: 0, currentAttemptId: attemptId, currentStepArrivedAt: new Date(), payload: json({ normalizedPayment: true, milestone: projection.milestone, explanation: projection.explanation, expectedSettlementDate, amount: projection.totalAmount, recipientTotals: projection.recipientTotals, warnings: projection.warnings, vendorSnapshots, resubmission: { sourceRequestId: parent.id, sourceAttemptId: parent.currentAttemptId ?? "", response }, diff }), version: { increment: 1 } } })).count !== 1) throw new Error("Bản nháp đã thay đổi. Tải lại trước khi gửi.");
        await recordApprovalEvent(tx, { requestId: request.id, module: request.module, attemptId, submittedVersion: request.version + 1, mutationVersion: request.version + 1, stepIndex: 0, role: chain[0]?.role ?? "MANAGER", actorId: actor.id, action: "SUBMIT", details: json({ sourceRequestId: parent.id, diff }), recipients: chain[0]?.assigneeId ? [chain[0].assigneeId] : [] });
        affectedRequestId = request.id;
        break;
      }
      case "CREATE_REUSE_DRAFT": {
        needCreator();
        const draft = await initializeQuotationReuseDraft(tx, projectId, { id: actor.id, role: currentActor.role }, data, form);
        savedDraftId = draft.id;
        savedScopes = ["nháp từ nguồn dùng lại"];
        break;
      }
      case "SUPPLEMENT_IC_EVIDENCE": {
        needCreator();
        if (!request || request.kind !== "IC" || request.creatorId !== actor.id || request.state === "DRAFT" || !payload?.lines?.some(l => l.id === text(form, "lineId"))) throw new Error("Chỉ người lập được bổ sung vào dòng IC đã gửi của mình.");
        const requestVersion = Number(text(form, "requestVersion"));
        if (requestVersion !== request.version) throw new Error("Phiên bản hồ sơ đã thay đổi.");
        const evidenceIds = JSON.parse(text(form, "evidenceIds") || "[]") as string[];
        if (!Array.isArray(evidenceIds) || evidenceIds.some(id => typeof id !== "string") || new Set(evidenceIds).size !== evidenceIds.length) throw new Error("Minh chứng không hợp lệ.");
        const proofs = await tx.costFlowEvidence.findMany({ where: { projectId, id: { in: evidenceIds } }, select: { id: true, sha256: true } });
        if (proofs.length !== evidenceIds.length) throw new Error("Minh chứng phải thuộc project.");
        const reason = text(form, "reason").slice(0,5000);
        if (!proofs.length && !reason) throw new Error("Cần minh chứng hoặc lý do bổ sung.");
        const operationId = requireValue(text(form, "operationId"), "mã thao tác");
        if (!/^[\w-]{1,100}$/.test(operationId)) throw new Error("Mã thao tác không hợp lệ.");
        data.evidenceSupplements = [...(data.evidenceSupplements ?? []), { operationId, requestId: request.id, requestVersion, lineId: text(form,"lineId"), evidenceIds, evidenceHashes: Object.fromEntries(proofs.map(p=>[p.id,p.sha256])), reason, actorId: actor.id, createdAt: new Date().toISOString() }];
        break;
      }
      case "FINALIZE_PAIRED_QUOTATION":
      case "SAVE_PAIRED_DRAFT": {
        needCreator();
        const result = await savePairedDraft(tx, projectId, actor.id, data, requests, form);
        savedDraftId = result.draftId; savedRevisionId = result.revisionId; savedScopes = result.savedScopes;
        affectedRequestId = result.revisionId ? data.revisions.find(revision => revision.id === result.revisionId)?.requestId : affectedRequestId;
        if (command === "FINALIZE_PAIRED_QUOTATION") {
          savedQuotationId = finalizePairedQuotation(data, result.draftId, actor.id, text(form, "priceReviewConfirmed") === "yes");
          if (result.savedScopes.includes("IC nháp")) {
            const linked = data.revisions.find(r=>r.id===result.revisionId)!;
            linked.quotationId = savedQuotationId;
            await tx.workflowRequest.update({where:{id:linked.requestId},data:{payload:json(linked)}});
          }
        }
        break;
      }
      case "CREATE_PAIRED_FROM_QUOTE_DRAFT": {
        needCreator();
        const draft = createPairedFromQuoteDraft(data, requireValue(text(form, "draftId"), "nháp Báo giá"), actor.id);
        savedDraftId = draft.id;
        savedScopes = ["nháp Báo giá & IC"];
        break;
      }
      case "CONFIGURE": {
        if (!isAdmin) throw new Error("Chỉ Admin được cấu hình phân công.");
        const requestedOperationIds = form.getAll("operationUserIds").map(String);
        const activeProjectMembers = await tx.projectMember.findMany({
          where: { projectId, user: { isActive: true } },
          select: { userId: true },
        });
        const operationUserIds = operationAssignmentIds(requestedOperationIds, activeProjectMembers.map(item => item.userId));
        if (operationUserIds.length !== new Set(requestedOperationIds.filter(Boolean)).size) throw new Error("Operations phải là tài khoản đang hoạt động và được phân công vào Project.");
        data.config = { accountantId: await activeUser(text(form, "accountantId")), ceoId: await activeUser(text(form, "ceoId")), managerId: await activeUser(text(form, "managerId")), operationUserIds };
        break;
      }
      case "ADD_BRIEF": {
        needCreator();
        const title = requireValue(text(form, "title"), "tên Brief");
        const sourceId = await snapshotFile(requireValue(text(form, "sourceFileId"), "file Brief"), "BRIEF");
        data.briefs = [...(data.briefs ?? []), { id: randomUUID(), title, sourceId: sourceId! }];
        break;
      }
      case "ADD_PO":
      case "REVISE_PO":
      case "REPLACE_PO": {
        needCreator();
        const number = requireValue(text(form, "poNumber"), "số PO");
        const current = currentPurchaseOrders(data.pos);
        const predecessor = current.find(po => po.id === text(form, "predecessorId"));
        if (command !== "ADD_PO" && !predecessor) throw new Error("Chọn bản PO hiện tại thuộc project; bản nguồn đã thay đổi cần tải lại.");
        if (command === "REVISE_PO" && predecessor?.number !== number) throw new Error("Phiên bản mới phải giữ cùng số PO.");
        if (command === "REPLACE_PO" && predecessor?.number === number) throw new Error("PO thay thế phải có số khác; cùng số dùng tạo phiên bản.");
        if (command !== "REVISE_PO" && data.pos.some(po => po.number === number)) throw new Error("Số PO đã có trong project; chọn tạo phiên bản PO.");
        if (text(form, "confirmed") !== "yes") throw new Error("Xác nhận số PO và giá trị với tài liệu gốc.");
        const net = text(form, "net"); decimal(net);
        if (compare(decimal(net), decimal("0")) < 0) throw new Error("Giá trị PO không được âm.");
        const sourceId = await snapshotFile(requireValue(text(form, "sourceFileId"), "file PO"), "PO");
        const id = randomUUID();
        data.pos.push({ id, number, net, sourceId: sourceId!, poKey: command === "REVISE_PO" ? predecessor!.poKey ?? predecessor!.id : id, version: command === "REVISE_PO" ? (predecessor!.version ?? 1) + 1 : 1, ...(command === "REVISE_PO" ? { parentPoId: predecessor!.id } : command === "REPLACE_PO" ? { replacesPoId: predecessor!.id } : {}), confirmedBy: actor.id, confirmedAt: new Date().toISOString() });
        break;
      }
      case "SAVE_QUOTATION": {
        needCreator();
        const rows = JSON.parse(text(form, "lines")) as Partial<QuotationLine>[];
        if (!Array.isArray(rows) || !rows.length || rows.length > 500 || rows.some(row => !row || typeof row !== "object")) throw new Error("Báo giá cần từ 1 đến 500 hạng mục hợp lệ.");
        const quotations = data.quotations ?? [];
        const parentId = text(form, "quotationId");
        const parent = quotations.find(q => q.id === parentId);
        if (parentId && !parent) throw new Error("Báo giá nguồn không thuộc project.");
        const title = requireValue(text(form, "title"), "tên báo giá");
        const clientId = text(form, "clientId");
        const client = clientId ? await tx.client.findUnique({ where: { id: clientId }, select: { name: true } }) : null;
        if (clientId && !client) throw new Error("Khách hàng không còn trong danh mục dự án.");
        const customer = requireValue(client?.name ?? text(form, "customer"), "khách hàng");
        const lines = rows.map(row => {
          const input = { quantity: String(row.quantity ?? ""), days: String(row.days ?? "1"), unitPrice: String(row.unitPrice ?? ""), basis: row.basis ?? "NET", vatPercent: String(row.vatPercent ?? "") };
          const parentLineId = (row.id && parent?.lines.some(l => l.id === row.id) ? row.id : row.parentQuotationLineId);
          if (parentLineId && !parent?.lines.some(l => l.id === parentLineId)) throw new Error("Dòng báo giá cha không thuộc bản nguồn đã chọn.");
          return { ...input, id: randomUUID(), description: requireValue(String(row.description ?? "").trim(), "nội dung báo giá"), unit: String(row.unit ?? ""), cost: calculateLineCost(input), ...(parentLineId ? { parentQuotationLineId: parentLineId } : {}) };
        });
        const poIds = [...new Set(form.getAll("poIds").map(String))];
        if (poIds.some(id => !data.pos.some(po => po.id === id))) throw new Error("PO không thuộc project.");
        const briefIds = [...new Set(form.getAll("briefIds").map(String))];
        if (briefIds.some(id => !data.briefs?.some(brief => brief.id === id))) throw new Error("Brief không thuộc project.");
        const sourceIds = [...new Set(form.getAll("sourceFileIds").map(String).filter(Boolean))];
        const retainedIds = [...new Set(form.getAll("evidenceIds").map(String))];
        if (retainedIds.some(id => !parent?.evidenceIds.includes(id))) throw new Error("Nguồn Brief/báo giá không hợp lệ.");
        const evidenceIds = [...retainedIds];
        for (const sourceId of sourceIds) evidenceIds.push((await snapshotFile(sourceId, "QUOTATION_SOURCE"))!);
        const quotation = { linePricingSchemaVersion: 2 as const, id: randomUUID(), number: quotations.length + 1, parentId: parent?.id ?? null, title, customer, notes: text(form, "notes"), lines, poIds, briefIds, evidenceIds, createdBy: actor.id, createdAt: new Date().toISOString() };
        data.quotations = [...quotations, quotation];
        savedQuotationId = quotation.id;
        break;
      }
      case "COPY_IC":
      case "SAVE_IC": {
        needCreator();
        if (text(form, "requestId") && !request) throw new Error("IC nháp không thuộc project.");
        const sourceRevisionId = text(form, "sourceRevisionId");
        const source = sourceRevisionId ? data.revisions.find(r => r.id === sourceRevisionId) : data.revisions.find(r => r.requestId === text(form, "parentRequestId"));
        if ((sourceRevisionId || text(form, "parentRequestId")) && !source) throw new Error("Chỉ được sao chép IC từ cùng project.");
        const copySource = source ?? (command === "COPY_IC" ? data.revisions.find(r => r.effective) : undefined);
        if (command === "COPY_IC") {
          if (!copySource) throw new Error("Chọn IC nguồn trong project.");
          form.set("parentRequestId", copySource.requestId);
          form.set("lines", JSON.stringify(copySource.lines));
          for (const id of copySource.poIds) form.append("poIds", id);
          for (const id of copySource.briefIds ?? []) form.append("briefIds", id);
        }
        const existing = data.revisions.find(r => r.requestId === request?.id);
        const working = workingIcRevision(data, requests);
        const parentRequest = requests.find(q => q.id === copySource?.requestId);
        const handoff = !!copySource && ["RETURNED", "WITHDRAWN", "CANCELLED"].includes(parentRequest?.state ?? "") && parentRequest?.creatorId === actor.id;
        if (working && working.id !== existing?.id && !(handoff && working.id === copySource?.id)) throw new Error("Project đã có revision đang xử lý; tiếp tục bản đó trước.");
        if (request && (!existing || request.state !== "DRAFT" || request.creatorId !== actor.id)) throw new Error("Chỉ sửa được IC nháp của người lập. Bản đã trình cần rút trước.");
        const rows = JSON.parse(text(form, "lines")) as Partial<IcLine>[];
        if (!Array.isArray(rows) || rows.length > 500 || rows.some(row => !row || typeof row !== "object")) throw new Error("Danh sách dòng IC không hợp lệ.");
        const knownIds = new Set([...(existing?.lines ?? []), ...(copySource?.lines ?? [])].map(l => l.id));
        const lines = rows.map(row => {
          const retained = [...(existing?.lines ?? []), ...(copySource?.lines ?? [])].find(l => l.id === row.id);
          const input = { quantity: String(row.quantity ?? ""), days: String(row.days ?? retained?.days ?? ""), unitPrice: String(row.unitPrice ?? ""), basis: row.basis ?? "NET", vatPercent: String(row.vatPercent ?? "") };
          if (row.quotationId || row.quotationLineId) {
            const source = data.quotations?.find(q => q.id === row.quotationId);
            if (!source?.lines.some(line => line.id === row.quotationLineId)) throw new Error("Hạng mục báo giá nguồn không thuộc project/phiên bản đã lưu.");
          }
          const description = String(row.description ?? "").trim();
          const issues = draftLineIssues({ ...input, description });
          return { ...input, itemId: retained?.itemId, parameterBinding: normalizeParameterBinding(row.parameterBinding ?? retained?.parameterBinding), evidenceIds: row.evidenceIds ?? retained?.evidenceIds ?? [], evidenceReason: row.evidenceReason ?? retained?.evidenceReason ?? "", internalNotes: row.internalNotes ?? retained?.internalNotes ?? "", id: row.id && knownIds.has(row.id) ? row.id : randomUUID(), description, unit: String(row.unit ?? ""), cost: issues.length ? null : calculateLineCost(input), ...(retained?.originLines ? { originLines: retained.originLines } : {}), ...(row.vendorId ? { vendorId: requireValue(String(row.vendorId), "NCC") } : {}), ...(row.quotationId ? { quotationId: row.quotationId, quotationLineId: row.quotationLineId } : {}) };
        });
        const lineEvidence = [...new Set(lines.flatMap(l => l.evidenceIds ?? []))];
        if (lineEvidence.some(id => typeof id !== "string") || (lineEvidence.length && await tx.costFlowEvidence.count({ where: { projectId, id: { in: lineEvidence } } }) !== lineEvidence.length)) throw new Error("Minh chứng dòng phải thuộc project.");
        if (new Set(lines.map(l => l.id)).size !== lines.length) throw new Error("ID dòng bị trùng.");
        if (lines.some(l => l.vendorId && !data.beneficiaries.some(b => b.id === l.vendorId))) throw new Error("NCC không thuộc project.");
        const poIds = form.getAll("poIds").map(String);
        if (poIds.some(id => !data.pos.some(po => po.id === id))) throw new Error("PO không thuộc project.");
        const briefIds = [...new Set(form.getAll("briefIds").map(String))];
        if (briefIds.some(id => !data.briefs?.some(brief => brief.id === id))) throw new Error("Brief không thuộc project.");
        const retainedIds = form.has("evidenceIds") ? [...new Set(form.getAll("evidenceIds").map(String))] : [...(existing?.evidenceIds ?? copySource?.evidenceIds ?? [])];
        if (retainedIds.some(id => !(existing?.evidenceIds ?? copySource?.evidenceIds ?? []).includes(id))) throw new Error("Nguồn tài liệu IC không thuộc phiên bản đã chọn.");
        const evidenceIds = [...new Set([...retainedIds, ...lines.flatMap(line => data.quotations?.find(q => q.id === line.quotationId)?.evidenceIds ?? [])])];
        for (const fileId of [...new Set(form.getAll("sourceFileIds").map(String).filter(Boolean))]) evidenceIds.push((await snapshotFile(fileId, "IC_SOURCE"))!);
        if (existing && request) {
          existing.linePricingSchemaVersion = 2; existing.lines = lines; existing.poIds = poIds; existing.briefIds = briefIds; existing.evidenceIds = evidenceIds;
          savedRevisionId = existing.id;
          await tx.workflowRequest.update({ where: { id: request.id }, data: { title: requireValue(text(form, "title"), "tên IC"), version: { increment: 1 }, payload: json({ revisionId: existing.id, lines, poIds, briefIds, evidenceIds }) } });
        } else {
          const id = randomUUID();
          const saved = await createRequest("IC", { revisionId: id, explanation: text(form, "explanation") }, [], "DRAFT");
          const withdrawalReason = parentRequest ? (await tx.workflowDecision.findFirst({ where: { requestId: parentRequest.id, action: "WITHDRAW" }, orderBy: { createdAt: "desc" }, select: { reason: true } }))?.reason : undefined;
          const cancellationReason = parentRequest?.state === "CANCELLED" ? String((requests.find(candidate => candidate.kind === "CANCEL" && candidate.state === "APPROVED" && (candidate.payload as RequestPayload).targetRequestId === parentRequest.id)?.payload as RequestPayload | undefined)?.explanation ?? "") : undefined;
          const lineageReason = text(form, "explanation") || withdrawalReason || cancellationReason || undefined;
          if (handoff && !lineageReason) throw new Error("Thiếu lý do rút/hủy/trả để liên kết revision mới.");
          const revision = { linePricingSchemaVersion: 2 as const, id, number: data.revisions.length + 1, requestId: saved.id, effective: false, lines, poIds, briefIds, evidenceIds, createdBy: actor.id, ...(copySource ? { parentRevisionId: copySource.id, lineageReason, parameterConfig: copySource.parameterConfig ? structuredClone(copySource.parameterConfig) : undefined } : {}) };
          if (handoff && copySource) {
            if (!copySource.submissions?.length && parentRequest) copySource.submissions = [{ linePricingSchemaVersion: 2, requestId: parentRequest.id, requestVersion: parentRequest.version, submittedAt: null, title: parentRequest.title, parameterConfig: copySource.parameterConfig ? structuredClone(copySource.parameterConfig) : undefined, lines: structuredClone(copySource.lines), poIds: [...copySource.poIds], briefIds: [...(copySource.briefIds ?? [])], evidenceIds: [...(copySource.evidenceIds ?? [])] }];
            copySource.supersededByRevisionId = id;
          }
          data.revisions.push(revision);
          savedRevisionId = revision.id;
          await tx.workflowRequest.update({ where: { id: saved.id }, data: { payload: json({ ...revision }) } });
        }
        data.workingRevisionId = savedRevisionId;
        const pairedId = text(form,"pairedDraftId");
        if (pairedId) {
          const paired = data.quotationDrafts?.find(d=>d.id===pairedId && d.createdBy===actor.id && d.icRevisionId===copySource?.id);
          if (!paired || command!=="COPY_IC") throw new Error("Nháp và IC nguồn không khớp.");
          paired.icRevisionId = savedRevisionId;
          const successor = data.revisions.find(r=>r.id===savedRevisionId)!;
          successor.tree = structuredClone(copySource?.tree ?? []);
        }
        break;
      }
      case "SUBMIT": {
        if (!request || request.state !== "DRAFT" || request.creatorId !== actor.id || request.kind !== "IC") throw new Error("Chỉ người lập được gửi IC nháp.");
        const revision = data.revisions.find(r => r.requestId === request.id);
        if (!revision?.lines.length) throw new Error("IC cần ít nhất một dòng hợp lệ.");
        const explanation = requireValue(text(form, "explanation"), "lý do hoặc tóm tắt thay đổi");
        const baseline = effectiveBaseline(data.revisions);
        const parameterRows = revision.lines.map(line => {
          const row = blankPairedRow(line.itemId ?? line.id);
          row.name = line.description;
          row.buy = { ...row.buy, quantity: line.quantity, days: line.days, unitPrice: line.unitPrice, vatPercent: line.vatPercent, basis: line.basis, unit: line.unit, notes: line.internalNotes ?? "", parameterBinding: line.parameterBinding ? structuredClone(line.parameterBinding) : undefined, vendorId: line.vendorId ?? "", evidenceIds: [...(line.evidenceIds ?? [])], evidenceReason: line.evidenceReason ?? "" };
          return row;
        });
        const parameterIssues = parameterFinalizationIssues(parameterRows, revision.parameterConfig, "buy");
        if (parameterIssues.length) {
          const issue = parameterIssues[0];
          throw new Error(`${issue.rowName || issue.rowId || "Hạng mục IC"}: ${issue.message}`);
        }
        revision.lines = completeIcLines(revision.lines);
        validateIcEvidence(revision.lines);
        const ids = [...new Set([...(revision.evidenceIds ?? []), ...revision.lines.flatMap(l => l.evidenceIds ?? [])])];
        const proofs = await tx.costFlowEvidence.findMany({ where: { projectId, id: { in: ids } }, select: { id: true, sha256: true } });
        if (proofs.length !== ids.length) throw new Error("Minh chứng đã thay đổi hoặc không thuộc project.");
        revision.evidenceHashes = Object.fromEntries(proofs.map(p => [p.id, p.sha256]));
        revision.linePricingSchemaVersion = 2;
        revision.submissions = [...(revision.submissions ?? []), { linePricingSchemaVersion: 2, requestId: request.id, requestVersion: request.version + 1, submittedAt: new Date().toISOString(), title: request.title, explanation, baselineRevisionId: baseline?.id ?? null, parameterConfig: revision.parameterConfig ? structuredClone(revision.parameterConfig) : undefined, tree: structuredClone(revision.tree ?? []), evidenceHashes: { ...revision.evidenceHashes }, lines: structuredClone(revision.lines), poIds: [...revision.poIds], briefIds: [...(revision.briefIds ?? [])], evidenceIds: [...(revision.evidenceIds ?? [])] }];
        const chain = await ordinarySteps();
        const attemptId = randomUUID();
        const submittedVersion = request.version + 1;
        if ((await tx.workflowRequest.updateMany({ where: { id: request.id, version: request.version }, data: { state: "SUBMITTED", steps: json(chain), currentStep: 0, currentAttemptId: attemptId, currentStepArrivedAt: new Date(), version: { increment: 1 }, payload: json(revision) } })).count !== 1) throw new Error("Dữ liệu đã thay đổi. Tải lại trang trước khi thao tác.");
        await recordApprovalEvent(tx, { requestId: request.id, module: request.module, attemptId, submittedVersion, mutationVersion: submittedVersion, stepIndex: 0, role: chain[0].role, actorId: actor.id, action: "SUBMIT", reason: explanation, details: json({ explanation, baselineRevisionId: baseline?.id ?? null }), recipients: [chain[0].assigneeId] });
        break;
      }
      case "IC_NOTES": {
        needCreator();
        const revision = data.revisions.find(r => r.requestId === request?.id);
        if (!request || !revision || request.creatorId !== actor.id) throw new Error("Chỉ người lập được cập nhật ghi chú nội bộ IC.");
        revision.internalNotes = text(form, "internalNotes");
        await tx.workflowRequest.update({ where: { id: request.id }, data: { version: { increment: 1 } } });
        break;
      }
      case "SAVE_VENDOR_PAYMENT_SCHEDULE": {
        needCreator();
        const rawMilestones = text(form, "milestones");
        if (!rawMilestones) throw new Error("Dữ liệu lịch thanh toán không được rỗng.");
        const parsed = JSON.parse(rawMilestones) as import("./types").VendorPaymentMilestone[];
        if (!Array.isArray(parsed)) throw new Error("Danh sách đợt thanh toán không hợp lệ.");
        const vendorId = text(form, "vendorId");
        if (vendorId) {
          data.vendorPaymentMilestones = [
            ...(data.vendorPaymentMilestones ?? []).filter(m => m.vendorId !== vendorId),
            ...parsed.map((m, idx) => ({
              id: m.id || randomUUID(),
              vendorId,
              installmentNumber: m.installmentNumber || idx + 1,
              title: String(m.title || `Đợt ${idx + 1}`).trim(),
              percentage: Number(m.percentage) || 0,
              amount: String(m.amount || "0"),
              dueDate: String(m.dueDate || ""),
              paymentMethod: (m.paymentMethod === "VENDOR_DIRECT" ? "VENDOR_DIRECT" : "ADVANCE") as "ADVANCE" | "VENDOR_DIRECT",
              conditions: m.conditions ? String(m.conditions).trim() : undefined,
              notes: m.notes ? String(m.notes).trim() : undefined,
              linkedRequestId: m.linkedRequestId,
              revisionId: m.revisionId,
            }))
          ];
        } else {
          data.vendorPaymentMilestones = parsed.map((m, idx) => ({
            id: m.id || randomUUID(),
            vendorId: m.vendorId,
            installmentNumber: m.installmentNumber || idx + 1,
            title: String(m.title || `Đợt ${idx + 1}`).trim(),
            percentage: Number(m.percentage) || 0,
            amount: String(m.amount || "0"),
            dueDate: String(m.dueDate || ""),
            paymentMethod: (m.paymentMethod === "VENDOR_DIRECT" ? "VENDOR_DIRECT" : "ADVANCE") as "ADVANCE" | "VENDOR_DIRECT",
            conditions: m.conditions ? String(m.conditions).trim() : undefined,
            notes: m.notes ? String(m.notes).trim() : undefined,
            linkedRequestId: m.linkedRequestId,
            revisionId: m.revisionId,
          }));
        }
        break;
      }
      case "SPLIT_IC_LINE":
      case "MERGE_IC_LINES": {
        needCreator();
        const revision = data.revisions.find(r => r.requestId === request?.id);
        if (!request || request.creatorId !== actor.id || request.state !== "DRAFT" || !revision || workingIcRevision(data, requests)?.id !== revision.id) throw new Error("Chỉ tách/gộp dòng của IC nháp đang xử lý.");
        const ids = form.getAll("lineIds").map(String);
        if (new Set(ids).size !== ids.length || (command === "SPLIT_IC_LINE" ? ids.length !== 1 : ids.length < 2)) throw new Error("Chọn đúng các dòng tách/gộp.");
        const sourceLines = ids.map(id => revision.lines.find(line => line.id === id));
        if (sourceLines.some(line => !line)) throw new Error("Dòng nguồn không thuộc IC nháp.");
        const rows = JSON.parse(text(form, "lines")) as Partial<IcLine>[];
        if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== "object") || (command === "SPLIT_IC_LINE" ? rows.length < 2 || rows.length > 500 : rows.length !== 1)) throw new Error("Nhập các dòng kết quả tách/gộp.");
        data.lineArchive ??= [];
        for (const line of sourceLines) if (line && !data.lineArchive.some(entry => entry.revisionId === revision.id && entry.line.id === line.id)) data.lineArchive.push({ revisionId: revision.id, line: structuredClone(line) });
        const outputs = rows.map(row => {
          const input = { quantity: String(row.quantity ?? ""), days: String(row.days ?? ""), unitPrice: String(row.unitPrice ?? ""), basis: row.basis ?? "NET", vatPercent: String(row.vatPercent ?? "") };
          const description = requireValue(String(row.description ?? "").trim(), "nội dung dòng kết quả");
          const line: IcLine = { ...input, description, unit: String(row.unit ?? ""), id: randomUUID(), cost: draftLineIssues({ ...input, description }).length ? null : calculateLineCost(input), originLines: ids.map(lineId => ({ revisionId: revision.id, lineId })) };
          validateIcLineOrigins(data, line, revision.id); return line;
        });
        revision.lines = [...revision.lines.filter(line => !ids.includes(line.id)), ...outputs];
        if (revision.lines.length > 500) throw new Error("IC tối đa 500 dòng.");
        await tx.workflowRequest.update({ where: { id: request.id }, data: { payload: json(revision), version: { increment: 1 } } });
        savedRevisionId = revision.id;
        break;
      }
      case "APPLY_QUOTATION_LINES": {
        needCreator();
        const revision = data.revisions.find(r => r.requestId === request?.id);
        if (!request || !revision || request.creatorId !== actor.id || request.state !== "DRAFT" || workingIcRevision(data, requests)?.id !== revision.id) throw new Error("Cập nhật báo giá chỉ vào IC nháp đang xử lý; bản đã gửi phải rút trước.");
        const quotation = data.quotations?.find(q => q.id === text(form, "quotationId"));
        if (!quotation) throw new Error("Báo giá không thuộc project.");
        const selected = form.getAll("quotationLineIds").map(String);
        if (!selected.length || new Set(selected).size !== selected.length) throw new Error("Chọn hạng mục báo giá cần cập nhật.");
        const updateQuantity = form.getAll("updateQuantityIds").map(String);
        const updateUnit = form.getAll("updateUnitIds").map(String);
        if ([...updateQuantity, ...updateUnit].some(id => !selected.includes(id))) throw new Error("Trường cập nhật không thuộc dòng đã chọn.");
        for (const id of selected) {
          const row = quotation.lines.find(l => l.id === id);
          if (!row) throw new Error("Hạng mục không thuộc phiên bản báo giá đã chọn.");
          const ancestors = quotationLineAncestors(data.quotations ?? [], quotation.id, row.id);
          const matches = revision.lines.filter(l => ancestors.some(ref => ref.quotationId === l.quotationId && ref.lineId === l.quotationLineId));
          if (matches.length > 1) throw new Error("Nhiều dòng IC dùng nguồn này; cần chọn ánh xạ rõ trước khi cập nhật.");
          const existing = matches[0];
          if (existing) {
            existing.description = row.description;
            if (updateQuantity.includes(id)) existing.quantity = row.quantity;
            if (updateUnit.includes(id)) existing.unit = row.unit;
            existing.quotationId = quotation.id; existing.quotationLineId = row.id;
            existing.cost = draftLineIssues(existing).length ? null : calculateLineCost(existing);
          } else revision.lines.push({ id: randomUUID(), description: row.description, quantity: row.quantity, days: "", unit: row.unit, basis: "NET", unitPrice: "", vatPercent: "", cost: null, quotationId: quotation.id, quotationLineId: row.id });
        }
        if (revision.lines.length > 500) throw new Error("IC tối đa 500 dòng.");
        await tx.workflowRequest.update({ where: { id: request.id }, data: { payload: json(revision), version: { increment: 1 } } });
        savedRevisionId = revision.id;
        break;
      }
      case "BENEFICIARY": {
        needCreator();
        const existing = data.beneficiaries.find(b => b.id === text(form, "beneficiaryId"));
        const proofId = upload
          ? (await tx.costFlowEvidence.create({ data: { projectId, sourceFileId: "uploaded-beneficiary-proof", kind: "BENEFICIARY", name: upload.name, mimeType: upload.mimeType, data: upload.data, sha256: createHash("sha256").update(upload.data).digest("hex"), createdBy: actor.id } })).id
          : await snapshotFile(text(form, "sourceFileId"), "BENEFICIARY");
        if (!proofId) throw new Error("Cần tài liệu căn cứ tên người nhận và số tài khoản.");
        const updated = { id: existing?.id ?? randomUUID(), name: requireValue(text(form, "name"), "tên người nhận"), bank: requireValue(text(form, "bank"), "ngân hàng"), account: requireValue(text(form, "account"), "số tài khoản"), version: (existing?.version ?? 0) + 1, verifiedVersion: null, proofId: proofId! };
        if (existing) Object.assign(existing, updated); else data.beneficiaries.push(updated);
        savedBeneficiaryId = updated.id;
        break;
      }
      case "EXPENSE": {
        if (!member && !isAdmin) throw new Error("Chỉ thành viên project hoặc Admin mới được ghi chi phí.");
        const revision = requireEffectiveIc(text(form, "revisionId"));
        const lineId = text(form, "lineId");
        if (!revision.lines.some(line => line.id === lineId)) throw new Error("Chi phí phải truy được dòng IC.");
        const input = { quantity: text(form, "quantity"), unitPrice: text(form, "unitPrice"), basis: text(form, "basis") as "NET" | "GROSS", vatPercent: text(form, "vatPercent") };
        const invoiceId = await snapshotFile(text(form, "invoiceFileId"), "INVOICE");
        const paymentProofId = await snapshotFile(text(form, "paymentFileId"), "EXPENSE_PAYMENT");
        const fundingSource = (text(form, "fundingSource") as "ADVANCE" | "OUT_OF_POCKET" | "VENDOR_DIRECT") || undefined;
        const exceptionReason = text(form, "exceptionReason") || undefined;
        const exceptionStatus = exceptionReason ? "PENDING" : undefined;
        const spentAt = text(form, "spentAt") || new Date().toISOString();
        data.expenses.push({
          id: randomUUID(),
          revisionId: revision.id,
          lineId,
          recipientKey: await recipient(text(form, "recipientKey")),
          description: requireValue(text(form, "description"), "nội dung chi phí"),
          input,
          cost: calculateCost(input),
          invoiceId,
          paymentProofId,
          createdBy: actor.id,
          fundingSource,
          exceptionReason,
          exceptionStatus,
          spentAt,
        });
        break;
      }
      case "EXPENSE_EVIDENCE": {
        if (!member && !isAdmin) throw new Error("Chỉ thành viên project hoặc Admin mới được bổ sung chứng từ.");
        const expense = data.expenses.find(e => e.id === text(form, "expenseId"));
        if (!expense) throw new Error("Không tìm thấy chi phí.");
        const invoiceId = await snapshotFile(text(form, "invoiceFileId"), "INVOICE");
        const paymentProofId = await snapshotFile(text(form, "paymentFileId"), "EXPENSE_PAYMENT");
        const exceptionStatus = text(form, "exceptionStatus") as "PENDING" | "APPROVED" | "REJECTED" | undefined;
        const exceptionReason = text(form, "exceptionReason") || undefined;
        if (!invoiceId && !paymentProofId && !exceptionStatus && !exceptionReason) throw new Error("Chọn chứng từ cần bổ sung hoặc cập nhật ngoại lệ.");
        expense.invoiceId = invoiceId ?? expense.invoiceId;
        expense.paymentProofId = paymentProofId ?? expense.paymentProofId;
        if (exceptionReason) expense.exceptionReason = exceptionReason;
        if (exceptionStatus) {
          const isAccountant = actor.id === data.config.accountantId;
          const isProjectOwner = actor.id === project.ownerId;
          const isManager = actor.id === data.config.managerId;
          const isAdmin = currentActor.role === "ADMIN";
          if (["APPROVED", "REJECTED"].includes(exceptionStatus) && !isAccountant && !isProjectOwner && !isManager && !isAdmin) {
            throw new Error("Chỉ Kế toán phụ trách, Quản lý dự án hoặc Admin mới có quyền duyệt ngoại lệ chứng từ.");
          }
          expense.exceptionStatus = exceptionStatus;
        }
        break;
      }
      case "REVISE_EXPENSE": {
        needCreator();
        const expense = data.expenses.find(e => e.id === text(form, "expenseId"));
        if (!expense) throw new Error("Không tìm thấy chi phí nguồn.");
        const revision = requireEffectiveIc(text(form, "revisionId"));
        const lineId = text(form, "lineId");
        if (!revision.lines.some(l => l.id === lineId)) throw new Error("Chọn dòng IC nguồn hợp lệ.");
        const input = { quantity: text(form, "quantity"), unitPrice: text(form, "unitPrice"), basis: text(form, "basis") as "NET" | "GROSS", vatPercent: text(form, "vatPercent") };
        const invoiceId = await snapshotFile(requireValue(text(form, "invoiceFileId"), "chứng từ chi phí bản sửa"), "INVOICE");
        const paymentProofId = await snapshotFile(requireValue(text(form, "paymentFileId"), "bằng chứng đã chi bản sửa"), "EXPENSE_PAYMENT");
        const proposed = { ...expense, description: requireValue(text(form, "description"), "nội dung sửa"), input, cost: calculateCost(input), revisionId: revision.id, lineId, invoiceId, paymentProofId, version: (expense.version ?? 1) + 1 };
        const saved = await createRequest("AC_REVISION", { expenseRevision: { previousVersion: expense.version ?? 1, proposed }, explanation: requireValue(text(form, "explanation"), "lý do sửa chi phí") }, await ordinarySteps());
        await tx.costFlowEvidence.updateMany({ where: { id: { in: [invoiceId!, paymentProofId!] } }, data: { requestId: saved.id } });
        break;
      }
      case "PAYMENT":
      case "ADVANCE_SETTLEMENT": {
        await resolveApprovedActuals();
        break;
      }
      case "CREATE_REQUEST": {
        const kind = text(form, "kind");
        if (["CLOSE", "REOPEN"].includes(kind)) { if (!member && !isAdmin) throw new Error("Cần là nhân sự của project để yêu cầu đóng/mở tài chính."); }
        else needCreator();
        if (["CLOSE", "REOPEN", "CANCEL"].includes(kind)) {
          requireValue(text(form, "explanation"), "lý do");
          if (kind === "CLOSE") assertClose();
          if (kind === "REOPEN" && !data.closed) throw new Error("Tài chính chưa đóng.");
          const target = kind === "CANCEL" ? requests.find(r => r.id === text(form, "targetRequestId")) : null;
          const targetRevision = target ? data.revisions.find(revision => revision.requestId === target.id) : undefined;
          const cancellableIc = !!targetRevision?.effective && ["SUBMITTED", "APPROVED", "RETURNED", "REJECTED"].includes(target?.state ?? "");
          if (kind === "CANCEL" && (!target || (!cancellableIc && target.state !== "APPROVED") || cash.some(c => c.requestId === target.id))) throw new Error("Chỉ yêu cầu hủy hồ sơ đã duyệt hoặc IC đang hiệu lực, chưa chi.");
          const managerId = await activeUser(target ? (target.steps as ApprovalStep[])[0]?.assigneeId : data.config.managerId);
          await createRequest(kind, { explanation: text(form, "explanation"), targetRequestId: target?.id }, [{ role: "MANAGER", assigneeId: managerId }]);
          break;
        }
        if (!["ADVANCE", "VENDOR_PAYMENT", "REIMBURSEMENT"].includes(kind)) throw new Error("Loại hồ sơ không hợp lệ.");
        const approvedActuals = ["VENDOR_PAYMENT", "REIMBURSEMENT"].includes(kind) ? await resolveApprovedActuals() : [];
        const key = await recipient(text(form, "recipientKey"));
        if (kind === "ADVANCE" && !key.startsWith("USER:")) throw new Error("Tạm ứng dành cho nhân viên.");
        if (kind === "VENDOR_PAYMENT" && !key.startsWith("VENDOR:")) throw new Error("Chi NCC cần người thụ hưởng NCC.");
        if (kind === "REIMBURSEMENT" && !key.startsWith("USER:")) throw new Error("Phiếu Hoàn Tạm Ứng dành cho nhân viên; NCC đối soát theo hồ sơ thanh toán.");
        const revision = requireEffectiveIc(text(form, "revisionId"));
        const beneficiary = data.beneficiaries.find(b => `VENDOR:${b.id}` === key);
        const body: RequestPayload = { revisionId: revision.id, recipientKey: key, beneficiaryVersion: beneficiary?.version, explanation: text(form, "explanation"), lines: revision.lines, beneficiary: beneficiary ? { name: beneficiary.name, bank: beneficiary.bank, account: beneficiary.account } : undefined };
        let selectedAdvances: AdvanceSourceSelection[] = [];
        if (kind === "REIMBURSEMENT") {
          if (approvedActuals.some(line => line.recipientKey !== key)) throw new Error("AC đã duyệt phải cùng người nhận của hồ sơ hoàn tạm ứng.");
          const settlementRoute = approvedActualSettlementRoute(approvedActuals);
          if (settlementRoute === "VENDOR_PAYMENT") throw new Error("AC chi trực tiếp NCC phải đi qua hồ sơ thanh toán NCC.");
          if (approvedActuals.some(line => line.fundingSource.startsWith("EMPLOYEE_") && !key.startsWith("USER:"))) throw new Error("Nguồn AC nhân sự phải gắn người nhận nhân sự.");
          if (approvedActuals.some(line => line.fundingSource === "VENDOR_ADVANCE" && !key.startsWith("VENDOR:"))) throw new Error("Nguồn AC tạm ứng NCC phải gắn đúng NCC.");
          selectedAdvances = await resolveSelectedAdvances(key);
          const needsAdvance = settlementRoute === "ADVANCE_SETTLEMENT";
          if (needsAdvance && !selectedAdvances.length) throw new Error("Account phải chọn rõ nguồn tạm ứng; hệ thống không áp dụng FIFO.");
          if (!needsAdvance && selectedAdvances.length) throw new Error("AC tự chi không được gắn nguồn tạm ứng.");
          const settlement = selectedAdvances.length
            ? calculateSelectedAdvanceSettlement({ projectId, recipientKey: key, approvedActualLines: approvedActuals, selectedAdvances })
            : { selectedAdvanceLineIds: [], actualUsed: approvedActuals.reduce((total, line) => total + BigInt(line.approvedAmount), BigInt(0)).toString(), advanceApplied: "0", unusedOrRefundDue: "0", overspendOrAdditionalDue: approvedActuals.reduce((total, line) => total + BigInt(line.approvedAmount), BigInt(0)).toString() };
          body.advance = settlement.advanceApplied;
          body.advanceLineIds = settlement.selectedAdvanceLineIds;
          body.actual = settlement.actualUsed;
          body.refund = settlement.unusedOrRefundDue;
          body.additional = settlement.overspendOrAdditionalDue;
          body.amount = body.additional !== "0" ? body.additional : body.refund;
          body.expenseIds = approvedActuals.map(line => line.stableLineId);
        } else if (kind === "VENDOR_PAYMENT") {
          if (approvedActuals.some(line => line.recipientKey !== key)) throw new Error("AC đã duyệt phải cùng NCC của hồ sơ thanh toán.");
          if (approvedActualSettlementRoute(approvedActuals) !== "VENDOR_PAYMENT") throw new Error("Hồ sơ thanh toán NCC chỉ nhận AC nguồn VENDOR_PAYMENT.");
          body.amount = approvedActuals.reduce((total, line) => total + BigInt(line.approvedAmount), BigInt(0)).toString();
          body.expenseIds = approvedActuals.map(line => line.stableLineId);
        } else body.amount = positive(text(form, "amount"));
        if (kind === "ADVANCE" && requests.some(r => r.kind === "ADVANCE" && (r.payload as RequestPayload).recipientKey === key && !["WITHDRAWN", "REJECTED", "CANCELLED"].includes(r.state))) requireValue(body.explanation ?? "", "giải trình tạm ứng bổ sung");
        const saved = await createRequest(kind, body, await ordinarySteps());
        if (approvedActuals.length) {
          await applyActualCosts(saved.id, approvedActuals);
          await applySelectedAdvances(saved.id, approvedActuals, selectedAdvances);
          const recipientType = key.startsWith("VENDOR:") ? "VENDOR" : "EMPLOYEE";
          const displayName = recipientType === "VENDOR" ? data.beneficiaries.find(item => `VENDOR:${item.id}` === key)?.name ?? "NCC" : (await tx.user.findUnique({ where: { id: key.slice(5) }, select: { name: true } }))?.name ?? "Nhân sự";
          await tx.paymentRecipientSnapshot.create({ data: { projectId, requestId: saved.id, recipientKey: key, recipientType, displayName, totalAmount: body.amount! } });
          const source = await tx.actualCostLine.findUniqueOrThrow({ where: { id: approvedActuals[0].lineId! }, select: { icRevisionId: true, icLineId: true } });
          await tx.paymentRequestLine.create({ data: { projectId, requestId: saved.id, stableKey: `settlement:${saved.id}`, position: 0, description: kind === "REIMBURSEMENT" ? "Đối soát AC đã duyệt" : "Thanh toán AC đã duyệt", amount: body.amount!, icRevisionId: source.icRevisionId ?? revision.id, icLineId: source.icLineId ?? revision.lines[0]?.id ?? "UNBUDGETED", sourceSnapshot: json({ approvedActualRefs: approvedActuals.map(line => ({ stableLineId: line.stableLineId, versionId: line.versionId, approvalEventId: line.approvalEventId, approvalAttemptId: line.approvalAttemptId })) }), recipientKey: key, evidenceManifest: json([]) } });
        }
        if (beneficiary) {
          const original = await tx.costFlowEvidence.findUnique({ where: { id: beneficiary.proofId } });
          if (!original) throw new Error("Thiếu căn cứ người thụ hưởng.");
          await tx.costFlowEvidence.create({ data: { projectId, requestId: saved.id, sourceFileId: original.sourceFileId, kind: original.kind, name: original.name, mimeType: original.mimeType, data: original.data, sha256: original.sha256, createdBy: actor.id } });
        }
        for (const id of body.evidenceIds ?? []) {
          const original = await tx.costFlowEvidence.findFirst({ where: { id, projectId } });
          if (!original) throw new Error("Thiếu chứng từ đã lưu.");
          await tx.costFlowEvidence.create({ data: { projectId, requestId: saved.id, sourceFileId: original.sourceFileId, kind: original.kind, name: original.name, mimeType: original.mimeType, data: original.data, sha256: original.sha256, createdBy: actor.id } });
        }
        break;
      }
      case "DECIDE": {
        if (!request || !steps) throw new Error("Không tìm thấy hồ sơ.");
        const submittedVersion = await approvalSubmittedVersion();
        assertApprovalToken(request, form, submittedVersion);
        const role = steps[request.currentStep]?.role;
        const action = text(form, "decision") as Decision;
        const policy = icDecisionPolicy(request.kind, role, action);
        const corrections = correctionItems(form, action, { optional: policy.correctionsOptional });
        const next = decide({ ...request, steps }, actor.id, action, text(form, "reason"), { reasonOptional: policy.reasonOptional });
        const normalizedPayload = request.payload && typeof request.payload === "object" ? request.payload as Record<string, unknown> : {};
        let vendorChecks: Array<{ recipientSnapshotId: string; recipientKey: string; sourceVersion: number; proofId: string; proofSha256: string }> = [];
        if (action === "APPROVE" && role === "ACCOUNTANT" && text(form, "reviewConfirmed") !== "yes") throw new Error("Kế toán cần xác nhận đã kiểm tra thông tin, chứng từ và phiên bản trước khi chuyển CEO.");
        if (action === "APPROVE" && role === "ACCOUNTANT" && normalizedPayload.normalizedPayment === true) {
          const submittedVendors = Array.isArray(normalizedPayload.vendorSnapshots) ? normalizedPayload.vendorSnapshots : [];
          const recipientSnapshots = await tx.paymentRecipientSnapshot.findMany({ where: { requestId: request.id, recipientType: "VENDOR" } });
          if (submittedVendors.length !== recipientSnapshots.length) throw new Error("Snapshot NCC của hồ sơ không đầy đủ. Trả toàn bộ hồ sơ để lập lại.");
          const proofIds = submittedVendors.map(snapshot => snapshot && typeof snapshot === "object" && "proofId" in snapshot ? String(snapshot.proofId) : "").filter(Boolean);
          const proofs = await tx.costFlowEvidence.findMany({ where: { projectId, id: { in: proofIds } }, select: { id: true, sha256: true } });
          const proofById = new Map(proofs.map(proof => [proof.id, proof]));
          vendorChecks = recipientSnapshots.map(recipientSnapshot => {
            const submitted = submittedVendors.find(snapshot => snapshot && typeof snapshot === "object" && "recipientKey" in snapshot && String(snapshot.recipientKey) === recipientSnapshot.recipientKey);
            const beneficiary = data.beneficiaries.find(item => `VENDOR:${item.id}` === recipientSnapshot.recipientKey);
            const sourceVersion = submitted && typeof submitted === "object" && "sourceVersion" in submitted ? Number(submitted.sourceVersion) : Number.NaN;
            const proofId = submitted && typeof submitted === "object" && "proofId" in submitted ? String(submitted.proofId) : "";
            const proofSha256 = submitted && typeof submitted === "object" && "proofSha256" in submitted ? String(submitted.proofSha256) : "";
            const currentProof = proofById.get(proofId);
            if (!beneficiary || recipientSnapshot.sourceVersion !== sourceVersion || beneficiary.version !== sourceVersion || beneficiary.proofId !== proofId || !currentProof || currentProof.sha256 !== proofSha256) throw new Error("Có NCC đã đổi thông tin hoặc căn cứ xác minh. Không ghi quyết định; trả toàn bộ hồ sơ để sửa và gửi lại.");
            beneficiary.verifiedVersion = beneficiary.version;
            return { recipientSnapshotId: recipientSnapshot.id, recipientKey: recipientSnapshot.recipientKey, sourceVersion, proofId, proofSha256 };
          });
        } else if (action === "APPROVE" && role === "ACCOUNTANT" && payload?.recipientKey?.startsWith("VENDOR:")) {
          const beneficiary = data.beneficiaries.find(b => `VENDOR:${b.id}` === payload.recipientKey);
          if (!beneficiary || beneficiary.version !== payload.beneficiaryVersion) throw new Error("Thông tin người nhận đã đổi. Trả hồ sơ để lập lại và xác minh bản mới.");
          beneficiary.verifiedVersion = beneficiary.version;
        }
        if (action === "APPROVE" && request.kind === "CLOSE") { assertClose(); data.closed = true; }
        if (action === "APPROVE" && request.kind === "REOPEN") data.closed = false;
        if (action === "APPROVE" && request.kind === "AC_REVISION" && next.state === "APPROVED") {
          const change = payload?.expenseRevision;
          const previous = data.expenses.find(e => e.id === change?.proposed.id);
          if (!change || !previous || (previous.version ?? 1) !== change.previousVersion) throw new Error("Chi phí nguồn đã thay đổi. Trả hồ sơ và lập lại bản sửa.");
          Object.assign(previous, change.proposed);
        }
        if (action === "APPROVE" && request.kind === "CANCEL") {
          const target = requests.find(r => r.id === payload?.targetRequestId);
          const revision = target ? data.revisions.find(r => r.requestId === target.id) : undefined;
          const cancellableIc = !!revision?.effective && ["SUBMITTED", "APPROVED", "RETURNED", "REJECTED"].includes(target?.state ?? "");
          if (!target || (!cancellableIc && target.state !== "APPROVED") || cash.some(c => c.requestId === target.id)) throw new Error("Hồ sơ đã thay đổi hoặc đã có giao dịch tiền, không được hủy theo nhánh chưa chi.");
          if (revision && cash.some(c => (requests.find(r => r.id === c.requestId)?.payload as RequestPayload)?.revisionId === revision.id)) throw new Error("Đã chi theo IC này, không được hủy theo nhánh chưa chi.");
          if (revision) revision.effective = false;
          await tx.workflowRequest.update({ where: { id: target.id }, data: { state: "CANCELLED", version: { increment: 1 } } });
          await tx.actualCostApplication.updateMany({ where: { requestId: target.id, state: "ACTIVE" }, data: { state: "RELEASED", releasedAt: new Date() } });
          await tx.advanceApplication.deleteMany({ where: { expenseId: `AC_SET:${target.id}` } });
          const targetActuals = await tx.actualCostApplication.findMany({ where: { requestId: target.id }, select: { line: { select: { stableLineId: true } } } });
          await tx.advanceApplication.deleteMany({ where: { expenseId: { in: targetActuals.map(item => item.line.stableLineId) }, projectId } });
        }
        if (request.kind === "IC") {
          const revision = data.revisions.find(r => r.requestId === request.id);
          if (!revision) throw new Error("Thiếu revision IC.");
          if (action === "APPROVE" && role === "MANAGER") {
            data.revisions.forEach(r => { r.effective = r.id === revision.id; });
          }
          if (action === "WITHDRAW") revision.effective = false;
          // CEO RETURN/REJECT changes approval only; never revoke budget or cash.
        }
        const nextAssignee = action === "APPROVE" && next.state === "SUBMITTED" ? steps[next.currentStep]?.assigneeId : undefined;
        const ceoRecipients = request.kind === "IC" && role === "CEO" && ["RETURN", "REJECT"].includes(action)
          ? [request.creatorId, steps.find(step => step.role === "MANAGER")?.assigneeId, steps.find(step => step.role === "ACCOUNTANT")?.assigneeId].filter((id): id is string => !!id)
          : [];
        if (action === "APPROVE" && requiresDigitalSignature(request.kind)) {
          const signingRole = role as DigitalSigningRole | undefined;
          if (submittedVersion == null || !signingRole || !["MANAGER", "ACCOUNTANT", "CEO"].includes(signingRole)) throw new Error("Không xác định được vai trò hoặc phiên bản ký số hiện tại.");
          await appendDigitalSigningEvent(tx, {
            requestId: request.id,
            version: submittedVersion,
            kind: request.kind,
            role: signingRole,
            actorId: actor.id,
            signatureData: form.get("signatureData"),
            signaturePin: form.get("signaturePin"),
            commandKey: `DECIDE:${request.currentAttemptId}:${submittedVersion}:${signingRole}:APPROVE`,
          });
        }
        if ((await tx.workflowRequest.updateMany({ where: { id: request.id, version: request.version }, data: { ...next, currentStepArrivedAt: next.state === "SUBMITTED" && action === "APPROVE" ? new Date() : next.state === "SUBMITTED" ? request.currentStepArrivedAt : null, version: { increment: 1 } } })).count !== 1) throw new Error("Dữ liệu đã thay đổi. Tải lại trang trước khi thao tác.");
        if (action === "WITHDRAW" && next.state === "WITHDRAWN") {
          const requestActuals = await tx.actualCostApplication.findMany({ where: { requestId: request.id }, select: { line: { select: { stableLineId: true } } } });
          await tx.actualCostApplication.updateMany({ where: { requestId: request.id, state: "ACTIVE" }, data: { state: "RELEASED", releasedAt: new Date() } });
          await tx.advanceApplication.deleteMany({ where: { projectId, OR: [{ expenseId: `AC_SET:${request.id}` }, { expenseId: { in: requestActuals.map(item => item.line.stableLineId) } }] } });
        }
        await tx.workflowDecision.create({ data: { requestId: request.id, version: request.version + 1, step: request.currentStep, actorId: actor.id, action, reason: text(form, "reason") } });
        const decisionDetails = corrections.length || vendorChecks.length ? json({ ...(corrections.length ? { correctionItems: corrections } : {}), ...(vendorChecks.length ? { vendorChecks } : {}) }) : undefined;
        await recordApprovalEvent(tx, { requestId: request.id, module: request.module, attemptId: request.currentAttemptId, submittedVersion, mutationVersion: request.version + 1, stepIndex: request.currentStep, role: role ?? "CREATOR", actorId: actor.id, action, reason: text(form, "reason"), details: decisionDetails, recipients: ceoRecipients.length ? ceoRecipients : nextAssignee ? [nextAssignee] : [] });
        if (action === "APPROVE" && next.state === "APPROVED" && requiresDigitalSignature(request.kind)) {
          await finalizeDigitalApprovedSnapshot(tx, { requestId: request.id, version: submittedVersion! });
        }
        if (normalizedPayload.normalizedPayment === true && action === "RETURN") {
          const existingDraft = await tx.workflowRequest.findFirst({ where: { projectId, module: "COSTFLOW", parentId: request.id, state: "DRAFT" }, select: { id: true } });
          if (existingDraft) throw new Error("Bản sửa liên kết đã tồn tại. Tải lại trang.");
          const reviewed = await tx.workflowRequest.findUniqueOrThrow({ where: { id: request.id }, include: { paymentRecipients: true, paymentLines: { orderBy: { position: "asc" } } } });
          const correction = await tx.workflowRequest.create({ data: { projectId, module: "COSTFLOW", kind: request.kind, title: `${request.title} · bản sửa`, creatorId: request.creatorId, cashAssigneeId: request.cashAssigneeId, parentId: request.id, state: "DRAFT", steps: json([]), payload: json({ ...normalizedPayload, resubmission: { sourceRequestId: request.id, sourceAttemptId: request.currentAttemptId ?? "", response: text(form, "reason") } }) } });
          for (const recipientSnapshot of reviewed.paymentRecipients) await tx.paymentRecipientSnapshot.create({ data: { projectId, requestId: correction.id, recipientKey: recipientSnapshot.recipientKey, recipientType: recipientSnapshot.recipientType, displayName: recipientSnapshot.displayName, bankName: recipientSnapshot.bankName, accountLast4: recipientSnapshot.accountLast4, sourceVersion: recipientSnapshot.sourceVersion, totalAmount: recipientSnapshot.totalAmount } });
          for (const line of reviewed.paymentLines) await tx.paymentRequestLine.create({ data: { projectId, requestId: correction.id, stableKey: line.stableKey, position: line.position, description: line.description, amount: line.amount, icRevisionId: line.icRevisionId, icLineId: line.icLineId, sourceSnapshot: json(line.sourceSnapshot), recipientKey: line.recipientKey, evidenceManifest: json(line.evidenceManifest) } });
          affectedRequestId = correction.id;
        }
        if (request.kind === "IC" && role === "CEO" && action === "RETURN") {
          const reviewed = data.revisions.find(revision => revision.requestId === request.id);
          if (!reviewed) throw new Error("Thiếu revision IC đã xét.");
          if (reviewed.supersededByRevisionId) throw new Error("Revision sửa lại đã tồn tại. Tải lại trang.");
          const correctionId = randomUUID();
          const correctionRequest = await tx.workflowRequest.create({ data: { projectId, module: "COSTFLOW", kind: "IC", title: `${request.title} · bản sửa`, creatorId: request.creatorId, cashAssigneeId: request.creatorId, parentId: request.id, steps: json([]), payload: json({ revisionId: correctionId, explanation: text(form, "reason") }), state: "DRAFT" } });
          const correction = { ...structuredClone(reviewed), id: correctionId, number: data.revisions.length + 1, requestId: correctionRequest.id, effective: false, createdBy: request.creatorId, parentRevisionId: reviewed.id, lineageReason: text(form, "reason") || "CEO trả để sửa", supersededByRevisionId: undefined, submissions: [] };
          reviewed.supersededByRevisionId = correction.id;
          data.revisions.push(correction);
          data.workingRevisionId = correction.id;
          await tx.workflowRequest.update({ where: { id: correctionRequest.id }, data: { payload: json(correction) } });
          savedRevisionId = correction.id;
        }
        break;
      }
      case "IC_MANAGER_EXPLANATION": {
        if (!request || request.kind !== "IC" || !steps || !["RETURNED", "REJECTED"].includes(request.state)) throw new Error("Chỉ ghi giải trình cho IC sau quyết định CEO trả hoặc từ chối.");
        const managerId = steps.find(step => step.role === "MANAGER")?.assigneeId;
        if (!managerId || actor.id !== managerId) throw new Error("Chỉ Quản lý được phân công của IC này có thể ghi giải trình.");
        const explanation = requireValue(text(form, "explanation"), "giải trình của Quản lý");
        const submittedVersion = await approvalSubmittedVersion();
        if ((await tx.workflowRequest.updateMany({ where: { id: request.id, version: request.version }, data: { version: { increment: 1 } } })).count !== 1) throw new Error("Dữ liệu đã thay đổi. Tải lại trang trước khi thao tác.");
        await recordApprovalEvent(tx, { requestId: request.id, module: request.module, attemptId: request.currentAttemptId, submittedVersion, mutationVersion: request.version + 1, stepIndex: request.currentStep, role: "MANAGER", actorId: actor.id, action: "IC_MANAGER_EXPLANATION", reason: explanation });
        break;
      }
      case "ADD_PAYMENT_LINE_DISCUSSION": {
        if (!request || !canReadRequest) throw new Error("Bạn không có quyền đọc hồ sơ này.");
        const line = await tx.paymentRequestLine.findFirst({ where: { id: text(form, "lineId"), requestId: request.id, projectId } });
        if (!line) throw new Error("Khoản trao đổi không thuộc đúng phiên bản hồ sơ.");
        const body = requireValue(text(form, "body"), "nội dung trao đổi");
        if (body.length > 5000) throw new Error("Nội dung trao đổi tối đa 5.000 ký tự.");
        const mentionIds = JSON.parse(text(form, "mentionIds") || "[]") as unknown;
        if (!Array.isArray(mentionIds) || mentionIds.some(id => typeof id !== "string") || new Set(mentionIds).size !== mentionIds.length) throw new Error("Danh sách người được nhắc không hợp lệ.");
        if (mentionIds.length) {
          const activeMentions = await tx.user.count({ where: { id: { in: mentionIds }, isActive: true, memberships: { some: { projectId } } } });
          if (activeMentions !== mentionIds.length) throw new Error("Chỉ được nhắc thành viên đang hoạt động của Project.");
        }
        await tx.paymentLineDiscussion.create({ data: { projectId, requestId: request.id, lineId: line.id, authorId: actor.id, body } });
        break;
      }
      case "TRANSFER": {
        if (!request || !steps || !(isAdmin || steps[0]?.assigneeId === actor.id)) throw new Error("Chỉ Quản lý của hồ sơ hoặc Admin được chuyển giao.");
        const submittedVersion = await approvalSubmittedVersion();
        assertApprovalToken(request, form, submittedVersion);
        const reason = requireValue(text(form, "reason"), "lý do chuyển giao");
        const assigneeId = await activeUser(text(form, "assigneeId"));
        const targetRole = text(form, "transferRole");
        const fromAssigneeId = targetRole === "CASH" ? request.cashAssigneeId : steps[request.currentStep]?.assigneeId;
        if (targetRole === "CASH") {
          const user = await tx.user.findUnique({ where: { id: assigneeId }, select: { role: true } });
          if (!user || !["ACCOUNT", "ADMIN"].includes(user.role)) throw new Error("Người xác nhận tiền phải là Account/người lập.");
          await tx.workflowRequest.update({ where: { id: request.id }, data: { cashAssigneeId: assigneeId, version: { increment: 1 } } });
        } else {
          if (request.state !== "SUBMITTED") throw new Error("Chỉ chuyển giao bước đang chờ xử lý.");
          const role = steps[request.currentStep]?.role;
          const standardAssigneeId = role === "MANAGER" ? steps[0]?.assigneeId : role === "ACCOUNTANT" ? data.config.accountantId : data.config.ceoId;
          await assertEligibleApprovalReceiver(tx, { userId: assigneeId, role, standardAssigneeId });
          const updated = steps.map((step, i) => i === request.currentStep ? { ...step, assigneeId } : step);
          if (fromAssigneeId) await tx.workflowRequestReader.upsert({ where: { requestId_userId: { requestId: request.id, userId: fromAssigneeId } }, create: { requestId: request.id, userId: fromAssigneeId, reason: "TRANSFERRED_STEP" }, update: {} });
          await tx.workflowRequest.update({ where: { id: request.id }, data: { steps: json(updated), currentStepArrivedAt: new Date(), version: { increment: 1 } } });
        }
        await tx.workflowDecision.create({ data: { requestId: request.id, version: request.version + 1, step: request.currentStep, actorId: actor.id, action: `TRANSFER_${targetRole === "CASH" ? "CASH" : "STEP"}:${assigneeId}`, reason } });
        await recordApprovalEvent(tx, { requestId: request.id, module: request.module, attemptId: request.currentAttemptId, submittedVersion, mutationVersion: request.version + 1, stepIndex: request.currentStep, role: targetRole === "CASH" ? "CASH" : steps[request.currentStep]?.role ?? "MANAGER", actorId: actor.id, action: `TRANSFER_${targetRole === "CASH" ? "CASH" : "STEP"}`, reason, fromAssigneeId, toAssigneeId: assigneeId, recipients: [assigneeId] });
        break;
      }
      case "CASH": throw new Error("Giao dịch tiền phải đi qua paymentCash authority.");
      default: throw new Error("Thao tác không hợp lệ.");
    }
    const updated = await tx.costFlowWorkspace.updateMany({ where: { projectId, version: expectedVersion }, data: { version: { increment: 1 }, data: json(data) } });
    if (updated.count !== 1) throw new Error("Dữ liệu đã thay đổi. Tải lại để tránh ghi trùng.");
    await tx.costFlowHistory.create({ data: { projectId, version: expectedVersion + 1, actorId: actor.id, action: command, snapshot: json(data) } });
    return { success: savedCustomerAcceptanceId ? `Đã lưu snapshot nghiệm thu khách hàng v${savedCustomerAcceptanceVersion}.` : savedScopes ? `Đã lưu ${savedScopes.join(" và ")}.` : "Đã lưu hồ sơ và lịch sử.", requestId: affectedRequestId, revisionId: savedRevisionId, quotationId: savedQuotationId, draftId: savedDraftId, beneficiaryId: savedBeneficiaryId, customerAcceptanceId: savedCustomerAcceptanceId, customerAcceptanceVersion: savedCustomerAcceptanceVersion, savedScopes, version: expectedVersion + 1 };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 });
}

