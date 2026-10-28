import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { GenerationTaskSchema, type GenerationTask } from "@/lib/ai/contracts";
import { loadAiConfig } from "@/lib/ai/config";
import { AiSourceNotFoundError, parseAiSourceSelection, requireAiProjectRead, resolveAiReadScope } from "@/lib/ai/access/resolveAiReadScope";
import { snapshotSelectedAiSources } from "@/lib/ai/sources/sourceRevisions";
import { prisma } from "@/lib/prisma";

const PARSER_VERSION = "phase15-parser-v1";
const PIPELINE_VERSION = "phase15-pipeline-v1";
const PROMPT_VERSION = "phase15-extract-v1";

export class AiRunInputError extends Error { readonly code = "INVALID_INPUT"; }
export class AiRunDisabledError extends Error { readonly code = "DISABLED"; }

export type AiRunCommand = {
  intent: "ANALYZE";
  task: GenerationTask;
  sourceIds: string[];
  pairRoles?: Record<string, "XML" | "PDF">;
};

export function validateAiRunCommand(value: unknown): AiRunCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AiRunInputError("Invalid request.");
  const input = value as Record<string, unknown>;
  if (input.intent !== "ANALYZE" || !GenerationTaskSchema.safeParse(input.task).success || !Array.isArray(input.sourceIds)) {
    throw new AiRunInputError("Select a supported analysis and explicitly start it.");
  }
  let sources;
  try { sources = parseAiSourceSelection(input.sourceIds as string[]); }
  catch { throw new AiRunInputError("Select one supported source or one related invoice pair."); }
  const task = input.task as GenerationTask;
  if (task === "DOCUMENT_EXTRACTION" && sources.some(({ kind }) => ![
    "PROJECT_FILE", "VENDOR_INVOICE_FILE", "COSTFLOW_PO", "COSTFLOW_IC", "FINANCE_SHEET",
  ].includes(kind))) throw new AiRunInputError("This source cannot be extracted into PO, VAT or IC fields.");
  if (task === "EXCEL_STRUCTURE" && sources.some(({ kind }) => ![
    "PROJECT_FILE", "EXCEL_INTAKE_SOURCE",
  ].includes(kind))) throw new AiRunInputError("Select an Excel source for structure mapping.");
  let pairRoles: Record<string, "XML" | "PDF"> | undefined;
  if (input.pairRoles !== undefined) {
    if (!input.pairRoles || typeof input.pairRoles !== "object" || Array.isArray(input.pairRoles)) throw new AiRunInputError("Invalid invoice roles.");
    const entries = Object.entries(input.pairRoles as Record<string, unknown>);
    if (sources.length !== 2 || entries.length !== 2 ||
        entries.some(([key, role]) => !input.sourceIds || !(input.sourceIds as string[]).includes(key) || !["XML", "PDF"].includes(String(role))) ||
        new Set(entries.map(([, role]) => role)).size !== 2) throw new AiRunInputError("Select one XML and one PDF from the same invoice.");
    pairRoles = input.pairRoles as Record<string, "XML" | "PDF">;
  } else if (sources.length === 2) {
    throw new AiRunInputError("Explicit XML/PDF roles are required.");
  }
  return { intent: "ANALYZE", task, sourceIds: [...input.sourceIds] as string[], pairRoles };
}

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function deriveAiRunIdentity(input: {
  task: string; scopeHash: string; sourceHashes: readonly string[];
  parserVersion: string; pipelineVersion: string; promptVersion: string; configVersion: string;
}) {
  const sourceBundleHash = digest(input.sourceHashes);
  return { sourceBundleHash, idempotencyKey: digest({ ...input, sourceBundleHash }) };
}

function runtimeConfig() {
  const config = loadAiConfig();
  if (!config.enabled) throw new AiRunDisabledError("AI analysis is unavailable.");
  return {
    provider: config.provider,
    model: config.generationModel,
    timeoutMs: config.timeoutMs,
    tasks: config.tasks,
    configVersion: digest({ provider: config.provider, model: config.generationModel,
      tasks: config.tasks, timeoutMs: config.timeoutMs, maxOutputTokens: config.maxOutputTokens }),
  };
}

