import "server-only";
import { randomUUID, createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { calculateCost, compare, decimal, exact, round, sum } from "./money";
import { closeBlockers, reconcile, settlement } from "./reconciliation";
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
import { blankPairedRow } from "./pairedDraft";
import { normalizeParameterBinding, parameterFinalizationIssues } from "./quotationParameters";
import { effectiveBaseline, icDecisionPolicy } from "./icEffectiveness";

type Actor = { id: string; role: string };
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
function requireValue(value: string, label: string) { if (!value) throw new Error(`Thiếu ${label}.`); return value; }
function positive(value: string) { if (compare(decimal(value), decimal("0")) <= 0) throw new Error("Số tiền phải lớn hơn 0."); return value; }

export async function loadFinance(projectId: string, actor: Actor) {
  const activeActor = await prisma.user.findFirst({where:{id:actor.id,isActive:true},select:{role:true}});
  if (!activeActor) return null;
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, name: true, ownerId: true, client: { select: { id: true, name: true } }, members: { select: { userId: true } } } });
  if (!project) return null;
  const fullAccess = activeActor.role === "ADMIN" || project.members.some(m => m.userId === actor.id);
  const requests = await prisma.workflowRequest.findMany({ where: { projectId, module: "COSTFLOW" }, include: { decisions: { orderBy: { createdAt: "asc" } }, approvalEvents: { orderBy: { createdAt: "asc" } } }, orderBy: { createdAt: "desc" } });
  const readerIds = fullAccess ? [] : (await prisma.workflowRequestReader.findMany({ where: { userId: actor.id, request: { projectId, module: "COSTFLOW" } }, select: { requestId: true } })).map(row => row.requestId);
  const visible = fullAccess ? requests : requests.filter(r => readerIds.includes(r.id) || r.creatorId === actor.id || r.cashAssigneeId === actor.id || (r.steps as ApprovalStep[]).some(s => s.assigneeId === actor.id));
  if (!fullAccess && !visible.length) return null;
  const workspace = await prisma.costFlowWorkspace.findUnique({ where: { projectId } });
  const cash = await prisma.costFlowCash.findMany({ where: { projectId, ...(!fullAccess ? { requestId: { in: visible.map(r => r.id) } } : {}) }, orderBy: { createdAt: "desc" } });
  const savedData = workspace?.data as unknown as FinanceData | undefined;
  const supplements = (savedData?.evidenceSupplements ?? []).filter(s => fullAccess || visible.some(r => r.id === s.requestId));
  const linkedIds = requestEvidenceIds(visible, supplements);
  const evidence = await prisma.costFlowEvidence.findMany({ where: { projectId, ...(!fullAccess ? { OR: [{ requestId: { in: visible.map(r => r.id) } }, { id: { in: linkedIds } }] } : {}) }, select: { id: true, name: true, kind: true, requestId: true, sha256: true, mimeType: true } });
  const visibleActors = new Set(visible.flatMap(r => [r.creatorId, r.cashAssigneeId, ...(r.steps as ApprovalStep[]).map(s => s.assigneeId), ...r.decisions.map(d => d.actorId)]));
  const users = await prisma.user.findMany({ where: fullAccess ? { isActive: true } : { id: { in: [...visibleActors] } }, select: { id: true, name: true, role: true }, orderBy: { name: "asc" } });
  const files = fullAccess ? await prisma.projectFile.findMany({ where: { projectId }, select: { id: true, name: true }, orderBy: { createdAt: "desc" } }) : [];
  const history = fullAccess ? await prisma.costFlowHistory.findMany({ where: { projectId }, select: { id: true, actorId: true, action: true, version: true, createdAt: true }, orderBy: { version: "desc" }, take: 50 }) : [];
  const clients = fullAccess ? await prisma.client.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }) : [];
  return { project: { ...project, members: fullAccess ? project.members : [], client: fullAccess ? project.client : null }, clients, fullAccess, version: workspace?.version ?? 0, data: fullAccess && savedData ? savedData : { ...emptyFinance(), closed: savedData?.closed ?? false }, requests: visible, cash, users, files, evidence, supplements, history };
}

