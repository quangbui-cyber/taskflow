import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { ProjectUpload } from "@/lib/projectFiles";
import { recordApprovalEvent } from "@/lib/workflow/approvalEvents";
import { buildProjectSettlementDraft, type ProjectSettlementDraftInput, type SettlementEvidenceRef } from "./projectSettlement";

export type SettlementApprovalStep = {
  role: "MANAGER" | "ACCOUNTANT" | "CEO";
  assigneeId: string;
};

export type SettlementSourceManifest = {
  actualCosts: Array<{
    projectId: string;
    recipientKey: string;
    applicationId: string;
    versionId: string;
    approvalId: string;
  }>;
  advanceAllocations: Array<{
    projectId: string;
    recipientKey: string;
    applicationId: string;
    cashAllocationId: string;
  }>;
};

export type SettlementAxisSnapshot = {
  actualCostState: string;
  advanceRequestState: string;
  allocationState: string;
  cashRows: ReadonlyArray<Readonly<Record<string, unknown>>>;
  signingState: string;
  taskState: string;
  financialCloseState: string;
};

export type SettlementLifecycle = {
  projectId: string;
  dossierId: string;
  versionId: string;
  requestId: string;
  creatorId: string;
  version: number;
  attemptId: string;
  state: "DRAFT" | "SUBMITTED" | "RETURNED" | "APPROVED" | "CANCELLED";
  currentStep: number;
  steps: SettlementApprovalStep[];
  sourceManifest: SettlementSourceManifest;
  locks: SettlementLockDraft[];
  events: Array<{ action: string; actorId: string; reason: string; attemptId: string }>;
  priorAttempts: Array<{ attemptId: string; state: "RETURNED"; reason: string }>;
  cashWrites: readonly [];
  axisSnapshot?: SettlementAxisSnapshot;
};

export type SettlementBlocker = {
  code: "UNAPPROVED_AC" | "MISSING_RELATED_IC_AC" | "MISSING_EXPENSE_EVIDENCE" | "MISSING_DISBURSEMENT_PROOF";
  recipientKey: string;
};

export class SettlementDomainError extends Error {
  constructor(message: string, readonly codes: string[] = []) {
    super(message);
    this.name = "SettlementDomainError";
  }
}

export type SettlementLockDraft = {
  projectId: string;
  dossierVersionId: string;
  recipientKey: string;
  actualCostApplicationId: string | null;
  advanceApplicationId: string | null;
  sourceCashAllocationId: string | null;
};

const REQUIRED_ROLES = ["MANAGER", "ACCOUNTANT", "CEO"] as const;

function required(value: string, label: string) {
  const normalized = value.trim();
  if (!normalized) throw new SettlementDomainError(`Thiếu ${label}.`);
  return normalized;
}

function assertExpectedVersion(record: SettlementLifecycle, expectedVersion: number) {
  if (!Number.isSafeInteger(expectedVersion) || record.version !== expectedVersion) {
    throw new SettlementDomainError("Phiên bản hồ sơ quyết toán đã thay đổi. Tải lại trước khi thao tác.");
  }
}

function assertSteps(steps: SettlementApprovalStep[]) {
  if (steps.length !== REQUIRED_ROLES.length
    || steps.some((step, index) => step.role !== REQUIRED_ROLES[index] || !step.assigneeId.trim())) {
    throw new SettlementDomainError("Chuỗi duyệt quyết toán phải là Manager -> Accountant -> CEO và đủ người được phân công.");
  }
}

export function createSettlementLifecycle(input: {
  projectId: string;
  dossierId: string;
  versionId: string;
  requestId: string;
  creatorId: string;
  projectOwnerId: string;
  expectedVersion: number;
  steps: SettlementApprovalStep[];
  sourceManifest: SettlementSourceManifest;
  axisSnapshot?: SettlementAxisSnapshot;
}): SettlementLifecycle {
  if (input.creatorId !== input.projectOwnerId) {
    throw new SettlementDomainError("Chỉ Account phụ trách hoặc Project Owner được lập hồ sơ quyết toán.");
  }
  if (input.expectedVersion !== 0) throw new SettlementDomainError("Hồ sơ mới phải bắt đầu từ phiên bản 0.");
  assertSteps(input.steps);
  appendSettlementLocks({ projectId: input.projectId, dossierVersionId: input.versionId, sourceManifest: input.sourceManifest });
  return {
    projectId: required(input.projectId, "Project"),
    dossierId: required(input.dossierId, "dossier"),
    versionId: required(input.versionId, "phiên bản dossier"),
    requestId: required(input.requestId, "hồ sơ duyệt"),
    creatorId: input.creatorId,
    version: 0,
    attemptId: "",
    state: "DRAFT",
    currentStep: 0,
    steps: structuredClone(input.steps),
    sourceManifest: structuredClone(input.sourceManifest),
    locks: [],
    events: [],
    priorAttempts: [],
    cashWrites: [],
    axisSnapshot: input.axisSnapshot ? structuredClone(input.axisSnapshot) : undefined,
  };
}

function assertNoBlockers(blockers: SettlementBlocker[]) {
  if (!blockers.length) return;
  throw new SettlementDomainError(
    "Hồ sơ quyết toán chưa đủ điều kiện gửi.",
    blockers.map(blocker => blocker.code),
  );
}

export function submitSettlementLifecycle(
  record: SettlementLifecycle,
  input: { actorId: string; expectedVersion: number; blockers: SettlementBlocker[] },
) {
  assertExpectedVersion(record, input.expectedVersion);
  if (record.state !== "DRAFT") throw new SettlementDomainError("Chỉ hồ sơ nháp được gửi duyệt.");
  if (input.actorId !== record.creatorId) throw new SettlementDomainError("Chỉ người lập được gửi hồ sơ quyết toán.");
  assertNoBlockers(input.blockers);
  const attemptId = randomUUID();
  return {
    ...structuredClone(record),
    version: record.version + 1,
    state: "SUBMITTED" as const,
    currentStep: 0,
    attemptId,
    events: [...record.events, { action: "SUBMIT", actorId: input.actorId, reason: "", attemptId }],
    cashWrites: [] as const,
  };
}

