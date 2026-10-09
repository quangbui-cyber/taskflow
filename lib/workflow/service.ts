import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { ProjectUpload } from "@/lib/projectFiles";
import { decimal, compare } from "@/lib/costflow/money";
import { decide, validateSteps, type ApprovalStep, type Decision } from "./approval";
import { assertWorkflowFile, documentReader, isTemplateKind, type DocumentPayload } from "./documents";
import { latestPublished } from "./catalog";
import { effectiveRequirements, evaluateDocumentCompleteness, parseRequirements } from "./requirements";
import { assertApprovalToken, correctionItems, recordApprovalEvent } from "./approvalEvents";
import { assertEligibleApprovalReceiver } from "./permissions";
import { assertWorkflowLifecycleAllows } from "./lifecycle";

type Actor = { id: string; role: string };
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const text = (form: FormData, name: string) => String(form.get(name) ?? "").trim();
const required = (value: string, label: string) => { if (!value) throw new Error(`Thiếu ${label}.`); return value; };
const version = (form: FormData) => { const value = Number(form.get("version")); if (!Number.isSafeInteger(value) || value < 0) throw new Error("Phiên bản không hợp lệ."); return value; };
const conflict = () => { throw new Error("Dữ liệu đã thay đổi. Tải lại trước khi thao tác."); };
async function activeActor(actor: Actor) {
  const user = await prisma.user.findFirst({ where: { id: actor.id, isActive: true }, select: { id: true, role: true, managerId: true } });
  if (!user) throw new Error("Tài khoản không còn hoạt động.");
  return user;
}
export async function loadWorkflow(actor: Actor) {
  const user = await activeActor(actor); const admin = user.role === "ADMIN";
  const available = await prisma.workflowTemplate.findMany({ where: admin ? {} : { OR: [{ publishedAt: { not: null } }, { ownerId: user.id }] }, orderBy: [{ kind: "asc" }, { version: "desc" }] });
  const templates = latestPublished(available);
  const managedTemplates = admin ? available : available.filter(t => t.ownerId === user.id);
  const projects = await prisma.project.findMany({ where: admin ? {} : { members: { some: { userId: user.id } } }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  const all = await prisma.workflowRequest.findMany({ where: admin ? {} : { OR: [{ creatorId: user.id }, { projectId: { in: projects.map(p => p.id) } }, ...["MANAGER", "ACCOUNTANT", "CEO"].map(role => ({ steps: { array_contains: [{ role, assigneeId: user.id }] } })), { cashAssigneeId: user.id, module: "COSTFLOW" }, { module: "WORKFLOW", payload: { path: ["responsibleManagerId"], equals: user.id } }, { readers: { some: { userId: user.id } } }, { approvalEvents: { some: { actorId: user.id } } }] }, select: { id: true, projectId: true, module: true, kind: true, title: true, creatorId: true, parentId: true, state: true, version: true, steps: true, currentStep: true, currentAttemptId: true, currentStepArrivedAt: true, replacesRequestId: true, replacedByRequestId: true, pendingReplacementRequestId: true, supersededAt: true, createdAt: true, updatedAt: true, project: { select: { name: true, costFlow: { select: { version: true } } } }, approvalEvents: { select: { id: true, actorId: true, action: true, attemptId: true, submittedVersion: true, createdAt: true } } }, orderBy: [{ currentStepArrivedAt: "asc" }, { id: "asc" }] });
  const summaries = all.map((request) => {
    const steps = request.steps as unknown as ApprovalStep[];
    const current = steps[request.currentStep];
    return {
      ...request,
      code: `HS-${request.id.slice(-8).toUpperCase()}`,
      steps,
      currentRole: current?.role ?? null,
      currentAssigneeId: current?.assigneeId ?? null,
      attemptNumber: request.parentId ? 2 : 1,
      resubmission: !!request.parentId,
      submittedVersion: request.approvalEvents.find(event => event.action.includes("SUBMIT") && event.attemptId === request.currentAttemptId)?.submittedVersion ?? null,
      financeVersion: request.project?.costFlow?.version ?? null,
      processedAt: request.approvalEvents.filter(event => event.actorId === user.id && !event.action.includes("SUBMIT")).at(-1)?.createdAt ?? null,
    };
  });
  const views = {
    pending: summaries.filter((request) => request.state === "SUBMITTED" && request.currentAssigneeId === user.id),
    processed: summaries.filter((request) => request.approvalEvents.some(event => event.actorId === user.id && !event.action.includes("SUBMIT"))),
    mine: summaries.filter((request) => request.creatorId === user.id),
  };
  const visibleActorIds = [...new Set([...templates.flatMap(t => [t.ownerId, t.accountantId, t.ceoId]), ...summaries.flatMap(request => [request.creatorId, ...request.steps.map(step => step.assigneeId)])])];
  const users = await prisma.user.findMany({ where: admin ? { isActive: true } : { id: { in: visibleActorIds } }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  return { templates, managedTemplates, projects, requests: summaries, views, users, admin };
}
export async function loadDocument(id: string, actor: Actor) {
  const user = await activeActor(actor);
  const request = await prisma.workflowRequest.findFirst({ where: { id, module: "WORKFLOW" }, include: { template: true, project: { select: { id: true, name: true } }, approvalEvents: { orderBy: { createdAt: "asc" } }, decisions: { orderBy: { createdAt: "asc" } }, files: { select: { id: true, kind: true, name: true, size: true, sha256: true, createdAt: true }, orderBy: { createdAt: "asc" } }, history: { select: { id: true, actorId: true, action: true, version: true, createdAt: true }, orderBy: { version: "desc" } } } });
  if (!request) return null;
  const member = !!request.projectId && !!await prisma.projectMember.findUnique({ where: { projectId_userId: { projectId: request.projectId, userId: user.id } } });
  const dossierReader = !!await prisma.workflowRequestReader.findUnique({ where: { requestId_userId: { requestId: request.id, userId: user.id } } });
  if (!documentReader(request, user.id, user.role === "ADMIN", member) && !dossierReader) return null;
  const steps = request.steps as ApprovalStep[]; const body = request.payload as unknown as DocumentPayload;
  const canTransfer = user.role === "ADMIN" || steps.some(step => step.role === "MANAGER" && step.assigneeId === user.id) || body.responsibleManagerId === user.id;
  const actorIds = [...new Set([request.creatorId, ...steps.map(s => s.assigneeId), ...request.decisions.map(d => d.actorId), ...request.history.map(h => h.actorId), body.signature?.confirmedBy ?? "", body.responsibleManagerId ?? ""])];
  const users = await prisma.user.findMany({ where: canTransfer ? { isActive: true } : { id: { in: actorIds } }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  let linked: { id: string; title: string; module: string; projectId: string | null } | null = null;
  if (body.linkedRequestId) {
    const candidate = await prisma.workflowRequest.findUnique({ where: { id: body.linkedRequestId } });
    const linkedMember = !!candidate?.projectId && !!await prisma.projectMember.findUnique({ where: { projectId_userId: { projectId: candidate.projectId, userId: user.id } } });
    if (candidate && (documentReader(candidate, user.id, user.role === "ADMIN", linkedMember) || candidate.module === "COSTFLOW" && candidate.cashAssigneeId === user.id)) linked = { id: candidate.id, title: candidate.title, module: candidate.module, projectId: candidate.projectId };
  }
  const current = steps[request.currentStep];
  const submittedVersion = request.approvalEvents.find(event => event.action === "SUBMIT_DOCUMENT" && event.attemptId === request.currentAttemptId)?.submittedVersion ?? null;
  return { request: { ...request, code: `HS-${request.id.slice(-8).toUpperCase()}`, currentRole: current?.role ?? null, currentAssigneeId: current?.assigneeId ?? null, submittedVersion, attemptNumber: request.parentId ? 2 : 1, resubmission: !!request.parentId, processedAt: null }, users, canTransfer, linked };
}
export async function executeWorkflow(actor: Actor, form: FormData, upload: ProjectUpload | null) {
  if (upload) assertWorkflowFile(upload);
  const actorData = await activeActor(actor);
  return prisma.$transaction(async tx => {
    const user = await tx.user.findFirst({ where: { id: actorData.id, isActive: true }, select: { id: true, role: true, managerId: true } });
    if (!user) throw new Error("Tài khoản không còn hoạt động.");
    const admin = user.role === "ADMIN"; const command = text(form, "command");
    const active = async (id: string) => { if (!id || !await tx.user.findFirst({ where: { id, isActive: true }, select: { id: true } })) throw new Error("Thiếu người xử lý đang hoạt động."); return id; };
    const file = async (parent: { templateId: string } | { requestId: string }, kind: string, supportingSlot?: string) => {
      if (!upload) throw new Error("Cần tải tài liệu thật.");
      return tx.workflowFile.create({ data: { ...parent, kind, supportingSlot, name: upload.name, mimeType: upload.mimeType, size: upload.size, data: upload.data, sha256: createHash("sha256").update(upload.data).digest("hex"), uploadedBy: user.id } });
    };
    const member = async (projectId: string | null) => !!projectId && !!await tx.projectMember.findUnique({ where: { projectId_userId: { projectId, userId: user.id } } });
    if (["GRANT_APPROVAL_ROLE", "REVOKE_APPROVAL_ROLE"].includes(command)) {
      if (!admin) throw new Error("Chỉ Admin quản lý vai trò duyệt bổ sung.");
      const targetUserId = text(form, "userId");
      const role = text(form, "approvalRole");
      if (!["MANAGER", "ACCOUNTANT", "CEO", "AC_DD"].includes(role)) throw new Error("Vai trò duyệt không hợp lệ.");
      if (!await tx.user.findFirst({ where: { id: targetUserId, isActive: true }, select: { id: true } })) throw new Error("Người được cấp vai trò không còn hoạt động.");
      const existing = await tx.workflowRoleGrant.findFirst({ where: { userId: targetUserId, role, revokedAt: null } });
      if (command === "GRANT_APPROVAL_ROLE") {
        if (role === "AC_DD") {
          await tx.workflowRoleGrant.updateMany({ where: { role: "AC_DD", revokedAt: null, userId: { not: targetUserId } }, data: { revokedAt: new Date() } });
        }
        if (!existing) await tx.workflowRoleGrant.create({ data: { userId: targetUserId, role, grantedById: user.id } });
        return { success: role === "AC_DD" ? "Đã cấu hình một DD đang hoạt động cho toàn công ty." : "Đã cấp vai trò duyệt bổ sung." };
      }
      if (role === "AC_DD") throw new Error("DD chỉ được thay thế bằng một người đang hoạt động, không được để trống.");
      if (!existing) throw new Error("Người này không có vai trò đang hiệu lực để thu hồi.");
      await tx.workflowRoleGrant.update({ where: { id: existing.id }, data: { revokedAt: new Date() } });
      return { success: "Đã thu hồi vai trò duyệt bổ sung." };
    }
    if (["SAVE_TEMPLATE", "CONFIRM_TEMPLATE", "PUBLISH_TEMPLATE"].includes(command)) {
      const id = text(form, "templateId"); const template = id ? await tx.workflowTemplate.findUnique({ where: { id } }) : null;
      if (id && !template) throw new Error("Không tìm thấy mẫu.");
      if (template && template.revision !== version(form)) conflict();
      if (template?.publishedAt) throw new Error("Mẫu đã công bố được giữ nguyên. Tạo phiên bản mới để sửa.");
      if (command === "SAVE_TEMPLATE") {
        if (!admin) throw new Error("Chỉ Admin cấu hình mẫu.");
        const kind = text(form, "kind"); if (!isTemplateKind(kind)) throw new Error("Loại mẫu không được hỗ trợ.");
        if (template && template.kind !== kind) throw new Error("Không đổi loại của một phiên bản mẫu.");
        const parentId = text(form, "parentTemplateId");
        const parent = parentId ? await tx.workflowTemplate.findUnique({ where: { id: parentId } }) : null;
        if (parentId && (!parent?.publishedAt || parent.kind !== kind)) throw new Error("Nguồn phải là mẫu cùng loại đã công bố.");
        const values = { kind, category: text(form, "category"), purpose: text(form, "purpose"), changeNote: text(form, "changeNote"), name: required(text(form, "name"), "tên mẫu"), ownerId: text(form, "ownerId"), accountantId: text(form, "accountantId"), ceoId: text(form, "ceoId"), signerNames: text(form, "signerNames"), instructions: text(form, "instructions"), ownerConfirmedAt: null };
        const requirementsText = text(form,"requirements");
        if (!requirementsText && !template && !parent) throw new Error("Cần cấu hình rõ thông tin và tài liệu bắt buộc cho mẫu mới.");
        const requirements = requirementsText ? parseRequirements(JSON.parse(requirementsText)) : effectiveRequirements(template?.requirements ?? parent?.requirements);
        const configuredValues = {...values, requirements: json(requirements)};
        let saved = template;
        if (template) {
          if ((await tx.workflowTemplate.updateMany({ where: { id, revision: template.revision, publishedAt: null }, data: { ...configuredValues, revision: { increment: 1 } } })).count !== 1) conflict();
          saved = await tx.workflowTemplate.findUniqueOrThrow({ where: { id } });
        } else {
          const familyId = parent?.familyId ?? randomUUID();
          const latest = await tx.workflowTemplate.aggregate({ where: { familyId }, _max: { version: true } });
          saved = await tx.workflowTemplate.create({ data: { ...configuredValues, familyId, version: (latest._max.version ?? 0) + 1, parentId: parent?.id, fileId: parent?.fileId, createdBy: user.id } });
        }
        if (upload) await tx.workflowTemplate.update({ where: { id: saved!.id }, data: { fileId: (await file({ templateId: saved!.id }, "TEMPLATE")).id } });
        return { success: "Đã lưu mẫu nháp. Owner cần xác nhận bản này.", templateId: saved!.id };
      }
      if (!template) throw new Error("Chọn mẫu.");
      if (command === "CONFIRM_TEMPLATE") {
        if (template.ownerId !== user.id) throw new Error("Chỉ owner nội dung của mẫu được xác nhận.");
        if (!template.fileId || !template.signerNames || !template.instructions) throw new Error("Bổ sung file mẫu thật, người ký và hướng dẫn trước khi xác nhận.");
        await active(template.ownerId); await active(template.accountantId); await active(template.ceoId);
        if ((await tx.workflowTemplate.updateMany({ where: { id, revision: template.revision, publishedAt: null }, data: { ownerConfirmedAt: new Date(), revision: { increment: 1 } } })).count !== 1) conflict();
        return { success: "Owner đã xác nhận nội dung phiên bản này." };
      }
      if (!admin) throw new Error("Chỉ Admin công bố mẫu.");
      if (template.parentId && !template.changeNote.trim()) throw new Error("Bổ sung ghi chú thay đổi trước khi công bố phiên bản mới.");
      if (!template.fileId || !template.ownerConfirmedAt || !template.signerNames || !template.instructions) throw new Error("Chưa có file mẫu thật hoặc owner chưa xác nhận nội dung.");
      await active(template.ownerId); await active(template.accountantId); await active(template.ceoId);
      if ((await tx.workflowTemplate.updateMany({ where: { id, revision: template.revision, publishedAt: null }, data: { publishedAt: new Date(), revision: { increment: 1 } } })).count !== 1) conflict();
      return { success: "Đã công bố mẫu. Chỉ hồ sơ gửi mới dùng phiên bản này." };
    }

    let request = text(form, "requestId") ? await tx.workflowRequest.findFirst({ where: { id: text(form, "requestId"), module: "WORKFLOW" } }) : null;
    if (text(form, "requestId") && !request) throw new Error("Không tìm thấy hồ sơ Workflow.");
    if (request && request.version !== version(form)) conflict();
    if (request && !documentReader(request, user.id, admin, await member(request.projectId))) throw new Error("Bạn không có quyền trên hồ sơ này.");
    const body: DocumentPayload = request ? request.payload as unknown as DocumentPayload : { content: "", counterparty: "", amount: "", linkedRequestId: "", mainFileId: "" };
    const oldVersion = request?.version ?? 0;
    const steps = request?.steps as ApprovalStep[] | undefined;
    const audit = async (action: string) => {
      const current = await tx.workflowRequest.findUniqueOrThrow({ where: { id: request!.id } });
      await tx.workflowHistory.create({ data: { requestId: current.id, version: current.version, actorId: user.id, action, snapshot: json({ title: current.title, projectId: current.projectId, templateId: current.templateId, state: current.state, steps: current.steps, currentStep: current.currentStep, currentAttemptId: current.currentAttemptId, currentStepArrivedAt: current.currentStepArrivedAt, payload: current.payload }) } });
    };
    const update = async (values: Prisma.WorkflowRequestUncheckedUpdateManyInput) => {
      if ((await tx.workflowRequest.updateMany({ where: { id: request!.id, version: oldVersion }, data: { ...values, version: { increment: 1 } } })).count !== 1) conflict();
    };
    if (command === "SAVE_DOCUMENT") {
      if (request && (request.creatorId !== user.id || request.state !== "DRAFT")) throw new Error("Chỉ sửa nháp của người lập; bản đã gửi phải tạo lần trình mới.");
      const template = await tx.workflowTemplate.findFirst({ where: { id: text(form, "templateId"), publishedAt: { not: null } } });
      if (!template) throw new Error("Chọn mẫu đã công bố.");
      if (request && request.templateId !== template.id) throw new Error("Không đổi mẫu của nháp hiện có. Tạo nháp riêng theo mẫu mới.");
      if (!request) {
        const latest = await tx.workflowTemplate.findFirst({where:{familyId:template.familyId,publishedAt:{not:null}},orderBy:{version:"desc"}});
        if (latest?.id !== template.id) throw new Error("Chọn phiên bản hiện tại để tạo hồ sơ mới.");
      }
      const projectId = text(form, "projectId") || null;
      if (projectId && !admin && !await member(projectId)) throw new Error("Bạn phải là member của project được chọn.");
      if (projectId && !await tx.project.findUnique({ where: { id: projectId }, select: { id: true } })) throw new Error("Không tìm thấy project.");
      const parentId = text(form, "parentRequestId");
      const parent = parentId ? await tx.workflowRequest.findFirst({ where: { id: parentId, module: "WORKFLOW", creatorId: user.id, state: { in: ["RETURNED", "APPROVED", "WITHDRAWN", "REJECTED"] } } }) : null;
      if (parentId && (!parent || parent.kind !== template.kind)) throw new Error("Bản nguồn phải là hồ sơ cùng loại của người lập, đã trả/duyệt/rút/từ chối.");
      if (parent?.state === "APPROVED") {
        const parentBody = parent.payload as unknown as DocumentPayload;
        if (parentBody.signature || parentBody.execution?.startedAt || parentBody.cancellation?.status === "PENDING" || parent.pendingReplacementRequestId || parent.replacedByRequestId) throw new Error("Bản hiện hành đã ký, đã thực hiện hoặc đang có xử lý vòng đời khác. Liên hệ Quản lý.");
      }
      const replacementTargetId = parent?.state === "APPROVED" ? parent.id : parent?.replacesRequestId ?? null;
      if (replacementTargetId && parent?.state !== "APPROVED") {
        const target = await tx.workflowRequest.findFirst({ where: { id: replacementTargetId, module: "WORKFLOW", state: "APPROVED", pendingReplacementRequestId: null, replacedByRequestId: null } });
        const targetBody = target?.payload as unknown as DocumentPayload | undefined;
        if (!target || target.creatorId !== user.id || target.kind !== template.kind || targetBody?.signature || targetBody?.execution?.startedAt || targetBody?.cancellation?.status === "PENDING") throw new Error("Bản hiện hành của chuỗi thay thế đã đổi trạng thái. Liên hệ Quản lý.");
      }
      const amount = text(form, "amount");
      if (amount && compare(decimal(amount), decimal("0")) < 0) throw new Error("Giá trị không được âm.");
      const linkedRequestId = text(form, "linkedRequestId");
      if (linkedRequestId) {
        const linked = await tx.workflowRequest.findUnique({ where: { id: linkedRequestId } });
        if (!linked || !(documentReader(linked, user.id, admin, await member(linked.projectId)) || linked.module === "COSTFLOW" && linked.cashAssigneeId === user.id)) throw new Error("Không được đọc hồ sơ liên kết.");
      }
      const resubmission = parent ? { sourceRequestId: parent.id, sourceAttemptId: parent.currentAttemptId ?? "", response: text(form, "resubmissionResponse") } : body.resubmission;
      const payload: DocumentPayload = { content: text(form, "content"), counterparty: text(form, "counterparty"), amount, linkedRequestId, mainFileId: body.mainFileId, supportingFiles: body.supportingFiles ?? {}, ...(resubmission ? { resubmission } : {}) };
      if (!request) {
        request = await tx.workflowRequest.create({ data: { projectId, templateId: template.id, module: "WORKFLOW", kind: template.kind, title: required(text(form, "title"), "tên hồ sơ"), creatorId: user.id, cashAssigneeId: user.id, parentId: parent?.id, replacesRequestId: replacementTargetId, steps: json([]), payload: json(payload) } });
      } else await update({ projectId, templateId: template.id, kind: template.kind, title: required(text(form, "title"), "tên hồ sơ"), payload: json(payload) });
      if (upload) {
        payload.mainFileId = (await file({ requestId: request.id }, "MAIN")).id;
        await tx.workflowRequest.update({ where: { id: request.id }, data: { payload: json(payload) } });
      }
      await audit(command);
      return { success: "Đã lưu nháp và tài liệu đã chọn.", requestId: request.id };
    }
    if (!request) throw new Error("Chọn hồ sơ.");
    const submittedVersion = request.currentAttemptId
      ? (await tx.workflowApprovalEvent.findFirst({ where: { requestId: request.id, attemptId: request.currentAttemptId, action: "SUBMIT_DOCUMENT" }, select: { submittedVersion: true }, orderBy: { createdAt: "desc" } }))?.submittedVersion ?? null
      : null;
    if (["DECIDE_DOCUMENT", "TRANSFER_DOCUMENT", "REQUEST_DOCUMENT_CANCEL", "DECIDE_DOCUMENT_CANCEL"].includes(command)) assertApprovalToken(request, form, submittedVersion);
    switch (command) {
      case "SUBMIT_DOCUMENT": {
        if (request.creatorId !== user.id || request.state !== "DRAFT") throw new Error("Chỉ người lập được gửi bản nháp.");
        const template = await tx.workflowTemplate.findFirst({ where: { id: request.templateId ?? "", publishedAt: { not: null } } });
        if (!template) throw new Error("Mẫu chưa công bố.");
        if (request.parentId && !body.resubmission?.response.trim()) throw new Error("Cần một phản hồi chung cho các nội dung được yêu cầu sửa trước khi gửi lại.");
        const latest = await tx.workflowTemplate.findFirst({ where: { familyId: template.familyId, publishedAt: { not: null } }, orderBy: { version: "desc" } });
        if (latest?.id !== template.id) throw new Error("Mẫu đã có phiên bản mới. Chọn bản mới và lưu nháp trước khi gửi.");
        const requirements = effectiveRequirements(template.requirements);
        const missing = evaluateDocumentCompleteness(requirements,body);
        if (missing.length) throw new Error(`Cần bổ sung trước khi gửi: ${missing.map(m=>m.label).join(", ")}.`);
        if (!await tx.workflowFile.findFirst({ where: { id: body.mainFileId, requestId: request.id, kind: "MAIN" } })) throw new Error("Tài liệu chính không thuộc đúng hồ sơ.");
        for (const slot of requirements.requiredDocuments) if (!await tx.workflowFile.findFirst({where:{id:body.supportingFiles?.[slot.key] ?? "",requestId:request.id,kind:"SUPPORTING",supportingSlot:slot.key}})) throw new Error(`Tài liệu ${slot.label} không thuộc đúng hồ sơ/vị trí.`);
        const chain = validateSteps([{ role: "MANAGER", assigneeId: user.managerId ?? "" }, { role: "ACCOUNTANT", assigneeId: template.accountantId }, { role: "CEO", assigneeId: template.ceoId }]);
        for (const step of chain) await active(step.assigneeId);
        body.templateSnapshot = { name: template.name, version: template.version, instructions: template.instructions, signerNames: template.signerNames, fileId: template.fileId!, ownerId: template.ownerId, accountantId: template.accountantId, ceoId: template.ceoId, requirements, familyId:template.familyId,category:template.category,purpose:template.purpose,changeNote:template.changeNote };
        body.responsibleManagerId = chain[0].assigneeId;
        body.submittedFiles = {schemaVersion:1,mainFileId:body.mainFileId,supportingFiles:Object.fromEntries(requirements.requiredDocuments.map(slot=>[slot.key,body.supportingFiles![slot.key]])),referenceFileIds:(await tx.workflowFile.findMany({where:{requestId:request.id,kind:"REFERENCE"},select:{id:true}})).map(f=>f.id)};
        const attemptId = randomUUID();
        const arrivedAt = new Date();
        if (request.replacesRequestId) {
          const parent = await tx.workflowRequest.findFirst({ where: { id: request.replacesRequestId, module: "WORKFLOW", state: "APPROVED", pendingReplacementRequestId: null, replacedByRequestId: null } });
          const parentBody = parent?.payload as unknown as DocumentPayload | undefined;
          if (!parent || parentBody?.signature || parentBody?.execution?.startedAt || parentBody?.cancellation?.status === "PENDING") throw new Error("Bản hiện hành đã thay đổi. Liên hệ Quản lý trước khi gửi bản thay thế.");
          await tx.workflowRequest.update({ where: { id: parent.id }, data: { pendingReplacementRequestId: request.id, version: { increment: 1 } } });
        }
        await update({ state: "SUBMITTED", steps: json(chain), currentStep: 0, currentAttemptId: attemptId, currentStepArrivedAt: arrivedAt, payload: json(body) });
        await recordApprovalEvent(tx, { requestId: request.id, module: request.module, attemptId, submittedVersion: oldVersion + 1, mutationVersion: oldVersion + 1, stepIndex: 0, role: chain[0].role, actorId: user.id, action: "SUBMIT_DOCUMENT", recipients: [chain[0].assigneeId] });
        break;
      }
      case "DECIDE_DOCUMENT": {
        const action = text(form, "decision") as Decision;
        const corrections = correctionItems(form, action);
        const result = decide({ ...request, steps: steps! }, user.id, action, text(form, "reason"));
        if (action === "APPROVE" && steps?.[request.currentStep]?.role === "ACCOUNTANT" && text(form, "reviewConfirmed") !== "yes") throw new Error("Kế toán cần xác nhận đã kiểm tra thông tin, chứng từ và phiên bản trước khi chuyển CEO.");
        const nextStep = action === "APPROVE" && result.state === "SUBMITTED" ? result.currentStep : request.currentStep;
        const nextAssignee = action === "APPROVE" && result.state === "SUBMITTED" ? steps?.[nextStep]?.assigneeId : undefined;
        await update({ ...result, currentStepArrivedAt: action === "APPROVE" && result.state === "SUBMITTED" ? new Date() : result.state === "SUBMITTED" ? request.currentStepArrivedAt : null });
        if (request.replacesRequestId && action === "APPROVE" && result.state === "APPROVED") {
          const parent = await tx.workflowRequest.findFirst({ where: { id: request.replacesRequestId, state: "APPROVED", pendingReplacementRequestId: request.id, replacedByRequestId: null } });
          const parentBody = parent?.payload as unknown as DocumentPayload | undefined;
          if (!parent || parentBody?.signature || parentBody?.execution?.startedAt || parentBody?.cancellation?.status === "PENDING") throw new Error("Bản hiện hành đã ký, bắt đầu thực hiện hoặc đổi trạng thái. Liên hệ Quản lý.");
          await tx.workflowRequest.update({ where: { id: parent.id }, data: { pendingReplacementRequestId: null, replacedByRequestId: request.id, supersededAt: new Date(), version: { increment: 1 } } });
        } else if (request.replacesRequestId && ["RETURN", "REJECT", "WITHDRAW"].includes(action)) {
          await tx.workflowRequest.updateMany({ where: { id: request.replacesRequestId, pendingReplacementRequestId: request.id }, data: { pendingReplacementRequestId: null, version: { increment: 1 } } });
        }
        await tx.workflowDecision.create({ data: { requestId: request.id, version: oldVersion + 1, step: request.currentStep, actorId: user.id, action, reason: text(form, "reason") } });
        await recordApprovalEvent(tx, { requestId: request.id, module: request.module, attemptId: request.currentAttemptId, submittedVersion, mutationVersion: oldVersion + 1, stepIndex: request.currentStep, role: steps?.[request.currentStep]?.role ?? "CREATOR", actorId: user.id, action, reason: text(form, "reason"), details: corrections.length ? json({ correctionItems: corrections }) : undefined, recipients: nextAssignee ? [nextAssignee] : [] });
        break;
      }
      case "TRANSFER_DOCUMENT": {
        if (!admin && !steps?.some(s => s.role === "MANAGER" && s.assigneeId === user.id) && body.responsibleManagerId !== user.id) throw new Error("Chỉ Quản lý phụ trách hoặc Admin được chuyển giao.");
        required(text(form, "reason"), "lý do chuyển giao");
        const fromAssigneeId = text(form, "target") === "SIGNATURE" ? body.responsibleManagerId : steps?.[request.currentStep]?.assigneeId;
        let toAssigneeId = "";
        if (text(form, "target") === "SIGNATURE") {
          body.responsibleManagerId = await active(text(form, "assigneeId"));
          toAssigneeId = body.responsibleManagerId;
          await update({ payload: json(body) });
        } else {
          if (request.state !== "SUBMITTED" || !steps?.[request.currentStep]) throw new Error("Không có bước đang chờ để chuyển giao.");
          const role = steps[request.currentStep].role;
          const standardAssigneeId = role === "MANAGER" ? body.responsibleManagerId : role === "ACCOUNTANT" ? body.templateSnapshot?.accountantId : body.templateSnapshot?.ceoId;
          steps[request.currentStep].assigneeId = await assertEligibleApprovalReceiver(tx, { userId: text(form, "assigneeId"), role, standardAssigneeId });
          toAssigneeId = steps[request.currentStep].assigneeId;
          if (fromAssigneeId) await tx.workflowRequestReader.upsert({ where: { requestId_userId: { requestId: request.id, userId: fromAssigneeId } }, create: { requestId: request.id, userId: fromAssigneeId, reason: "TRANSFERRED_STEP" }, update: {} });
          await update({ steps: json(steps), currentStepArrivedAt: new Date(), payload: json(body) });
        }
        await tx.workflowDecision.create({ data: { requestId: request.id, version: oldVersion + 1, step: request.currentStep, actorId: user.id, action: "TRANSFER", reason: text(form, "reason") } });
        await recordApprovalEvent(tx, { requestId: request.id, module: request.module, attemptId: request.currentAttemptId, submittedVersion, mutationVersion: oldVersion + 1, stepIndex: request.currentStep, role: steps?.[request.currentStep]?.role ?? "MANAGER", actorId: user.id, action: "TRANSFER", reason: text(form, "reason"), fromAssigneeId, toAssigneeId, recipients: [toAssigneeId] });
        break;
      }
      case "ADD_SUPPORTING_DOCUMENT": {
        if (request.creatorId !== user.id || request.state !== "DRAFT") throw new Error("Chỉ người lập bổ sung tài liệu bắt buộc vào nháp.");
        const template = await tx.workflowTemplate.findUniqueOrThrow({where:{id:request.templateId!}});
        const slot = text(form,"supportingSlot");
        if (!effectiveRequirements(template.requirements).requiredDocuments.some(s=>s.key===slot)) throw new Error("Vị trí tài liệu không hợp lệ.");
        const saved = await file({requestId:request.id},"SUPPORTING",slot);
        body.supportingFiles = {...body.supportingFiles,[slot]:saved.id};
        await update({payload:json(body)}); break;
      }
      case "ADD_REFERENCE": {
        if (request.creatorId !== user.id) throw new Error("Chỉ người lập bổ sung file tham khảo.");
        await file({ requestId: request.id }, "REFERENCE"); await update({}); break;
      }
      case "UPLOAD_SIGNED": {
        if (request.creatorId !== user.id || request.state !== "APPROVED") throw new Error("Người lập chỉ tải bản ký khi hồ sơ đã duyệt.");
        assertWorkflowLifecycleAllows(request, "SIGN");
        body.signature = { state: "PENDING", keeper: required(text(form, "keeper"), "người giữ bản gốc"), location: required(text(form, "location"), "nơi lưu bản gốc"), fileId: (await file({ requestId: request.id }, "SIGNED")).id };
        await update({ payload: json(body) }); break;
      }
      case "CONFIRM_SIGNED": {
        if (request.state !== "APPROVED" || body.responsibleManagerId !== user.id || body.signature?.state !== "PENDING") throw new Error("Chỉ Quản lý phụ trách được xác nhận bộ hồ sơ đang chờ kiểm tra bản ký.");
        assertWorkflowLifecycleAllows(request, "SIGN");
        if (text(form, "signatureConfirmed") !== "yes") throw new Error("Cần xác nhận đủ chữ ký theo mẫu và thông tin lưu gốc.");
        body.signature = { ...body.signature, state: "CONFIRMED", confirmedBy: user.id, confirmedAt: new Date().toISOString() };
        await update({ payload: json(body) }); break;
      }
      case "REQUEST_DOCUMENT_CANCEL": {
        if (request.creatorId !== user.id || request.state !== "APPROVED") throw new Error("Chỉ người lập được yêu cầu hủy hồ sơ đã duyệt.");
        assertWorkflowLifecycleAllows(request, "REQUEST_CANCEL");
        const reason = required(text(form, "reason"), "lý do yêu cầu hủy");
        body.cancellation = { status: "PENDING", requestedById: user.id, requestedAt: new Date().toISOString(), reason };
        await update({ payload: json(body) });
        await recordApprovalEvent(tx, { requestId: request.id, module: request.module, attemptId: request.currentAttemptId, submittedVersion, mutationVersion: oldVersion + 1, stepIndex: request.currentStep, role: "MANAGER", actorId: user.id, action: "REQUEST_CANCEL", reason, recipients: body.responsibleManagerId ? [body.responsibleManagerId] : [] });
        break;
      }
      case "DECIDE_DOCUMENT_CANCEL": {
        if (request.state !== "APPROVED" || body.responsibleManagerId !== user.id || body.cancellation?.status !== "PENDING") throw new Error("Chỉ Quản lý phụ trách được quyết định yêu cầu hủy đang chờ.");
        const reason = required(text(form, "reason"), "lý do quyết định hủy");
        const approved = text(form, "cancelDecision") === "CONFIRM";
        body.cancellation = { ...body.cancellation, status: approved ? "CONFIRMED" : "REJECTED", decidedById: user.id, decidedAt: new Date().toISOString(), decisionReason: reason };
        await update({ state: approved ? "CANCELLED" : "APPROVED", payload: json(body) });
        await recordApprovalEvent(tx, { requestId: request.id, module: request.module, attemptId: request.currentAttemptId, submittedVersion, mutationVersion: oldVersion + 1, stepIndex: request.currentStep, role: "MANAGER", actorId: user.id, action: approved ? "CONFIRM_CANCEL" : "REJECT_CANCEL", reason, recipients: [request.creatorId] });
        break;
      }
      default: throw new Error("Thao tác Workflow không được hỗ trợ.");
    }
    await audit(command);
    return { success: "Đã lưu hồ sơ và lịch sử.", requestId: request.id };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20000 });
}
export async function downloadWorkflowFile(fileId: string, actor: Actor) {
  const user = await activeActor(actor);
  const file = await prisma.workflowFile.findUnique({ where: { id: fileId }, include: { template: true, request: true } });
  if (!file) return null;
  if (file.template) {
    if (!file.template.publishedAt && user.role !== "ADMIN" && file.template.ownerId !== user.id) return null;
  } else if (file.request) {
    const member = !!file.request.projectId && !!await prisma.projectMember.findUnique({ where: { projectId_userId: { projectId: file.request.projectId, userId: user.id } } });
    const dossierReader = !!await prisma.workflowRequestReader.findUnique({ where: { requestId_userId: { requestId: file.request.id, userId: user.id } } });
    if (!documentReader(file.request, user.id, user.role === "ADMIN", member) && !dossierReader) return null;
  } else return null;
  return { name: file.name, mimeType: file.mimeType, size: file.size, data: file.data, sha256: file.sha256 };
}
