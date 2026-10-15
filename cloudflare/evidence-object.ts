import { neon, Pool, type PoolClient } from "@neondatabase/serverless";
import { jwtVerify } from "jose";
import { emptyFinance, type FinanceData } from "../lib/costflow/types";
import { hydrateLinePricingData } from "../lib/costflow/pairedDraft";
import { applyPairedCommand, type PairedPersistence } from "../lib/costflow/pairedService";
import { persistExportSourceSeal, type BuiltExportSourceSeal, type ExportSourceSealInput } from "../lib/costflow/exportSourceProjection";
import { deliverWorkflowNotifications, type WorkflowNotificationDeliveryStore } from "../lib/workflow/notificationDelivery";
import { selectPairedWorkspace, type PairedRouteParams } from "../lib/costflow/pairedReadModel";
import { evidencePath, pairedDataPath, pairedSavePath } from "./free-router";

type EvidenceObjectEnv = {
  DATABASE_URL: string;
  SESSION_SECRET: string;
};

type Session = { userId: string; sessionVersion: number };
type EvidenceRecord = {
  id: string;
  name: string;
  mimeType: string;
  data: Uint8Array;
};

type EvidenceAccessRow = EvidenceRecord & {
  role: string;
  member: boolean;
  dd: boolean;
  creatorId: string | null;
  cashAssigneeId: string | null;
  reader: boolean;
  steps: unknown;
};

export type EvidenceGateway = {
  findAuthorizedEvidence(projectId: string, evidenceId: string, session: Session): Promise<EvidenceRecord | null>;
  uploadEvidence?(command: EvidenceUploadCommand, session: Session): Promise<unknown>;
  loadPaired?(projectId: string, session: Session, params: PairedRouteParams): Promise<unknown | null>;
  savePaired?(projectId: string, session: Session, expectedVersion: number, form: FormData): Promise<unknown>;
};

type UploadFile = { name: string; mimeType: string; size: number; data: Uint8Array<ArrayBuffer> };
export type EvidenceUploadCommand = {
  projectId: string;
  sourceFileId: string;
  lineId: string;
  expectedVersion: number | null;
  kind: string;
  files: UploadFile[];
};