export function decideSettlementLifecycle(
  record: SettlementLifecycle,
  input: { actorId: string; expectedVersion: number; action: "APPROVE" | "RETURN"; reason: string },
) {
  assertExpectedVersion(record, input.expectedVersion);
  if (record.state !== "SUBMITTED" || record.steps[record.currentStep]?.assigneeId !== input.actorId) {
    throw new SettlementDomainError("Bạn không được phân công xử lý bước hiện tại.");
  }
  if (input.action === "RETURN") {
    const reason = required(input.reason, "lý do trả hồ sơ");
    return {
      ...structuredClone(record),
      version: record.version + 1,
      state: "RETURNED" as const,
      events: [...record.events, { action: "RETURN", actorId: input.actorId, reason, attemptId: record.attemptId }],
      priorAttempts: [...record.priorAttempts, { attemptId: record.attemptId, state: "RETURNED" as const, reason }],
      cashWrites: [] as const,
    };
  }
  const nextStep = record.currentStep + 1;
  const approved = nextStep === record.steps.length;
  const lockResult = approved
    ? appendSettlementLocks({ projectId: record.projectId, dossierVersionId: record.versionId, sourceManifest: record.sourceManifest })
    : { locks: record.locks, cashWrites: [] as const };
  return {
    ...structuredClone(record),
    version: record.version + 1,
    state: approved ? "APPROVED" as const : "SUBMITTED" as const,
    currentStep: nextStep,
    locks: lockResult.locks,
    events: [...record.events, { action: "APPROVE", actorId: input.actorId, reason: input.reason.trim(), attemptId: record.attemptId }],
    cashWrites: [] as const,
  };
}

export function resubmitSettlementLifecycle(
  record: SettlementLifecycle,
  input: { actorId: string; expectedVersion: number; blockers: SettlementBlocker[] },
) {
  assertExpectedVersion(record, input.expectedVersion);
  if (record.state !== "RETURNED") throw new SettlementDomainError("Chỉ hồ sơ bị trả mới được gửi lại.");
  if (input.actorId !== record.creatorId) throw new SettlementDomainError("Chỉ người lập được gửi lại hồ sơ quyết toán.");
  assertNoBlockers(input.blockers);
  const attemptId = randomUUID();
  return {
    ...structuredClone(record),
    version: record.version + 1,
    state: "SUBMITTED" as const,
    currentStep: 0,
    attemptId,
    events: [...record.events, { action: "RESUBMIT", actorId: input.actorId, reason: "", attemptId }],
    cashWrites: [] as const,
  };
}

export function cancelSettlementLifecycle(
  record: SettlementLifecycle,
  input: { actorId: string; expectedVersion: number; reason: string; hasCash: boolean },
) {
  assertExpectedVersion(record, input.expectedVersion);
  const manager = record.steps.find(step => step.role === "MANAGER")?.assigneeId;
  if (input.actorId !== manager) throw new SettlementDomainError("Chỉ Manager được phân công mới được hủy hồ sơ.");
  if (record.state === "APPROVED" || record.locks.length) throw new SettlementDomainError("Hồ sơ đã có khóa quyết toán nên không thể hủy.");
  if (input.hasCash) throw new SettlementDomainError("Hồ sơ đã có giao dịch tiền thực tế nên không thể hủy tại chỗ.");
  const reason = required(input.reason, "lý do hủy");
  return {
    ...structuredClone(record),
    version: record.version + 1,
    state: "CANCELLED" as const,
    events: [...record.events, { action: "CANCEL", actorId: input.actorId, reason, attemptId: record.attemptId }],
    cashWrites: [] as const,
  };
}

export function appendSettlementLocks(input: {
  projectId: string;
  dossierVersionId: string;
  sourceManifest: SettlementSourceManifest;
}) {
  const seen = new Set<string>();
  const locks: SettlementLockDraft[] = [];
  for (const source of input.sourceManifest.actualCosts) {
    if (source.projectId !== input.projectId) throw new SettlementDomainError("Nguồn khóa AC không thuộc đúng Project.");
    const key = `AC:${required(source.applicationId, "ActualCostApplication")}`;
    if (seen.has(key)) throw new SettlementDomainError("Nguồn AC bị trùng hoặc đã khóa.");
    seen.add(key);
    locks.push({ projectId: input.projectId, dossierVersionId: input.dossierVersionId, recipientKey: source.recipientKey, actualCostApplicationId: source.applicationId, advanceApplicationId: null, sourceCashAllocationId: null });
  }
  for (const source of input.sourceManifest.advanceAllocations) {
    if (source.projectId !== input.projectId) throw new SettlementDomainError("Nguồn khóa tạm ứng không thuộc đúng Project.");
    const key = `ADVANCE:${required(source.applicationId, "AdvanceApplication")}`;
    if (seen.has(key)) throw new SettlementDomainError("Nguồn tạm ứng bị trùng hoặc đã khóa.");
    seen.add(key);
    locks.push({ projectId: input.projectId, dossierVersionId: input.dossierVersionId, recipientKey: source.recipientKey, actualCostApplicationId: null, advanceApplicationId: source.applicationId, sourceCashAllocationId: required(source.cashAllocationId, "cash allocation") });
  }
  return { locks, cashWrites: [] as const };
}

type SettlementEvidenceMime = "application/pdf" | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" | "image/jpeg" | "image/png";