export async function createAiRun(actorId: string, projectId: string, rawCommand: unknown) {
  const command = validateAiRunCommand(rawCommand);
  const config = runtimeConfig();
  if (!config.tasks.includes(command.task)) throw new AiRunDisabledError("This analysis task is unavailable.");
  const scopeInput = { projectId, sourceIds: command.sourceIds, purpose: command.task };
  const scope = await resolveAiReadScope(actorId, scopeInput);
  if (command.pairRoles) {
    for (const source of scope.sources) {
      const requested = command.pairRoles[`${source.kind}:${source.id}`];
      const actual = source.mimeType === "application/pdf" ? "PDF" : "XML";
      if (requested !== actual) throw new AiRunInputError("Invoice file role does not match its format.");
    }
  }
  const revisions = await snapshotSelectedAiSources(actorId, scope.sources);
  const currentScope = await resolveAiReadScope(actorId, scopeInput);
  if (currentScope.scopeHash !== scope.scopeHash) throw new AiSourceNotFoundError();
  const identity = deriveAiRunIdentity({ task: command.task, scopeHash: scope.scopeHash,
    sourceHashes: revisions.map((revision) => revision.sha256),
    parserVersion: PARSER_VERSION, pipelineVersion: PIPELINE_VERSION,
    promptVersion: PROMPT_VERSION, configVersion: config.configVersion });
  const unique = { scopeKey_runType_idempotencyKey: {
    scopeKey: scope.scopeKey, runType: command.task, idempotencyKey: identity.idempotencyKey,
  } };
  const existing = await prisma.aiRun.findUnique({ where: unique, select: { id: true, status: true, scopeHash: true, configVersion: true } });
  if (existing && existing.status !== "FAILED" && existing.scopeHash === scope.scopeHash && existing.configVersion === config.configVersion) {
    return { id: existing.id, status: existing.status, reused: true };
  }
  const idempotencyKey = existing ? digest([identity.idempotencyKey, randomUUID()]) : identity.idempotencyKey;
  try {
    const startedAt = new Date();
    const run = await prisma.$transaction(async (tx) => tx.aiRun.create({ data: {
      project: { connect: { id: projectId } }, actor: { connect: { id: actorId } },
      scopeKey: scope.scopeKey, runType: command.task, status: "READY",
      sourceBundleHash: identity.sourceBundleHash, parserVersion: PARSER_VERSION,
      pipelineVersion: PIPELINE_VERSION, promptVersion: PROMPT_VERSION,
      configVersion: config.configVersion, provider: config.provider, model: config.model,
      scopeVersion: "1", scopeHash: scope.scopeHash, idempotencyKey,
      startedAt, timeoutAt: new Date(startedAt.getTime() + config.timeoutMs),
      sources: { create: revisions.map((revision, index) => ({
        sourceRevision: { connect: { id_scopeKey: { id: revision.id, scopeKey: scope.scopeKey } } },
        role: command.pairRoles?.[command.sourceIds[index]] ?? "PRIMARY",
      })) },
    }, select: { id: true, status: true } }), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return { ...run, reused: false };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" && !existing) {
      const raced = await prisma.aiRun.findUnique({ where: unique, select: { id: true, status: true } });
      if (raced && raced.status !== "FAILED") return { ...raced, reused: true };
    }
    throw error;
  }
}

export async function readAiRun(actorId: string, projectId: string, runId: string) {
  const run = await prisma.aiRun.findFirst({ where: { id: runId, projectId },
    select: { id: true, actorId: true, runType: true, status: true, createdAt: true,
      timeoutAt: true, cancelledAt: true, completedAt: true, failureCode: true, scopeHash: true,
      sources: { select: { role: true, sourceRevision: { select: {
        originKind: true, originId: true, filename: true, sha256: true,
      } } } } } });
  if (!run) throw new AiSourceNotFoundError();
  const sourceIds = run.sources.map(({ sourceRevision }) => `${sourceRevision.originKind}:${sourceRevision.originId}`);
  await resolveAiReadScope(actorId, { projectId, sourceIds, purpose: run.runType });
  return { id: run.id, task: run.runType, status: run.status, createdAt: run.createdAt,
    timeoutAt: run.timeoutAt, cancelledAt: run.cancelledAt,
    completedAt: run.completedAt, failureCode: run.failureCode,
    sources: run.sources.map(({ role, sourceRevision }) => ({ role,
      filename: sourceRevision.filename, sha256: sourceRevision.sha256 })) };
}

export async function listAiRuns(actorId: string, projectId: string) {
  await requireAiProjectRead(actorId, projectId);
  const runs = await prisma.aiRun.findMany({ where: { projectId, actorId },
    orderBy: { createdAt: "desc" }, take: 30, select: { id: true } });
  const visible = await Promise.all(runs.map(async ({ id }) => {
    try { return await readAiRun(actorId, projectId, id); }
    catch (error) { if (error instanceof AiSourceNotFoundError) return null; throw error; }
  }));
  return visible.filter((run) => run !== null);
}