export async function executeFinance(projectId: string, expectedVersion: number, actor: Actor, form: FormData, upload: ProjectUpload | null) {
  return prisma.$transaction(async tx => {
    const project = await tx.project.findUnique({ where: { id: projectId }, select: { members: { select: { userId: true } } } });
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

    const data = workspace.data as unknown as FinanceData;
    const cash = await tx.costFlowCash.findMany({ where: { projectId } });
    const requests = await tx.workflowRequest.findMany({ where: { projectId, module: "COSTFLOW" } });
    const command = requireValue(text(form, "command"), "thao tác");
    let savedRevisionId: string | undefined;
    let savedQuotationId: string | undefined;
    let savedDraftId: string | undefined;
    let savedScopes: string[] | undefined;
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
    if (workspace.version !== expectedVersion) throw new Error("Dữ liệu đã thay đổi. Tải lại trang trước khi thao tác.");
    const steps = request?.steps as ApprovalStep[] | undefined;
    const canReadRequest = !!request && (member || isAdmin || request.creatorId === actor.id || request.cashAssigneeId === actor.id || !!steps?.some(s => s.assigneeId === actor.id));
    if (!member && !isAdmin && (!canReadRequest || !["DECIDE", "CASH", "TRANSFER", "IC_MANAGER_EXPLANATION"].includes(command))) throw new Error("Bạn chỉ được xử lý hồ sơ được phân công.");
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

    switch (command) {
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
        data.config = { accountantId: await activeUser(text(form, "accountantId")), ceoId: await activeUser(text(form, "ceoId")), managerId: await activeUser(text(form, "managerId")) };
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
          const input = { quantity: String(row.quantity ?? ""), unitPrice: String(row.unitPrice ?? ""), basis: row.basis ?? "NET", vatPercent: String(row.vatPercent ?? "") };
          const parentLineId = (row.id && parent?.lines.some(l => l.id === row.id) ? row.id : row.parentQuotationLineId);
          if (parentLineId && !parent?.lines.some(l => l.id === parentLineId)) throw new Error("Dòng báo giá cha không thuộc bản nguồn đã chọn.");
          return { ...input, id: randomUUID(), description: requireValue(String(row.description ?? "").trim(), "nội dung báo giá"), unit: String(row.unit ?? ""), cost: calculateCost(input), ...(parentLineId ? { parentQuotationLineId: parentLineId } : {}) };
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
        const quotation = { id: randomUUID(), number: quotations.length + 1, parentId: parent?.id ?? null, title, customer, notes: text(form, "notes"), lines, poIds, briefIds, evidenceIds, createdBy: actor.id, createdAt: new Date().toISOString() };
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
          const input = { quantity: String(row.quantity ?? ""), unitPrice: String(row.unitPrice ?? ""), basis: row.basis ?? "NET", vatPercent: String(row.vatPercent ?? "") };
          if (row.quotationId || row.quotationLineId) {
            const source = data.quotations?.find(q => q.id === row.quotationId);
            if (!source?.lines.some(line => line.id === row.quotationLineId)) throw new Error("Hạng mục báo giá nguồn không thuộc project/phiên bản đã lưu.");
          }
          const description = String(row.description ?? "").trim();
          const issues = draftLineIssues({ ...input, description });
          const retained = [...(existing?.lines ?? []), ...(copySource?.lines ?? [])].find(l => l.id === row.id);
          return { ...input, itemId: retained?.itemId, parameterBinding: normalizeParameterBinding(row.parameterBinding ?? retained?.parameterBinding), evidenceIds: row.evidenceIds ?? retained?.evidenceIds ?? [], evidenceReason: row.evidenceReason ?? retained?.evidenceReason ?? "", internalNotes: row.internalNotes ?? retained?.internalNotes ?? "", id: row.id && knownIds.has(row.id) ? row.id : randomUUID(), description, unit: String(row.unit ?? ""), cost: issues.length ? null : calculateCost(input), ...(retained?.originLines ? { originLines: retained.originLines } : {}), ...(row.vendorId ? { vendorId: requireValue(String(row.vendorId), "NCC") } : {}), ...(row.quotationId ? { quotationId: row.quotationId, quotationLineId: row.quotationLineId } : {}) };
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
          existing.lines = lines; existing.poIds = poIds; existing.briefIds = briefIds; existing.evidenceIds = evidenceIds;
          savedRevisionId = existing.id;
          await tx.workflowRequest.update({ where: { id: request.id }, data: { title: requireValue(text(form, "title"), "tên IC"), version: { increment: 1 }, payload: json({ revisionId: existing.id, lines, poIds, briefIds, evidenceIds }) } });
        } else {
          const id = randomUUID();
          const saved = await createRequest("IC", { revisionId: id, explanation: text(form, "explanation") }, [], "DRAFT");
          const withdrawalReason = parentRequest ? (await tx.workflowDecision.findFirst({ where: { requestId: parentRequest.id, action: "WITHDRAW" }, orderBy: { createdAt: "desc" }, select: { reason: true } }))?.reason : undefined;
          const cancellationReason = parentRequest?.state === "CANCELLED" ? String((requests.find(candidate => candidate.kind === "CANCEL" && candidate.state === "APPROVED" && (candidate.payload as RequestPayload).targetRequestId === parentRequest.id)?.payload as RequestPayload | undefined)?.explanation ?? "") : undefined;
          const lineageReason = text(form, "explanation") || withdrawalReason || cancellationReason || undefined;
          if (handoff && !lineageReason) throw new Error("Thiếu lý do rút/hủy/trả để liên kết revision mới.");
          const revision = { id, number: data.revisions.length + 1, requestId: saved.id, effective: false, lines, poIds, briefIds, evidenceIds, createdBy: actor.id, ...(copySource ? { parentRevisionId: copySource.id, lineageReason, parameterConfig: copySource.parameterConfig ? structuredClone(copySource.parameterConfig) : undefined } : {}) };
          if (handoff && copySource) {
            if (!copySource.submissions?.length && parentRequest) copySource.submissions = [{ requestId: parentRequest.id, requestVersion: parentRequest.version, submittedAt: null, title: parentRequest.title, parameterConfig: copySource.parameterConfig ? structuredClone(copySource.parameterConfig) : undefined, lines: structuredClone(copySource.lines), poIds: [...copySource.poIds], briefIds: [...(copySource.briefIds ?? [])], evidenceIds: [...(copySource.evidenceIds ?? [])] }];
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
          row.buy = { ...row.buy, quantity: line.quantity, unitPrice: line.unitPrice, vatPercent: line.vatPercent, basis: line.basis, unit: line.unit, notes: line.internalNotes ?? "", parameterBinding: line.parameterBinding ? structuredClone(line.parameterBinding) : undefined, vendorId: line.vendorId ?? "", evidenceIds: [...(line.evidenceIds ?? [])], evidenceReason: line.evidenceReason ?? "" };
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
        revision.submissions = [...(revision.submissions ?? []), { requestId: request.id, requestVersion: request.version + 1, submittedAt: new Date().toISOString(), title: request.title, explanation, baselineRevisionId: baseline?.id ?? null, parameterConfig: revision.parameterConfig ? structuredClone(revision.parameterConfig) : undefined, tree: structuredClone(revision.tree ?? []), evidenceHashes: { ...revision.evidenceHashes }, lines: structuredClone(revision.lines), poIds: [...revision.poIds], briefIds: [...(revision.briefIds ?? [])], evidenceIds: [...(revision.evidenceIds ?? [])] }];
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
          const input = { quantity: String(row.quantity ?? ""), unitPrice: String(row.unitPrice ?? ""), basis: row.basis ?? "NET", vatPercent: String(row.vatPercent ?? "") };
          const description = requireValue(String(row.description ?? "").trim(), "nội dung dòng kết quả");
          const line: IcLine = { ...input, description, unit: String(row.unit ?? ""), id: randomUUID(), cost: draftLineIssues({ ...input, description }).length ? null : calculateCost(input), originLines: ids.map(lineId => ({ revisionId: revision.id, lineId })) };
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
            existing.cost = draftLineIssues(existing).length ? null : calculateCost(existing);
          } else revision.lines.push({ id: randomUUID(), description: row.description, quantity: row.quantity, unit: row.unit, basis: "NET", unitPrice: "", vatPercent: "", cost: null, quotationId: quotation.id, quotationLineId: row.id });
        }
        if (revision.lines.length > 500) throw new Error("IC tối đa 500 dòng.");
        await tx.workflowRequest.update({ where: { id: request.id }, data: { payload: json(revision), version: { increment: 1 } } });
        savedRevisionId = revision.id;
        break;
      }
      case "BENEFICIARY": {
        needCreator();
        const existing = data.beneficiaries.find(b => b.id === text(form, "beneficiaryId"));
        const proofId = await snapshotFile(requireValue(text(form, "sourceFileId"), "căn cứ tài khoản"), "BENEFICIARY");
        const updated = { id: existing?.id ?? randomUUID(), name: requireValue(text(form, "name"), "tên người nhận"), bank: requireValue(text(form, "bank"), "ngân hàng"), account: requireValue(text(form, "account"), "số tài khoản"), version: (existing?.version ?? 0) + 1, verifiedVersion: null, proofId: proofId! };
        if (existing) Object.assign(existing, updated); else data.beneficiaries.push(updated);
        break;
      }
      case "EXPENSE": {
        needCreator();
        const revision = requireEffectiveIc(text(form, "revisionId"));
        const lineId = text(form, "lineId");
        if (!revision.lines.some(line => line.id === lineId)) throw new Error("Chi phí phải truy được dòng IC.");
        const input = { quantity: text(form, "quantity"), unitPrice: text(form, "unitPrice"), basis: text(form, "basis") as "NET" | "GROSS", vatPercent: text(form, "vatPercent") };
        data.expenses.push({ id: randomUUID(), revisionId: revision.id, lineId, recipientKey: await recipient(text(form, "recipientKey")), description: requireValue(text(form, "description"), "nội dung chi phí"), input, cost: calculateCost(input), invoiceId: await snapshotFile(text(form, "invoiceFileId"), "INVOICE"), paymentProofId: await snapshotFile(text(form, "paymentFileId"), "EXPENSE_PAYMENT"), createdBy: actor.id });
        break;
      }
      case "EXPENSE_EVIDENCE": {
        needCreator();
        const expense = data.expenses.find(e => e.id === text(form, "expenseId"));
        if (!expense) throw new Error("Không tìm thấy chi phí.");
        const invoiceId = await snapshotFile(text(form, "invoiceFileId"), "INVOICE");
        const paymentProofId = await snapshotFile(text(form, "paymentFileId"), "EXPENSE_PAYMENT");
        if (!invoiceId && !paymentProofId) throw new Error("Chọn chứng từ cần bổ sung.");
        expense.invoiceId = invoiceId ?? expense.invoiceId; expense.paymentProofId = paymentProofId ?? expense.paymentProofId;
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
        const key = await recipient(text(form, "recipientKey"));
        if (kind === "ADVANCE" && !key.startsWith("USER:")) throw new Error("Tạm ứng dành cho nhân viên.");
        if (kind === "VENDOR_PAYMENT" && !key.startsWith("VENDOR:")) throw new Error("Chi NCC cần người thụ hưởng NCC.");
        if (kind === "REIMBURSEMENT" && !key.startsWith("USER:")) throw new Error("Phiếu Hoàn Tạm Ứng dành cho nhân viên; NCC đối soát theo hồ sơ thanh toán.");
        const revision = requireEffectiveIc(text(form, "revisionId"));
        const beneficiary = data.beneficiaries.find(b => `VENDOR:${b.id}` === key);
        const body: RequestPayload = { revisionId: revision.id, recipientKey: key, beneficiaryVersion: beneficiary?.version, explanation: text(form, "explanation"), lines: revision.lines, beneficiary: beneficiary ? { name: beneficiary.name, bank: beneficiary.bank, account: beneficiary.account } : undefined };
        if (kind === "REIMBURSEMENT") {
          Object.assign(body, settlement(data, cash, key));
          body.advance = round(sum(cash.filter(c => c.recipientKey === key && c.direction === "OUT" && requests.some(r => r.id === c.requestId && r.kind === "ADVANCE")).map(c => decimal(c.amount))));
          body.amount = body.additional !== "0" ? body.additional : body.refund;
          body.evidenceIds = data.expenses.filter(e => body.expenseIds?.includes(e.id)).flatMap(e => [e.invoiceId!, e.paymentProofId!]);
        } else body.amount = positive(text(form, "amount"));
        if (kind === "ADVANCE" && requests.some(r => r.kind === "ADVANCE" && (r.payload as RequestPayload).recipientKey === key && !["WITHDRAWN", "REJECTED", "CANCELLED"].includes(r.state))) requireValue(body.explanation ?? "", "giải trình tạm ứng bổ sung");
        const saved = await createRequest(kind, body, await ordinarySteps());
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
        if (action === "APPROVE" && role === "ACCOUNTANT" && text(form, "reviewConfirmed") !== "yes") throw new Error("Kế toán cần xác nhận đã kiểm tra thông tin, chứng từ và phiên bản trước khi chuyển CEO.");
        if (action === "APPROVE" && role === "ACCOUNTANT" && payload?.recipientKey?.startsWith("VENDOR:")) {
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
        if ((await tx.workflowRequest.updateMany({ where: { id: request.id, version: request.version }, data: { ...next, currentStepArrivedAt: next.state === "SUBMITTED" && action === "APPROVE" ? new Date() : next.state === "SUBMITTED" ? request.currentStepArrivedAt : null, version: { increment: 1 } } })).count !== 1) throw new Error("Dữ liệu đã thay đổi. Tải lại trang trước khi thao tác.");
        await tx.workflowDecision.create({ data: { requestId: request.id, version: request.version + 1, step: request.currentStep, actorId: actor.id, action, reason: text(form, "reason") } });
        await recordApprovalEvent(tx, { requestId: request.id, module: request.module, attemptId: request.currentAttemptId, submittedVersion, mutationVersion: request.version + 1, stepIndex: request.currentStep, role: role ?? "CREATOR", actorId: actor.id, action, reason: text(form, "reason"), details: corrections.length ? json({ correctionItems: corrections }) : undefined, recipients: ceoRecipients.length ? ceoRecipients : nextAssignee ? [nextAssignee] : [] });
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
      case "CASH": {
        if (!request || request.state !== "APPROVED" || request.cashAssigneeId !== actor.id || !["ADVANCE", "VENDOR_PAYMENT", "REIMBURSEMENT"].includes(request.kind)) throw new Error("Chỉ Account được giao hồ sơ đã duyệt mới xác nhận tiền.");
        const body = payload!;
        if (body.recipientKey?.startsWith("VENDOR:")) {
          const beneficiary = data.beneficiaries.find(b => `VENDOR:${b.id}` === body.recipientKey);
          if (!beneficiary || beneficiary.version !== body.beneficiaryVersion || beneficiary.verifiedVersion !== beneficiary.version) throw new Error("Người thụ hưởng đã đổi hoặc chưa được Kế toán xác minh lại.");
        }
        const amount = positive(text(form, "amount"));
        const paid = sum(cash.filter(c => c.requestId === request.id).map(c => decimal(c.amount)));
        if (compare(sum([paid, decimal(amount)]), decimal(body.amount ?? "0")) > 0) throw new Error("Tổng giao dịch vượt số tiền hồ sơ đã duyệt.");
        const direction = request.kind === "REIMBURSEMENT" && body.refund !== "0" ? "IN" : "OUT";
        if (request.kind === "REIMBURSEMENT") {
          const current = reconcile(data, cash).find(row => row.recipientKey === body.recipientKey);
          if (!current || (direction === "OUT" ? !current.payable : !current.receivable)) throw new Error("Số dư đã thay đổi. Lập lại đề nghị hoàn ứng theo đối soát hiện tại.");
          const absolute = exact(current.rawBalance);
          if (compare(decimal(amount), exact(`${absolute.numerator < BigInt(0) ? -absolute.numerator : absolute.numerator}/${absolute.denominator}`)) > 0) throw new Error("Khoản tiền vượt số dư còn phải xử lý.");
        }
        const allocations = JSON.parse(text(form, "allocations") || "[]") as { lineId: string; amount: string }[];
        const revision = data.revisions.find(r => r.id === body.revisionId);
        if (!allocations.length || allocations.some(a => !revision?.lines.some(l => l.id === a.lineId) || compare(decimal(a.amount), decimal("0")) <= 0) || new Set(allocations.map(a => a.lineId)).size !== allocations.length || compare(sum(allocations.map(a => decimal(a.amount))), decimal(amount)) !== 0) throw new Error("Phân bổ phải đúng dòng IC, không trùng và cộng đúng số tiền giao dịch.");
        let evidenceId: string | null;
        if (upload) {
          evidenceId = (await tx.costFlowEvidence.create({ data: { projectId, requestId: request.id, sourceFileId: "uploaded-cash-proof", kind: "CASH", name: upload.name, mimeType: upload.mimeType, data: upload.data, sha256: createHash("sha256").update(upload.data).digest("hex"), createdBy: actor.id } })).id;
        } else evidenceId = await snapshotFile(text(form, "sourceFileId"), "CASH", request.id);
        if (!evidenceId) throw new Error("Cần biên lai chuyển khoản hoặc phiếu thu/chi tiền mặt.");
        const occurredAt = new Date(text(form, "occurredAt"));
        if (!Number.isFinite(occurredAt.getTime())) throw new Error("Ngày giao dịch không hợp lệ.");
        await tx.costFlowCash.create({ data: { projectId, requestId: request.id, recipientKey: body.recipientKey!, direction, amount, reference: requireValue(text(form, "reference"), "mã giao dịch/chứng từ duy nhất"), allocations: json(allocations), evidenceId, occurredAt, confirmedBy: actor.id } });
        break;
      }
      default: throw new Error("Thao tác không hợp lệ.");
    }
    const updated = await tx.costFlowWorkspace.updateMany({ where: { projectId, version: expectedVersion }, data: { version: { increment: 1 }, data: json(data) } });
    if (updated.count !== 1) throw new Error("Dữ liệu đã thay đổi. Tải lại để tránh ghi trùng.");
    await tx.costFlowHistory.create({ data: { projectId, version: expectedVersion + 1, actorId: actor.id, action: command, snapshot: json(data) } });
    return { success: savedScopes ? `Đã lưu ${savedScopes.join(" và ")}.` : "Đã lưu hồ sơ và lịch sử.", requestId: affectedRequestId, revisionId: savedRevisionId, quotationId: savedQuotationId, draftId: savedDraftId, savedScopes, version: expectedVersion + 1 };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 });
}