const EVIDENCE_MIME = new Map<SettlementEvidenceMime, { extensions: readonly string[]; magic: readonly (readonly number[])[] }>([
  ["application/pdf", { extensions: [".pdf"], magic: [[0x25, 0x50, 0x44, 0x46]] }],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", { extensions: [".xlsx"], magic: [[0x50, 0x4b, 0x03, 0x04], [0x50, 0x4b, 0x05, 0x06]] }],
  ["image/jpeg", { extensions: [".jpg", ".jpeg"], magic: [[0xff, 0xd8, 0xff]] }],
  ["image/png", { extensions: [".png"], magic: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]] }],
] as const);

function fileExtension(name: string) {
  const index = name.lastIndexOf(".");
  return index < 0 ? "" : name.slice(index).toLowerCase();
}

function hasMagic(data: Uint8Array, signatures: readonly (readonly number[])[]) {
  return signatures.some(signature => signature.every((byte, index) => data[index] === byte));
}

export function prepareSettlementEvidence(input: {
  projectId: string;
  dossierVersionId: string;
  actorId: string;
  name: string;
  mimeType: string;
  data: Uint8Array<ArrayBuffer>;
}) {
  const rule = EVIDENCE_MIME.get(input.mimeType as SettlementEvidenceMime);
  const extension = fileExtension(input.name);
  if (!rule || !rule.extensions.includes(extension as never) || !hasMagic(input.data, rule.magic)) {
    throw new SettlementDomainError("Tên, MIME và nội dung magic bytes của chứng từ không cùng định dạng PDF/XLSX/JPG/PNG.");
  }
  if (!input.data.byteLength || input.data.byteLength > 4 * 1024 * 1024) {
    throw new SettlementDomainError("Chứng từ quyết toán phải có dữ liệu và không vượt quá 4 MB.");
  }
  return {
    projectId: required(input.projectId, "Project"),
    dossierVersionId: required(input.dossierVersionId, "phiên bản dossier"),
    addedById: required(input.actorId, "người tải"),
    name: required(input.name, "tên chứng từ"),
    mimeType: input.mimeType,
    size: input.data.byteLength,
    sha256: createHash("sha256").update(input.data).digest("hex"),
    data: input.data,
  };
}

export function assertSettlementEvidenceProject(input: {
  dossierProjectId: string;
  evidenceProjectId: string;
  dossierVersionId: string;
  evidenceVersionId: string;
}) {
  if (input.dossierProjectId !== input.evidenceProjectId || input.dossierVersionId !== input.evidenceVersionId) {
    throw new SettlementDomainError("Chứng từ không thuộc đúng Project và phiên bản hồ sơ quyết toán.");
  }
}

export function assertSettlementReplacementAllowed(input: {
  oldVersionId: string;
  newVersionId: string;
  actorId: string;
  reason: string;
  changesPaidOrLockedValues: boolean;
}) {
  if (input.changesPaidOrLockedValues) {
    throw new SettlementDomainError("Chưa có thẩm quyền Adjustment Settlement để đổi giá trị đã chi hoặc đã khóa.");
  }
  return {
    supersedesId: required(input.oldVersionId, "phiên bản bị thay"),
    replacedById: required(input.newVersionId, "phiên bản thay thế"),
    replacementActorId: required(input.actorId, "người thay thế"),
    replacementReason: required(input.reason, "lý do thay thế"),
  };
}

type SettlementActor = { id: string; role: string };

type StoredSettlementPayload = {
  dossierId: string;
  dossierVersionId: string;
  sourceManifest: SettlementSourceManifest;
  projectionHash: string;
  submitBlockers: SettlementBlocker[];
};

const SETTLEMENT_COMMANDS = new Set([
  "CREATE_SETTLEMENT_DOSSIER",
  "SUBMIT_SETTLEMENT_DOSSIER",
  "DECIDE_SETTLEMENT_DOSSIER",
  "RESUBMIT_SETTLEMENT_DOSSIER",
  "ADD_SETTLEMENT_EVIDENCE",
  "CANCEL_SETTLEMENT_DOSSIER",
  "REPLACE_SETTLEMENT_DOSSIER",
]);

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

function formText(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

function canonicalHash(value: unknown) {
  const stable = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(stable);
    if (input && typeof input === "object") return Object.fromEntries(
      Object.entries(input as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stable(child)]),
    );
    return input;
  };
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function storedPayload(value: Prisma.JsonValue): StoredSettlementPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SettlementDomainError("Payload hồ sơ quyết toán không hợp lệ.");
  const settlement = (value as Record<string, unknown>).settlement;
  if (!settlement || typeof settlement !== "object" || Array.isArray(settlement)) throw new SettlementDomainError("Thiếu snapshot quyết toán phía server.");
  return settlement as unknown as StoredSettlementPayload;
}

function evidenceRequirements(kind: string): SettlementEvidenceRef["satisfies"] {
  if (["PAYMENT_PROOF", "BANK_RECEIPT", "CASH_RECEIPT"].includes(kind)) return ["DISBURSEMENT_PROOF"];
  if (["VAT_INVOICE", "INVOICE", "ACCEPTANCE_HANDOVER", "FIELD_PHOTO_REPORT"].includes(kind)) return ["EXPENSE_EVIDENCE"];
  if (kind === "RELATED_IC_AC") return ["RELATED_IC_AC"];
  return [];
}