const MAX_FILE_SIZE = 4 * 1024 * 1024;
const MAX_UPLOAD_BODY = 42 * 1024 * 1024;
const MAX_PAIRED_BODY = Math.floor(4.2 * 1024 * 1024);
const ALLOWED_FILE_TYPES = new Set([
  "application/pdf", "image/jpeg", "image/png", "image/webp", "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation", "text/plain", "text/csv",
]);
const MIME_BY_EXTENSION = new Map([
  [".pdf", "application/pdf"], [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"], [".png", "image/png"],
  [".webp", "image/webp"], [".doc", "application/msword"],
  [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  [".xls", "application/vnd.ms-excel"],
  [".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  [".ppt", "application/vnd.ms-powerpoint"],
  [".pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  [".txt", "text/plain"], [".csv", "text/csv"],
]);
const ACTUAL_COST_EVIDENCE_KINDS = new Set([
  "VENDOR_CONTRACT_PO", "ACCEPTANCE_HANDOVER", "VAT_INVOICE", "PAYMENT_PROOF", "FIELD_PHOTO_REPORT",
]);

class EvidenceUploadError extends Error {
  constructor(message: string, readonly status = 422) { super(message); }
}

function parseCookie(header: string | null, name: string) {
  if (!header) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    return part.slice(separator + 1).trim();
  }
  return null;
}

async function readSession(request: Request, secret: string): Promise<Session | null> {
  const token = parseCookie(request.headers.get("cookie"), "session");
  if (!token || !secret) return null;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
    if (typeof payload.sub !== "string") return null;
    const sessionVersion = payload.sessionVersion ?? 0;
    if (typeof sessionVersion !== "number" || !Number.isSafeInteger(sessionVersion) || sessionVersion < 0) return null;
    return { userId: payload.sub, sessionVersion };
  } catch {
    return null;
  }
}

function normalizeSteps(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function canReadEvidence(row: EvidenceAccessRow, actorId: string) {
  if (row.member || row.dd || row.role === "ADMIN") return true;
  if (row.creatorId === actorId || row.cashAssigneeId === actorId || row.reader) return true;
  return normalizeSteps(row.steps).some(step => (
    !!step && typeof step === "object" && "assigneeId" in step && step.assigneeId === actorId
  ));
}

function bytesFromDatabase(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (Array.isArray(value) && value.every(item => Number.isInteger(item) && item >= 0 && item <= 255)) return new Uint8Array(value);
  if (typeof value === "string" && /^\\x[0-9a-f]*$/i.test(value) && value.length % 2 === 0) {
    const hex = value.slice(2);
    const bytes = new Uint8Array(hex.length / 2);
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
    return bytes;
  }
  return null;
}

class NeonEvidenceGateway implements EvidenceGateway {
  constructor(private readonly connectionString: string) {}

  async findAuthorizedEvidence(projectId: string, evidenceId: string, session: Session) {
    const sql = neon(this.connectionString);
    const result = await sql.query(
      `SELECT e."id", e."name", e."mimeType", e."data",
              u."role",
              EXISTS (SELECT 1 FROM "ProjectMember" pm WHERE pm."projectId" = e."projectId" AND pm."userId" = u."id") AS "member",
              EXISTS (SELECT 1 FROM "WorkflowRoleGrant" rg WHERE rg."userId" = u."id" AND rg."role" = 'AC_DD' AND rg."revokedAt" IS NULL) AS "dd",
              wr."creatorId", wr."cashAssigneeId", wr."steps",
              EXISTS (SELECT 1 FROM "WorkflowRequestReader" rr WHERE rr."requestId" = wr."id" AND rr."userId" = u."id") AS "reader"
         FROM "CostFlowEvidence" e
         JOIN "User" u ON u."id" = $3 AND u."isActive" = TRUE AND u."sessionVersion" = $4
         LEFT JOIN "WorkflowRequest" wr ON wr."id" = e."requestId"
        WHERE e."projectId" = $1 AND e."id" = $2
        LIMIT 1`,
      [projectId, evidenceId, session.userId, session.sessionVersion],
    ) as unknown as EvidenceAccessRow[];
    const row = result[0];
    if (!row || !canReadEvidence(row, session.userId)) return null;
    const data = bytesFromDatabase(row.data);
    if (!data) return null;
    return { id: row.id, name: row.name, mimeType: row.mimeType, data };
  }

  async uploadEvidence(command: EvidenceUploadCommand, session: Session) {
    const pool = new Pool({ connectionString: this.connectionString });
    const client = await pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      const context = await this.loadUploadContext(client, command.projectId, session);
      if (context.closed) throw new EvidenceUploadError("Tài chính đã đóng.", 409);
      const result = command.lineId
        ? await this.attachActualCostEvidence(client, command, context)
        : await this.createIcEvidence(client, command, context);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
      await pool.end();
    }
  }

  async loadPaired(projectId: string, session: Session, params: PairedRouteParams) {
    const pool = new Pool({ connectionString: this.connectionString });
    try {
      const initial = await pool.query(
        `SELECT p."id", p."name", p."ownerId", p."clientId", c."name" AS "clientName",
                u."role", cw."version", cw."data",
                EXISTS (SELECT 1 FROM "ProjectMember" pm WHERE pm."projectId" = p."id" AND pm."userId" = u."id") AS "member",
                EXISTS (SELECT 1 FROM "WorkflowRoleGrant" rg WHERE rg."userId" = u."id" AND rg."role" = 'AC_DD' AND rg."revokedAt" IS NULL) AS "dd"
           FROM "User" u
           JOIN "Project" p ON p."id" = $1
           LEFT JOIN "Client" c ON c."id" = p."clientId"
           LEFT JOIN "CostFlowWorkspace" cw ON cw."projectId" = p."id"
          WHERE u."id" = $2 AND u."isActive" = TRUE AND u."sessionVersion" = $3`,
        [projectId, session.userId, session.sessionVersion],
      );
      const row = initial.rows[0] as Record<string, unknown> | undefined;
      if (!row || !["ACCOUNT", "ADMIN"].includes(String(row.role))) return null;
      const source = row.data ? row.data as FinanceData : emptyFinance();
      const member = row.member === true;
      const fullAccess = row.role === "ADMIN" || row.dd === true || source.config.accountantId === session.userId || member;
      if (!fullAccess || source.closed) return null;
      const selection = selectPairedWorkspace(source, session.userId, params);
      if (!selection) return null;
      const [clients, files, evidence, requests] = await Promise.all([
        pool.query(`SELECT "id","name" FROM "Client" ORDER BY "name" ASC`),
        pool.query(`SELECT "id","name" FROM "ProjectFile" WHERE "projectId" = $1 ORDER BY "createdAt" DESC`, [projectId]),
        pool.query(`SELECT "id","name","kind","requestId","sha256","mimeType" FROM "CostFlowEvidence" WHERE "projectId" = $1`, [projectId]),
        selection.requestIds.length
          ? pool.query(`SELECT "id","state" FROM "WorkflowRequest" WHERE "projectId" = $1 AND "module" = 'COSTFLOW' AND "id" = ANY($2::text[])`, [projectId, selection.requestIds])
          : Promise.resolve({ rows: [] }),
      ]);
      return {
        finance: {
          project: {
            id: String(row.id), name: String(row.name), ownerId: String(row.ownerId),
            client: row.clientId ? { id: String(row.clientId), name: String(row.clientName) } : null,
            members: member ? [{ userId: session.userId }] : [],
          },
          clients: clients.rows,
          fullAccess: true,
          version: Number(row.version ?? 0),
          data: selection.data,
          requests: requests.rows,
          files: files.rows,
          evidence: evidence.rows,
        },
        resolvedQuotationId: selection.resolvedQuotationId,
      };
    } finally {
      await pool.end();
    }
  }

  async savePaired(projectId: string, session: Session, expectedVersion: number, form: FormData) {
    const pool = new Pool({ connectionString: this.connectionString });
    const client = await pool.connect();
    let requestId: string | undefined;
    try {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      const actorResult = await client.query(
        `SELECT u."id", u."role",
                EXISTS (SELECT 1 FROM "ProjectMember" pm WHERE pm."projectId" = p."id" AND pm."userId" = u."id") AS "member"
           FROM "User" u
           JOIN "Project" p ON p."id" = $1
          WHERE u."id" = $2 AND u."isActive" = TRUE AND u."sessionVersion" = $3`,
        [projectId, session.userId, session.sessionVersion],
      );
      const actor = actorResult.rows[0] as { id: string; role: string; member: boolean } | undefined;
      if (!actor || !["ACCOUNT", "ADMIN"].includes(actor.role) || (!actor.member && actor.role !== "ADMIN")) {
        throw new EvidenceUploadError("Chỉ Account/người lập được phân công mới được lập hoặc sửa hồ sơ tài chính.", 403);
      }
      await client.query(
        `INSERT INTO "CostFlowWorkspace" ("projectId","version","data","updatedAt") VALUES ($1,0,$2::jsonb,CURRENT_TIMESTAMP)
         ON CONFLICT ("projectId") DO NOTHING`,
        [projectId, JSON.stringify(emptyFinance())],
      );
      const workspaceResult = await client.query(
        `SELECT "version","data" FROM "CostFlowWorkspace" WHERE "projectId" = $1 FOR UPDATE`,
        [projectId],
      );
      const workspace = workspaceResult.rows[0] as { version: number; data: unknown } | undefined;
      if (!workspace) throw new EvidenceUploadError("Không tìm thấy dữ liệu tài chính.", 404);
      if (Number(workspace.version) !== expectedVersion) throw new EvidenceUploadError("Dữ liệu đã thay đổi. Tải lại trang trước khi thao tác.", 409);
      const data = hydrateLinePricingData(databaseJson<FinanceData>(workspace.data));
      if (data.closed) throw new EvidenceUploadError("Tài chính đã đóng. Cần yêu cầu Quản lý mở lại.", 409);
      const requestsResult = await client.query(
        `SELECT "id","state","creatorId" FROM "WorkflowRequest" WHERE "projectId" = $1 AND "module" = 'COSTFLOW'`,
        [projectId],
      );
      const store: PairedPersistence = {
        async findClientName(clientId) {
          const result = await client.query(`SELECT "name" FROM "Client" WHERE "id" = $1 LIMIT 1`, [clientId]);
          return result.rows[0]?.name ? String(result.rows[0].name) : null;
        },
        async countProjectEvidence(targetProjectId, evidenceIds) {
          if (!evidenceIds.length) return 0;
          const result = await client.query(
            `SELECT COUNT(*)::int AS "count" FROM "CostFlowEvidence" WHERE "projectId" = $1 AND "id" = ANY($2::text[])`,
            [targetProjectId, evidenceIds],
          );
          return Number(result.rows[0]?.count ?? 0);
        },
        async createIcWorkflowRequest(input) {
          const id = crypto.randomUUID();
          await client.query(
            `INSERT INTO "WorkflowRequest" ("id","projectId","module","kind","title","creatorId","cashAssigneeId","state","steps","payload","updatedAt")
             VALUES ($1,$2,'COSTFLOW','IC',$3,$4,$4,'DRAFT','[]'::jsonb,'{}'::jsonb,CURRENT_TIMESTAMP)`,
            [id, input.projectId, input.title, input.actorId],
          );
          return { id };
        },
        async updateIcWorkflowRequest(targetRequestId, payload, incrementVersion) {
          await client.query(
            `UPDATE "WorkflowRequest" SET "payload" = $1::jsonb, "version" = "version" + $2, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = $3 AND "projectId" = $4`,
            [JSON.stringify(payload), incrementVersion ? 1 : 0, targetRequestId, projectId],
          );
        },
      };
      const result = await applyPairedCommand(
        store,
        projectId,
        actor.id,
        data,
        requestsResult.rows as { id: string; state: string; creatorId: string }[],
        form,
      );
      requestId = result.requestId;
      if (result.exportSeal) {
        await persistExportSourceSeal({
          upsertExact: (input, seal) => upsertExportSourceSeal(client, input, seal),
        }, result.exportSeal);
      }
      const updated = await client.query(
        `UPDATE "CostFlowWorkspace" SET "version" = "version" + 1, "data" = $1::jsonb, "updatedAt" = CURRENT_TIMESTAMP
          WHERE "projectId" = $2 AND "version" = $3`,
        [JSON.stringify(data), projectId, expectedVersion],
      );
      if (updated.rowCount !== 1) throw new EvidenceUploadError("Dữ liệu đã thay đổi. Tải lại để tránh ghi trùng.", 409);
      await client.query(
        `INSERT INTO "CostFlowHistory" ("id","projectId","version","actorId","action","snapshot") VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
        [crypto.randomUUID(), projectId, expectedVersion + 1, actor.id, String(form.get("command") ?? ""), JSON.stringify(data)],
      );
      await client.query("COMMIT");
      await deliverWorkflowNotifications(neonNotificationStore(pool), requestId).catch(() => undefined);
      return {
        success: `Đã lưu ${result.savedScopes.join(" và ")}.`,
        requestId,
        revisionId: result.revisionId,
        quotationId: result.quotationId,
        draftId: result.draftId,
        savedScopes: result.savedScopes,
        version: expectedVersion + 1,
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
      await pool.end();
    }
  }

  private async loadUploadContext(client: PoolClient, projectId: string, session: Session) {
    const { rows } = await client.query(
      `SELECT u."id", u."role",
              EXISTS (SELECT 1 FROM "ProjectMember" pm WHERE pm."projectId" = p."id" AND pm."userId" = u."id") AS "member",
              EXISTS (SELECT 1 FROM "WorkflowRoleGrant" rg WHERE rg."userId" = u."id" AND rg."role" = 'AC_DD' AND rg."revokedAt" IS NULL) AS "dd",
              COALESCE((cw."data"->>'closed')::boolean, FALSE) AS "closed"
         FROM "User" u
         JOIN "Project" p ON p."id" = $1
         LEFT JOIN "CostFlowWorkspace" cw ON cw."projectId" = p."id"
        WHERE u."id" = $2 AND u."isActive" = TRUE AND u."sessionVersion" = $3`,
      [projectId, session.userId, session.sessionVersion],
    );
    const context = rows[0] as { id: string; role: string; member: boolean; dd: boolean; closed: boolean } | undefined;
    if (!context) throw new EvidenceUploadError("Không có quyền tải minh chứng.", 403);
    return context;
  }

  private async createIcEvidence(
    client: PoolClient,
    command: EvidenceUploadCommand,
    context: { id: string; role: string; member: boolean },
  ) {
    if ((!context.member && context.role !== "ADMIN") || !["ACCOUNT", "ADMIN"].includes(context.role)) {
      throw new EvidenceUploadError("Không có quyền tải minh chứng IC.", 403);
    }
    let file = command.files[0];
    let sourceFileId = "";
    if (command.sourceFileId) {
      const source = await client.query(
        `SELECT "id", "name", "mimeType", "size", "data" FROM "ProjectFile" WHERE "id" = $1 AND "projectId" = $2 LIMIT 1`,
        [command.sourceFileId, command.projectId],
      );
      const row = source.rows[0] as { id: string; name: string; mimeType: string; size: number; data: unknown } | undefined;
      if (!row) throw new EvidenceUploadError("File phải thuộc project.", 404);
      const data = bytesFromDatabase(row.data);
      if (!data) throw new EvidenceUploadError("Dữ liệu file không hợp lệ.");
      file = { name: row.name, mimeType: row.mimeType, size: row.size, data: copyBytes(data) };
      sourceFileId = row.id;
    }
    if (!file || file.size > MAX_FILE_SIZE) throw new EvidenceUploadError("Chọn một file tối đa 4 MiB.");
    const evidence = await insertEvidence(client, command.projectId, context.id, {
      ...file, kind: "IC_ESTIMATE", sourceFileId,
    });
    return { evidence: pickEvidence(evidence) };
  }

  private async attachActualCostEvidence(
    client: PoolClient,
    command: EvidenceUploadCommand,
    context: { id: string; member: boolean; dd: boolean },
  ) {
    if (!context.member && !context.dd) throw new EvidenceUploadError("Bạn không có quyền bổ sung chứng từ AC.", 403);
    if (!ACTUAL_COST_EVIDENCE_KINDS.has(command.kind)) throw new EvidenceUploadError("Loại chứng từ AC không hợp lệ.");
    if (command.expectedVersion === null) throw new EvidenceUploadError("Phiên bản AC không hợp lệ.");
    if (!command.files.length || command.files.length > 10) throw new EvidenceUploadError("Chọn từ 1 đến 10 file chứng từ.");

    const currentResult = await client.query(
      `SELECT l."id" AS "lineId", l."currentVersion", v.*
         FROM "ActualCostLine" l
         JOIN "ActualCostVersion" v ON v."lineId" = l."id" AND v."version" = $3
        WHERE l."id" = $1 AND l."projectId" = $2
        FOR UPDATE OF l`,
      [command.lineId, command.projectId, command.expectedVersion],
    );
    const current = currentResult.rows[0] as Record<string, unknown> | undefined;
    if (!current || current.currentVersion !== command.expectedVersion) {
      throw new EvidenceUploadError("Phiên bản AC đã thay đổi. Tải lại trước khi bổ sung chứng từ.");
    }
    const locked = await client.query(
      `SELECT 1 FROM "ActualCostApplication" a
        JOIN "WorkflowRequest" wr ON wr."id" = a."requestId"
       WHERE a."lineId" = $1 AND a."state" = 'ACTIVE' AND wr."state" NOT IN ('WITHDRAWN','REJECTED','CANCELLED') LIMIT 1`,
      [command.lineId],
    );
    if (locked.rowCount) throw new EvidenceUploadError("AC đang được hồ sơ thanh toán/hoàn ứng sử dụng và đã bị khóa.");

    const evidence = [];
    for (const file of command.files) {
      evidence.push(await insertEvidence(client, command.projectId, context.id, {
        ...file, kind: command.kind, sourceFileId: `actual-cost-upload:${crypto.randomUUID()}`,
      }));
    }
    const nextVersion = command.expectedVersion + 1;
    const versionId = crypto.randomUUID();
    await client.query(
      `INSERT INTO "ActualCostVersion" ("id","projectId","lineId","version","state","description","fundingSource","quantity","days","unitPrice","unit","basis","vatPercent","amount","rawAmount","sourceSnapshot","billable","saleSnapshot","createdById","submittedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,$18::jsonb,$19,$20)`,
      [versionId, command.projectId, command.lineId, nextVersion, current.state === "RETURNED" ? "RETURNED" : "SUBMITTED",
        current.description, current.fundingSource, current.quantity, current.days, current.unitPrice, current.unit,
        current.basis, current.vatPercent, current.amount, current.rawAmount, jsonValue(current.sourceSnapshot),
        current.billable, jsonValue(current.saleSnapshot), context.id, current.state === "RETURNED" ? null : new Date()],
    );
    const previousLinks = await client.query(
      `SELECT "projectId","evidenceId","kind","actorId" FROM "ActualCostEvidenceLink" WHERE "versionId" = $1`,
      [current.id],
    );
    for (const link of previousLinks.rows as { projectId: string; evidenceId: string; kind: string; actorId: string }[]) {
      await client.query(
        `INSERT INTO "ActualCostEvidenceLink" ("id","projectId","versionId","evidenceId","kind","actorId") VALUES ($1,$2,$3,$4,$5,$6)`,
        [crypto.randomUUID(), link.projectId, versionId, link.evidenceId, link.kind, link.actorId],
      );
    }
    for (const item of evidence) {
      await client.query(
        `INSERT INTO "ActualCostEvidenceLink" ("id","projectId","versionId","evidenceId","kind","actorId") VALUES ($1,$2,$3,$4,$5,$6)`,
        [crypto.randomUUID(), command.projectId, versionId, item.id, command.kind, context.id],
      );
    }
    const updated = await client.query(
      `UPDATE "ActualCostLine" SET "currentVersion" = $1, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = $2 AND "projectId" = $3 AND "currentVersion" = $4`,
      [nextVersion, command.lineId, command.projectId, command.expectedVersion],
    );
    if (updated.rowCount !== 1) throw new EvidenceUploadError("Phiên bản AC đã thay đổi. Tải lại trước khi bổ sung chứng từ.");
    return { lineId: command.lineId, versionId, version: nextVersion, evidence: evidence.map(pickEvidenceWithDate) };
  }
}

function copyBytes(data: Uint8Array) {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy as Uint8Array<ArrayBuffer>;
}

function jsonValue(value: unknown) {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

function databaseJson<T>(value: unknown): T {
  if (typeof value === "string") return JSON.parse(value) as T;
  return value as T;
}

async function upsertExportSourceSeal(client: PoolClient, input: ExportSourceSealInput, seal: BuiltExportSourceSeal) {
  await client.query(
    `INSERT INTO "SettlementExportSourceProjection"
      ("id","projectId","dossierVersionId","family","sourceKind","sourceId","sourceVersion","authoritativeNet","authoritativeVat","authoritativeGross","roundingAdjustment","vatLineAssignment","projectionHash","approvalAttemptId","approvedSnapshotId","signingState","canonicalPayload")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16,$17::jsonb)
     ON CONFLICT ("projectId","family","sourceKind","sourceId","sourceVersion") DO NOTHING`,
    [crypto.randomUUID(), input.projectId, input.dossierVersionId ?? null, input.family, input.sourceKind, input.sourceId,
      input.sourceVersion, seal.totals.net, seal.totals.vat, seal.totals.gross, seal.roundingAdjustment,
      JSON.stringify(seal.vatLineAssignment), seal.projectionHash, input.approvalAttemptId, input.approvedSnapshotId,
      input.signingState, JSON.stringify(seal.canonicalPayload)],
  );
  const existing = await client.query(
    `SELECT "dossierVersionId","authoritativeNet","authoritativeVat","authoritativeGross","roundingAdjustment","vatLineAssignment","projectionHash","approvalAttemptId","approvedSnapshotId","signingState","canonicalPayload"
       FROM "SettlementExportSourceProjection"
      WHERE "projectId" = $1 AND "family" = $2 AND "sourceKind" = $3 AND "sourceId" = $4 AND "sourceVersion" = $5`,
    [input.projectId, input.family, input.sourceKind, input.sourceId, input.sourceVersion],
  );
  const row = existing.rows[0] as Record<string, unknown> | undefined;
  if (!row) throw new Error("Không lưu được projection nguồn xuất phiếu.");
  return {
    dossierVersionId: row.dossierVersionId === null ? null : String(row.dossierVersionId),
    authoritativeNet: String(row.authoritativeNet),
    authoritativeVat: String(row.authoritativeVat),
    authoritativeGross: String(row.authoritativeGross),
    roundingAdjustment: Number(row.roundingAdjustment),
    vatLineAssignment: databaseJson(row.vatLineAssignment),
    projectionHash: String(row.projectionHash),
    approvalAttemptId: row.approvalAttemptId === null ? null : String(row.approvalAttemptId),
    approvedSnapshotId: row.approvedSnapshotId === null ? null : String(row.approvedSnapshotId),
    signingState: row.signingState === null ? null : String(row.signingState),
    canonicalPayload: databaseJson(row.canonicalPayload),
  };
}

function neonNotificationStore(pool: Pool): WorkflowNotificationDeliveryStore {
  return {
    async pending(requestId) {
      const result = await pool.query(
        `SELECT d."id", d."userId", e."id" AS "eventId", e."action", e."reason",
                r."id" AS "requestId", r."projectId", r."title"
           FROM "WorkflowNotificationDelivery" d
           JOIN "WorkflowApprovalEvent" e ON e."id" = d."eventId"
           JOIN "WorkflowRequest" r ON r."id" = e."requestId"
          WHERE d."status" IN ('PENDING','RETRY') AND d."attempts" < 3
            AND (d."nextAttemptAt" IS NULL OR d."nextAttemptAt" <= CURRENT_TIMESTAMP)
            AND ($1::text IS NULL OR e."requestId" = $1)
          ORDER BY d."createdAt" ASC LIMIT 50`,
        [requestId ?? null],
      );
      return result.rows.map(row => ({
        id: String(row.id),
        userId: String(row.userId),
        event: {
          id: String(row.eventId),
          action: String(row.action),
          reason: row.reason ? String(row.reason) : null,
          request: { id: String(row.requestId), projectId: row.projectId ? String(row.projectId) : null, title: String(row.title) },
        },
      }));
    },
    async upsertNotification(input) {
      await pool.query(
        `INSERT INTO "Notification" ("id","dedupeKey","userId","type","message","projectId","workflowRequestId")
         VALUES ($1,$2,$3,'WORKFLOW_APPROVAL',$4,$5,$6) ON CONFLICT ("dedupeKey") DO NOTHING`,
        [crypto.randomUUID(), input.dedupeKey, input.userId, input.message, input.projectId, input.requestId],
      );
    },
    async markDelivered(deliveryId) {
      await pool.query(
        `UPDATE "WorkflowNotificationDelivery" SET "status" = 'DELIVERED', "attempts" = "attempts" + 1, "lastError" = NULL, "nextAttemptAt" = NULL, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = $1`,
        [deliveryId],
      );
    },
    async markRetry(deliveryId, message, nextAttemptAt) {
      await pool.query(
        `UPDATE "WorkflowNotificationDelivery" SET "status" = 'RETRY', "attempts" = "attempts" + 1, "lastError" = $2, "nextAttemptAt" = $3, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = $1`,
        [deliveryId, message, nextAttemptAt],
      );
    },
  };
}

async function sha256(data: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", copyBytes(data));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function insertEvidence(
  client: PoolClient,
  projectId: string,
  actorId: string,
  file: UploadFile & { kind: string; sourceFileId: string },
) {
  const id = crypto.randomUUID();
  const integrity = await sha256(file.data);
  const result = await client.query(
    `INSERT INTO "CostFlowEvidence" ("id","projectId","sourceFileId","kind","name","mimeType","data","sha256","createdBy")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING "id","kind","name","mimeType","sha256","createdAt"`,
    [id, projectId, file.sourceFileId, file.kind, file.name, file.mimeType, Buffer.from(file.data), integrity, actorId],
  );
  return result.rows[0] as { id: string; kind: string; name: string; mimeType: string; sha256: string; createdAt: Date };
}

function pickEvidence(item: { id: string; kind: string; name: string; mimeType: string; sha256: string }) {
  return { id: item.id, name: item.name, mimeType: item.mimeType, sha256: item.sha256, kind: item.kind, requestId: null };
}

function pickEvidenceWithDate(item: { id: string; kind: string; name: string; mimeType: string; sha256: string; createdAt: Date }) {
  return { ...pickEvidence(item), createdAt: item.createdAt.toISOString() };
}

function previewMime(mimeType: string, bytes: Uint8Array) {
  if (mimeType === "application/pdf" && bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-") return mimeType;
  if (mimeType === "image/png" && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return mimeType;
  if (mimeType === "image/jpeg" && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return mimeType;
  return null;
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return false;
  try { return new URL(origin).host === host; } catch { return false; }
}

function extension(name: string) {
  const index = name.lastIndexOf(".");
  return index < 0 ? "" : name.slice(index).toLowerCase();
}

async function readUpload(value: FormDataEntryValue | null): Promise<UploadFile | null> {
  if (!(value instanceof File) || value.size === 0) return null;
  if (value.size > MAX_FILE_SIZE) throw new EvidenceUploadError("Tài liệu phải nhỏ hơn 4 MB.");
  const mimeType = value.type && ALLOWED_FILE_TYPES.has(value.type) ? value.type : MIME_BY_EXTENSION.get(extension(value.name));
  if (!mimeType || !ALLOWED_FILE_TYPES.has(mimeType)) {
    throw new EvidenceUploadError("Chỉ hỗ trợ PDF, hình ảnh, Word, Excel, PowerPoint, TXT hoặc CSV.");
  }
  const name = value.name.replace(/[\\/\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 180);
  if (!name) throw new EvidenceUploadError("Tên tài liệu không hợp lệ.");
  return { name, mimeType, size: value.size, data: new Uint8Array(await value.arrayBuffer()) };
}

async function handleEvidenceUpload(request: Request, projectId: string, session: Session, gateway: EvidenceGateway) {
  if (!sameOrigin(request)) return Response.json({ error: "Nguồn yêu cầu không hợp lệ." }, { status: 403 });
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_UPLOAD_BODY) {
    return Response.json({ error: "Tối đa 10 file, mỗi file 4 MiB." }, { status: 413 });
  }
  if (!gateway.uploadEvidence) return Response.json({ error: "Upload boundary chưa được cấu hình." }, { status: 503 });
  try {
    const form = await request.formData();
    const lineId = String(form.get("lineId") ?? "").trim();
    const files = (await Promise.all((lineId ? form.getAll("proof") : [form.get("proof")]).map(readUpload)))
      .filter((item): item is UploadFile => !!item);
    const expectedVersionRaw = Number(form.get("version"));
    const command: EvidenceUploadCommand = {
      projectId,
      sourceFileId: String(form.get("sourceFileId") ?? "").trim(),
      lineId,
      expectedVersion: lineId && Number.isSafeInteger(expectedVersionRaw) && expectedVersionRaw >= 0 ? expectedVersionRaw : null,
      kind: String(form.get("kind") ?? "").trim(),
      files,
    };
    const result = await gateway.uploadEvidence(command, session);
    return Response.json(result, { status: 201 });
  } catch (error) {
    const status = error instanceof EvidenceUploadError ? error.status : 422;
    return Response.json({ error: error instanceof Error ? error.message : "Chưa tải được file." }, { status });
  }
}

async function handlePairedSave(request: Request, projectId: string, session: Session, gateway: EvidenceGateway) {
  if (!sameOrigin(request)) return Response.json({ error: "Nguồn yêu cầu không hợp lệ." }, { status: 403 });
  if (!gateway.savePaired) return Response.json({ error: "Paired save boundary chưa được cấu hình." }, { status: 503 });
  try {
    const contentLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_PAIRED_BODY) throw new EvidenceUploadError("Dữ liệu paired vượt quá 4,2 MiB.", 413);
    const body = await request.arrayBuffer();
    if (body.byteLength > MAX_PAIRED_BODY) throw new EvidenceUploadError("Dữ liệu paired vượt quá 4,2 MiB.", 413);
    const contentType = request.headers.get("content-type");
    if (!contentType) throw new EvidenceUploadError("Thiếu định dạng dữ liệu paired.");
    const form = await new Response(body, { headers: { "content-type": contentType } }).formData();
    const command = String(form.get("command") ?? "");
    const expectedVersion = Number(form.get("version"));
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw new EvidenceUploadError("Phiên bản hồ sơ không hợp lệ.");
    if (command !== "SAVE_PAIRED_DRAFT" && command !== "FINALIZE_PAIRED_QUOTATION") throw new EvidenceUploadError("Thao tác paired không hợp lệ.");
    const result = await gateway.savePaired(projectId, session, expectedVersion, form);
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const status = error instanceof EvidenceUploadError ? error.status : 422;
    return Response.json({ error: error instanceof Error ? error.message : "Chưa lưu được hồ sơ." }, { status });
  }
}

export async function handleEvidenceRequest(request: Request, secret: string, gateway: EvidenceGateway) {
  const url = new URL(request.url);
  const path = evidencePath(url);
  const pairedPath = pairedDataPath(url);
  const pairedSave = pairedSavePath(url);
  if (!path && !pairedPath && !pairedSave) return new Response("Not found", { status: 404 });
  const session = await readSession(request, secret);
  const isUpload = request.method === "POST" && path?.evidenceId === "upload" && !path.preview;
  if (!session) return isUpload || pairedSave
    ? Response.json({ error: "Cần đăng nhập." }, { status: 401 })
    : new Response("Not found", { status: 404 });
  if (request.method === "POST" && pairedSave) return handlePairedSave(request, pairedSave.projectId, session, gateway);
  if (request.method === "GET" && pairedPath) {
    if (!gateway.loadPaired) return new Response("Not found", { status: 404 });
    const result = await gateway.loadPaired(pairedPath.projectId, session, {
      quotationId: url.searchParams.get("quotationId") || undefined,
      draftId: url.searchParams.get("draftId") || undefined,
      revisionId: url.searchParams.get("revisionId") || undefined,
    });
    return result
      ? Response.json(result, { headers: { "Cache-Control": "private, no-store" } })
      : new Response("Not found", { status: 404 });
  }
  if (!path) return new Response("Not found", { status: 404 });
  if (isUpload && path) {
    return handleEvidenceUpload(request, path.projectId, session, gateway);
  }
  if (request.method !== "GET") return new Response("Not found", { status: 404 });
  const evidence = await gateway.findAuthorizedEvidence(path.projectId, path.evidenceId, session);
  if (!evidence) return new Response("Not found", { status: 404 });

  const mimeType = path.preview ? previewMime(evidence.mimeType, evidence.data) : evidence.mimeType;
  if (!mimeType) return new Response("Định dạng này chỉ hỗ trợ tải về.", { status: 415 });
  const headers = new Headers({
    "Cache-Control": "private, no-store",
    "Content-Disposition": `${path.preview ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(evidence.name)}`,
    "Content-Type": mimeType,
    "X-Content-Type-Options": "nosniff",
  });
  if (path.preview) {
    headers.set("Content-Security-Policy", "sandbox; frame-ancestors 'self'; default-src 'none';");
    headers.set("X-Frame-Options", "SAMEORIGIN");
  }
  const responseBytes = new Uint8Array(evidence.data.byteLength);
  responseBytes.set(evidence.data);
  return new Response(responseBytes.buffer, { headers });
}

export class EvidenceObject {
  constructor(_state: unknown, private readonly env: EvidenceObjectEnv) {}

  fetch(request: Request) {
    return handleEvidenceRequest(request, this.env.SESSION_SECRET, new NeonEvidenceGateway(this.env.DATABASE_URL));
  }
}