async function projectApprovalSteps(tx: Prisma.TransactionClient, projectId: string) {
  const project = await tx.project.findUnique({
    where: { id: projectId },
    select: {
      ownerId: true,
      owner: { select: { managerId: true } },
      costFlow: { select: { data: true } },
    },
  });
  if (!project) throw new SettlementDomainError("Project không tồn tại.");
  const workspace = project.costFlow?.data && typeof project.costFlow.data === "object" && !Array.isArray(project.costFlow.data)
    ? project.costFlow.data as Record<string, unknown>
    : {};
  const config = workspace.config && typeof workspace.config === "object" && !Array.isArray(workspace.config)
    ? workspace.config as Record<string, unknown>
    : {};
  const steps: SettlementApprovalStep[] = [
    { role: "MANAGER", assigneeId: String(project.owner.managerId ?? "") },
    { role: "ACCOUNTANT", assigneeId: String(config.accountantId ?? "") },
    { role: "CEO", assigneeId: String(config.ceoId ?? "") },
  ];
  assertSteps(steps);
  return { project, steps };
}

async function assertActiveActor(tx: Prisma.TransactionClient, actor: SettlementActor) {
  const active = await tx.user.findFirst({ where: { id: actor.id, isActive: true }, select: { id: true, role: true } });
  if (!active) throw new SettlementDomainError("Tài khoản không còn hoạt động.");
  return active;
}

type ProjectionSources = {
  draftInput: ProjectSettlementDraftInput;
  manifest: SettlementSourceManifest;
  actualApplications: Array<{ id: string; recipientKey: string; versionId: string; approvalId: string }>;
  advanceApplications: Array<{ id: string; recipientKey: string; cashAllocationId: string }>;
};

async function deriveSourcesForCreate(tx: Prisma.TransactionClient, projectId: string, requestId: string, actorId: string): Promise<ProjectionSources> {
  const lines = await tx.actualCostLine.findMany({
    where: { projectId },
    include: {
      versions: { orderBy: { version: "desc" }, take: 1, include: { approvals: true, evidenceLinks: { include: { evidence: true } } } },
    },
    orderBy: { stableLineId: "asc" },
  });
  const actualCostLines: ProjectSettlementDraftInput["actualCostLines"] = [];
  const actualApplications: ProjectionSources["actualApplications"] = [];
  for (const line of lines) {
    const version = line.versions[0];
    const approval = version?.approvals[0];
    if (!version) continue;
    const approved = version.version === line.currentVersion && version.state === "APPROVED" && approval?.action === "APPROVED";
    actualCostLines.push({
      projectId,
      recipientKey: line.recipientKey,
      recipientType: line.recipientKey.startsWith("VENDOR:") ? "VENDOR" : "EMPLOYEE",
      recipientName: line.recipientKey,
      stableLineId: line.stableLineId,
      versionId: version.id,
      approvalEventId: approved ? approval.id : null,
      approvalAttemptId: approved ? approval.attemptId : null,
      currentApprovalTuple: approved ? { versionId: version.id, approvalEventId: approval.id, approvalAttemptId: approval.attemptId } : null,
      approvalState: approved ? "APPROVED" : version.state === "RETURNED" ? "RETURNED" : "PENDING",
      rawGross: version.rawAmount,
      relatedIcAcReferences: line.icLineId ? [{ id: line.icLineId, kind: "IC_LINE" }] : [],
      evidence: version.evidenceLinks.flatMap(link => {
        const satisfies = evidenceRequirements(link.kind);
        return satisfies.length ? [{ id: link.evidence.id, sha256: link.evidence.sha256, origin: "INHERITED" as const, satisfies }] : [];
      }),
    });
    if (approved) {
      const application = await tx.actualCostApplication.create({
        data: { projectId, lineId: line.id, versionId: version.id, approvalId: approval.id, requestId, recipientKey: line.recipientKey, amount: version.amount, createdById: actorId },
        select: { id: true, recipientKey: true },
      });
      actualApplications.push({ ...application, versionId: version.id, approvalId: approval.id });
    }
  }

  const allocations = await tx.costFlowCashAllocation.findMany({
    where: { projectId, direction: "OUT" },
    include: { cash: true, requestLine: { include: { advanceApplications: true } } },
    orderBy: { createdAt: "asc" },
  });
  const evidenceIds = [...new Set(allocations.map(item => item.cash.evidenceId))];
  const cashEvidence = await tx.costFlowEvidence.findMany({ where: { projectId, id: { in: evidenceIds } }, select: { id: true, sha256: true } });
  const evidenceById = new Map(cashEvidence.map(item => [item.id, item]));
  const advanceAllocations: ProjectSettlementDraftInput["advanceAllocations"] = [];
  const advanceApplications: ProjectionSources["advanceApplications"] = [];
  const seenAdvanceApplications = new Set<string>();
  for (const allocation of allocations) {
    const application = allocation.requestLine.advanceApplications.find(item => item.projectId === projectId && item.recipientKey === allocation.recipientKey);
    if (!application || seenAdvanceApplications.has(application.id)) continue;
    seenAdvanceApplications.add(application.id);
    const evidence = evidenceById.get(allocation.cash.evidenceId);
    advanceAllocations.push({
      projectId,
      recipientKey: allocation.recipientKey,
      recipientType: allocation.recipientKey.startsWith("VENDOR:") ? "VENDOR" : "EMPLOYEE",
      recipientName: allocation.recipientKey,
      advanceRequestId: application.advanceRequestId,
      advanceLineId: application.advanceLineId,
      cashId: allocation.cashId,
      allocationId: allocation.id,
      direction: "OUT",
      cashState: "CONFIRMED",
      rawGross: allocation.amount,
      evidence: evidence ? [{ id: evidence.id, sha256: evidence.sha256, origin: "INHERITED", satisfies: ["DISBURSEMENT_PROOF"] }] : [],
    });
    advanceApplications.push({ id: application.id, recipientKey: application.recipientKey, cashAllocationId: allocation.id });
  }
  return {
    draftInput: { projectId, actualCostLines, advanceAllocations },
    manifest: {
      actualCosts: actualApplications.map(application => ({
        projectId,
        recipientKey: application.recipientKey,
        applicationId: application.id,
        versionId: application.versionId,
        approvalId: application.approvalId,
      })),
      advanceAllocations: advanceApplications.map(application => ({ projectId, recipientKey: application.recipientKey, applicationId: application.id, cashAllocationId: application.cashAllocationId })),
    },
    actualApplications,
    advanceApplications,
  };
}

async function supplementalEvidence(tx: Prisma.TransactionClient, projectId: string, dossierVersionId: string) {
  const rows = await tx.settlementEvidence.findMany({ where: { projectId, dossierVersionId, kind: { contains: ":" } }, include: { evidence: true } });
  return rows.flatMap(row => {
    const satisfies = evidenceRequirements(row.kind);
    return satisfies.length ? [{ id: row.evidenceId, sha256: row.sha256, recipientKey: row.kind.split(":", 2)[1], origin: "SUPPLEMENTAL" as const, satisfies }] : [];
  });
}

function blockersFromProjection(projection: ReturnType<typeof buildProjectSettlementDraft>): SettlementBlocker[] {
  return projection.submitBlockers.map(blocker => ({ code: blocker.code, recipientKey: blocker.recipientKey }));
}

export function isSettlementCommand(value: string) {
  return SETTLEMENT_COMMANDS.has(value);
}

export async function executeSettlementCommand(actor: SettlementActor, form: FormData, upload: ProjectUpload | null) {
  const command = formText(form, "command");
  const projectId = required(formText(form, "projectId"), "Project");
  const expectedVersion = Number(form.get("settlementVersion"));
  if (!isSettlementCommand(command) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
    throw new SettlementDomainError("Lệnh hoặc phiên bản hồ sơ quyết toán không hợp lệ.");
  }
  return prisma.$transaction(async tx => {
    await assertActiveActor(tx, actor);
    const { project, steps } = await projectApprovalSteps(tx, projectId);

    if (command === "CREATE_SETTLEMENT_DOSSIER") {
      if (actor.id !== project.ownerId) throw new SettlementDomainError("Chỉ Account phụ trách hoặc Project Owner được lập hồ sơ quyết toán.");
      if (expectedVersion !== 0) throw new SettlementDomainError("Hồ sơ mới phải bắt đầu từ phiên bản 0.");
      if (await tx.projectSettlementDossier.findUnique({ where: { projectId } })) throw new SettlementDomainError("Project đã có hồ sơ quyết toán tổng hợp.");
      const request = await tx.workflowRequest.create({ data: { projectId, module: "COSTFLOW", kind: "SETTLEMENT", title: formText(form, "title") || "Hồ sơ quyết toán tổng hợp", creatorId: actor.id, cashAssigneeId: actor.id, state: "DRAFT", steps: json(steps), payload: json({}) } });
      const dossier = await tx.projectSettlementDossier.create({ data: { projectId, createdById: actor.id } });
      const sources = await deriveSourcesForCreate(tx, projectId, request.id, actor.id);
      const projection = buildProjectSettlementDraft(sources.draftInput);
      const projectionHash = canonicalHash(projection);
      const version = await tx.projectSettlementVersion.create({ data: { projectId, dossierId: dossier.id, requestId: request.id, version: 1, attemptId: randomUUID(), canonicalHash: projectionHash, createdById: actor.id } });
      for (const row of projection.recipients) await tx.settlementRecipientObligation.create({ data: { projectId, dossierVersionId: version.id, recipientKey: row.recipientKey, recipientType: row.recipientType, direction: row.refundDue !== "0" ? "REFUND" : row.additionalDue !== "0" ? "ADDITIONAL" : "BALANCED", approvedAcGross: row.actualGross, disbursedAdvance: row.advanceGross, amountDue: row.refundDue !== "0" ? row.refundDue : row.additionalDue } });
      const inheritedEvidence = new Map(projection.recipients.flatMap(row => row.evidenceManifest.map(evidence => [evidence.id, evidence] as const)));
      for (const evidence of inheritedEvidence.values()) await tx.settlementEvidence.create({ data: { projectId, dossierVersionId: version.id, evidenceId: evidence.id, kind: evidence.satisfies.join("+"), sha256: evidence.sha256, addedById: actor.id } });
      const payload: StoredSettlementPayload = { dossierId: dossier.id, dossierVersionId: version.id, sourceManifest: sources.manifest, projectionHash, submitBlockers: blockersFromProjection(projection) };
      await tx.workflowRequest.update({ where: { id: request.id }, data: { payload: json({ settlement: payload }) } });
      return { success: "Đã tạo hồ sơ quyết toán nháp từ nguồn phía server.", requestId: request.id, settlementVersion: 0 };
    }

    const requestId = required(formText(form, "requestId"), "hồ sơ quyết toán");
    const request = await tx.workflowRequest.findFirst({ where: { id: requestId, projectId, module: "COSTFLOW", kind: "SETTLEMENT" } });
    if (!request) throw new SettlementDomainError("Không tìm thấy hồ sơ quyết toán trong Project.");
    if (request.version !== expectedVersion) throw new SettlementDomainError("Phiên bản hồ sơ quyết toán đã thay đổi. Tải lại trước khi thao tác.");
    const payload = storedPayload(request.payload);
    const dossierVersion = await tx.projectSettlementVersion.findFirstOrThrow({ where: { id: payload.dossierVersionId, projectId, requestId: request.id } });

    if (command === "ADD_SETTLEMENT_EVIDENCE") {
      if (request.state !== "DRAFT" && request.state !== "RETURNED") throw new SettlementDomainError("Chỉ bổ sung chứng từ khi hồ sơ đang nháp hoặc bị trả.");
      if (actor.id !== request.creatorId) throw new SettlementDomainError("Chỉ người lập được bổ sung chứng từ quyết toán.");
      if (!upload) throw new SettlementDomainError("Chọn chứng từ PDF/XLSX/JPG/PNG cần bổ sung.");
      const prepared = prepareSettlementEvidence({ projectId, dossierVersionId: dossierVersion.id, actorId: actor.id, name: upload.name, mimeType: upload.mimeType, data: upload.data });
      const recipientKey = required(formText(form, "recipientKey"), "người nhận của chứng từ");
      if (!await tx.settlementRecipientObligation.findFirst({ where: { dossierVersionId: dossierVersion.id, projectId, recipientKey } })) throw new SettlementDomainError("Chứng từ không thuộc người nhận trong phiên bản quyết toán.");
      const kind = required(formText(form, "evidenceKind"), "loại chứng từ");
      if (!evidenceRequirements(kind).length) throw new SettlementDomainError("Loại chứng từ quyết toán không hợp lệ.");
      const evidence = await tx.costFlowEvidence.create({ data: { projectId, requestId: request.id, sourceFileId: `settlement:${randomUUID()}`, kind, name: prepared.name, mimeType: prepared.mimeType, data: prepared.data, sha256: prepared.sha256, createdBy: actor.id } });
      await tx.settlementEvidence.create({ data: { projectId, dossierVersionId: dossierVersion.id, evidenceId: evidence.id, kind: `${kind}:${recipientKey}`, sha256: evidence.sha256, addedById: actor.id } });
      const updated = await tx.workflowRequest.updateMany({ where: { id: request.id, version: expectedVersion }, data: { version: { increment: 1 } } });
      if (updated.count !== 1) throw new SettlementDomainError("Hồ sơ đã thay đổi khi bổ sung chứng từ.");
      return { success: "Đã lưu chứng từ bổ sung và hash theo đúng phiên bản hồ sơ.", requestId: request.id, settlementVersion: expectedVersion + 1 };
    }

    const cashCount = await tx.settlementCashAllocation.count({ where: { projectId, obligation: { dossierVersionId: dossierVersion.id } } });
    const lockCount = await tx.settlementLock.count({ where: { projectId, dossierVersionId: dossierVersion.id } });

    if (command === "CANCEL_SETTLEMENT_DOSSIER") {
      const lifecycle = lifecycleFromRequest(request, payload, steps, lockCount);
      const next = cancelSettlementLifecycle(lifecycle, { actorId: actor.id, expectedVersion, reason: formText(form, "reason"), hasCash: cashCount > 0 });
      if ((await tx.workflowRequest.updateMany({ where: { id: request.id, version: expectedVersion }, data: { state: next.state, version: { increment: 1 } } })).count !== 1) throw new SettlementDomainError("Hồ sơ đã thay đổi khi hủy.");
      await recordApprovalEvent(tx, { requestId: request.id, module: request.module, attemptId: request.currentAttemptId, mutationVersion: expectedVersion + 1, stepIndex: request.currentStep, role: "MANAGER", actorId: actor.id, action: "CANCEL", reason: formText(form, "reason") });
      return { success: "Đã hủy hồ sơ bằng sự kiện bất biến; không xóa dữ liệu.", requestId: request.id, settlementVersion: expectedVersion + 1 };
    }

    if (command === "REPLACE_SETTLEMENT_DOSSIER") {
      if (actor.id !== request.creatorId) throw new SettlementDomainError("Chỉ người lập được tạo phiên bản thay thế.");
      const lineage = assertSettlementReplacementAllowed({ oldVersionId: dossierVersion.id, newVersionId: randomUUID(), actorId: actor.id, reason: formText(form, "reason"), changesPaidOrLockedValues: formText(form, "changesPaidOrLockedValues") === "yes" });
      const nextVersion = await tx.projectSettlementVersion.create({ data: { id: lineage.replacedById, projectId, dossierId: dossierVersion.dossierId, requestId: request.id, version: dossierVersion.version + 1, attemptId: randomUUID(), canonicalHash: dossierVersion.canonicalHash, createdById: actor.id, supersedesId: dossierVersion.id, replacementReason: lineage.replacementReason, replacementActorId: actor.id, replacedAt: new Date() } });
      await copySettlementVersion(tx, dossierVersion.id, nextVersion.id, projectId, actor.id);
      const nextPayload = { ...payload, dossierVersionId: nextVersion.id };
      if ((await tx.workflowRequest.updateMany({ where: { id: request.id, version: expectedVersion }, data: { state: "DRAFT", currentStep: 0, currentAttemptId: null, payload: json({ settlement: nextPayload }), version: { increment: 1 } } })).count !== 1) throw new SettlementDomainError("Hồ sơ đã thay đổi khi tạo bản thay thế.");
      return { success: "Đã tạo phiên bản thay thế có liên kết hai chiều, giữ nguyên lịch sử cũ.", requestId: request.id, settlementVersion: expectedVersion + 1 };
    }

    const supplemental = await supplementalEvidence(tx, projectId, dossierVersion.id);
    const sourceProjection = await projectionFromStoredSources(tx, projectId, request.id, payload.sourceManifest, supplemental);
    const projection = buildProjectSettlementDraft(sourceProjection);
    if (canonicalHash({ ...projection, submitBlockers: undefined, canSubmit: undefined }) !== canonicalHash({ ...projection, submitBlockers: undefined, canSubmit: undefined })) throw new SettlementDomainError("Projection quyết toán không ổn định.");
    const blockers = blockersFromProjection(projection);
    const lifecycle = lifecycleFromRequest(request, payload, steps, lockCount);

    if (command === "SUBMIT_SETTLEMENT_DOSSIER" || command === "RESUBMIT_SETTLEMENT_DOSSIER") {
      const next = command === "SUBMIT_SETTLEMENT_DOSSIER"
        ? submitSettlementLifecycle(lifecycle, { actorId: actor.id, expectedVersion, blockers })
        : resubmitSettlementLifecycle(lifecycle, { actorId: actor.id, expectedVersion, blockers });
      let submittedVersionId = dossierVersion.id;
      if (command === "RESUBMIT_SETTLEMENT_DOSSIER") {
        const response = required(formText(form, "reason"), "phản hồi sửa hồ sơ");
        const immutableVersion = await tx.projectSettlementVersion.create({ data: { projectId, dossierId: dossierVersion.dossierId, requestId: request.id, version: dossierVersion.version + 1, attemptId: next.attemptId, canonicalHash: canonicalHash(projection), createdById: actor.id, supersedesId: dossierVersion.id, replacementReason: response, replacementActorId: actor.id, replacedAt: new Date() } });
        await copySettlementVersion(tx, dossierVersion.id, immutableVersion.id, projectId, actor.id);
        submittedVersionId = immutableVersion.id;
      }
      const submittedPayload = { ...payload, dossierVersionId: submittedVersionId, projectionHash: canonicalHash(projection), submitBlockers: [] };
      if ((await tx.workflowRequest.updateMany({ where: { id: request.id, version: expectedVersion }, data: { state: next.state, currentStep: 0, currentAttemptId: next.attemptId, currentStepArrivedAt: new Date(), payload: json({ settlement: submittedPayload }), version: { increment: 1 } } })).count !== 1) throw new SettlementDomainError("Hồ sơ đã thay đổi khi gửi duyệt.");
      await recordApprovalEvent(tx, { requestId: request.id, module: request.module, attemptId: next.attemptId, submittedVersion: expectedVersion + 1, mutationVersion: expectedVersion + 1, stepIndex: 0, role: "MANAGER", actorId: actor.id, action: command === "SUBMIT_SETTLEMENT_DOSSIER" ? "SUBMIT" : "RESUBMIT", recipients: [steps[0].assigneeId] });
      return { success: "Đã gửi hồ sơ quyết toán theo snapshot nguồn phía server.", requestId: request.id, settlementVersion: expectedVersion + 1 };
    }

    if (command === "DECIDE_SETTLEMENT_DOSSIER") {
      const action = formText(form, "decision");
      if (action !== "APPROVE" && action !== "RETURN") throw new SettlementDomainError("Quyết định quyết toán không hợp lệ.");
      const next = decideSettlementLifecycle(lifecycle, { actorId: actor.id, expectedVersion, action, reason: formText(form, "reason") });
      if (next.state === "APPROVED") await persistSettlementLocks(tx, dossierVersion.id, projectId, payload.sourceManifest);
      if ((await tx.workflowRequest.updateMany({ where: { id: request.id, version: expectedVersion, state: "SUBMITTED", currentStep: request.currentStep }, data: { state: next.state, currentStep: next.currentStep, currentStepArrivedAt: next.state === "SUBMITTED" ? new Date() : null, version: { increment: 1 } } })).count !== 1) throw new SettlementDomainError("Bước duyệt đã thay đổi. Tải lại trước khi quyết định.");
      const nextAssignee = next.state === "SUBMITTED" ? steps[next.currentStep]?.assigneeId : undefined;
      await recordApprovalEvent(tx, { requestId: request.id, module: request.module, attemptId: request.currentAttemptId, submittedVersion: expectedVersion, mutationVersion: expectedVersion + 1, stepIndex: request.currentStep, role: steps[request.currentStep].role, actorId: actor.id, action, reason: formText(form, "reason"), recipients: nextAssignee ? [nextAssignee] : [request.creatorId] });
      return { success: next.state === "APPROVED" ? "CEO đã duyệt và hệ thống đã thêm khóa nguồn bất biến." : action === "RETURN" ? "Đã trả toàn bộ hồ sơ để sửa." : "Đã chuyển hồ sơ sang bước duyệt kế tiếp.", requestId: request.id, settlementVersion: expectedVersion + 1 };
    }
    throw new SettlementDomainError("Thao tác quyết toán không hợp lệ.");
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 });
}

function lifecycleFromRequest(request: { id: string; projectId: string | null; creatorId: string; version: number; state: string; currentStep: number; currentAttemptId: string | null }, payload: StoredSettlementPayload, steps: SettlementApprovalStep[], lockCount: number): SettlementLifecycle {
  if (!request.projectId) throw new SettlementDomainError("Hồ sơ quyết toán thiếu Project.");
  if (!["DRAFT", "SUBMITTED", "RETURNED", "APPROVED", "CANCELLED"].includes(request.state)) throw new SettlementDomainError("Trạng thái hồ sơ quyết toán không hợp lệ.");
  return {
    projectId: request.projectId,
    dossierId: payload.dossierId,
    versionId: payload.dossierVersionId,
    requestId: request.id,
    creatorId: request.creatorId,
    version: request.version,
    attemptId: request.currentAttemptId ?? "",
    state: request.state as SettlementLifecycle["state"],
    currentStep: request.currentStep,
    steps,
    sourceManifest: payload.sourceManifest,
    locks: lockCount ? appendSettlementLocks({ projectId: request.projectId, dossierVersionId: payload.dossierVersionId, sourceManifest: payload.sourceManifest }).locks : [],
    events: [],
    priorAttempts: [],
    cashWrites: [],
  };
}

async function projectionFromStoredSources(tx: Prisma.TransactionClient, projectId: string, requestId: string, manifest: SettlementSourceManifest, supplemental: SettlementEvidenceRef[]): Promise<ProjectSettlementDraftInput> {
  const applications = await tx.actualCostApplication.findMany({ where: { projectId, requestId, id: { in: manifest.actualCosts.map(item => item.applicationId) } }, include: { line: true, version: { include: { evidenceLinks: { include: { evidence: true } } } }, approval: true } });
  if (applications.length !== manifest.actualCosts.length) throw new SettlementDomainError("Nguồn AC của snapshot không còn đầy đủ.");
  const actualCostLines = applications.map(application => {
    const source = manifest.actualCosts.find(item => item.applicationId === application.id)!;
    if (application.line.currentVersion !== application.version.version || application.versionId !== source.versionId || application.approvalId !== source.approvalId || application.approval.action !== "APPROVED") throw new SettlementDomainError("Producer tuple AC đã stale hoặc không khớp snapshot.");
    return { projectId, recipientKey: application.recipientKey, recipientType: application.recipientKey.startsWith("VENDOR:") ? "VENDOR" as const : "EMPLOYEE" as const, recipientName: application.recipientKey, stableLineId: application.line.stableLineId, versionId: application.versionId, approvalEventId: application.approvalId, approvalAttemptId: application.approval.attemptId, currentApprovalTuple: { versionId: application.versionId, approvalEventId: application.approvalId, approvalAttemptId: application.approval.attemptId }, approvalState: "APPROVED" as const, rawGross: application.version.rawAmount, relatedIcAcReferences: application.line.icLineId ? [{ id: application.line.icLineId, kind: "IC_LINE" as const }] : [], evidence: application.version.evidenceLinks.flatMap(link => { const satisfies = evidenceRequirements(link.kind); return satisfies.length ? [{ id: link.evidence.id, sha256: link.evidence.sha256, origin: "INHERITED" as const, satisfies }] : []; }) };
  });
  const allocations = await tx.costFlowCashAllocation.findMany({ where: { projectId, id: { in: manifest.advanceAllocations.map(item => item.cashAllocationId) } }, include: { cash: true, requestLine: { include: { advanceApplications: true } } } });
  if (allocations.length !== manifest.advanceAllocations.length) throw new SettlementDomainError("Nguồn tạm ứng của snapshot không còn đầy đủ.");
  const evidenceRows = await tx.costFlowEvidence.findMany({ where: { projectId, id: { in: allocations.map(item => item.cash.evidenceId) } }, select: { id: true, sha256: true } });
  const evidenceById = new Map(evidenceRows.map(item => [item.id, item]));
  const advanceAllocations = allocations.map(allocation => {
    const source = manifest.advanceAllocations.find(item => item.cashAllocationId === allocation.id)!;
    const application = allocation.requestLine.advanceApplications.find(item => item.id === source.applicationId && item.recipientKey === allocation.recipientKey);
    if (!application || allocation.direction !== "OUT") throw new SettlementDomainError("Nguồn tạm ứng không khớp application và recipient snapshot.");
    const evidence = evidenceById.get(allocation.cash.evidenceId);
    return { projectId, recipientKey: allocation.recipientKey, recipientType: allocation.recipientKey.startsWith("VENDOR:") ? "VENDOR" as const : "EMPLOYEE" as const, recipientName: allocation.recipientKey, advanceRequestId: application.advanceRequestId, advanceLineId: application.advanceLineId, cashId: allocation.cashId, allocationId: allocation.id, direction: "OUT" as const, cashState: "CONFIRMED" as const, rawGross: allocation.amount, evidence: evidence ? [{ id: evidence.id, sha256: evidence.sha256, origin: "INHERITED" as const, satisfies: ["DISBURSEMENT_PROOF" as const] }] : [] };
  });
  return { projectId, actualCostLines, advanceAllocations, supplementalEvidence: supplemental };
}

async function persistSettlementLocks(tx: Prisma.TransactionClient, dossierVersionId: string, projectId: string, manifest: SettlementSourceManifest) {
  const obligations = await tx.settlementRecipientObligation.findMany({ where: { projectId, dossierVersionId } });
  const drafts = appendSettlementLocks({ projectId, dossierVersionId, sourceManifest: manifest }).locks;
  if (await tx.settlementLock.count({ where: { projectId, OR: [{ actualCostApplicationId: { in: drafts.flatMap(item => item.actualCostApplicationId ? [item.actualCostApplicationId] : []) } }, { advanceApplicationId: { in: drafts.flatMap(item => item.advanceApplicationId ? [item.advanceApplicationId] : []) } }] } })) throw new SettlementDomainError("Nguồn AC hoặc tạm ứng đã được khóa bởi hồ sơ quyết toán khác.");
  for (const draft of drafts) {
    const obligation = obligations.find(item => item.recipientKey === draft.recipientKey);
    if (!obligation) throw new SettlementDomainError("Thiếu nghĩa vụ quyết toán cho nguồn cần khóa.");
    await tx.settlementLock.create({ data: { projectId, dossierVersionId, obligationId: obligation.id, recipientKey: draft.recipientKey, actualCostApplicationId: draft.actualCostApplicationId, advanceApplicationId: draft.advanceApplicationId, sourceCashAllocationId: draft.sourceCashAllocationId } });
  }
}

async function copySettlementVersion(tx: Prisma.TransactionClient, oldVersionId: string, newVersionId: string, projectId: string, actorId: string) {
  const [obligations, evidence] = await Promise.all([
    tx.settlementRecipientObligation.findMany({ where: { projectId, dossierVersionId: oldVersionId } }),
    tx.settlementEvidence.findMany({ where: { projectId, dossierVersionId: oldVersionId } }),
  ]);
  for (const item of obligations) await tx.settlementRecipientObligation.create({ data: { projectId, dossierVersionId: newVersionId, recipientKey: item.recipientKey, recipientType: item.recipientType, direction: item.direction, approvedAcGross: item.approvedAcGross, disbursedAdvance: item.disbursedAdvance, amountDue: item.amountDue } });
  for (const item of evidence) await tx.settlementEvidence.create({ data: { projectId, dossierVersionId: newVersionId, evidenceId: item.evidenceId, kind: item.kind, sha256: item.sha256, addedById: actorId } });
}
