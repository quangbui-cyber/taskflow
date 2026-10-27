import "server-only";

import { AiFailureCodeSchema } from "@/lib/ai/contracts";

type TraceAttributeValue = string | number;
type TraceAttributes = Record<string, TraceAttributeValue>;

const SPAN_KINDS = new Set([
  "extraction",
  "embedding",
  "retrieval",
  "generation",
  "risk",
  "qa",
]);
const SAFE_IDENTIFIER = /^[A-Za-z0-9._:-]{1,128}$/;
const SAFE_VERSION = /^[A-Za-z0-9._:-]{1,64}$/;
const SHA256 = /^[a-f0-9]{64}$/;

export class AiTraceAttributeError extends Error {
  readonly code = "INVALID_TRACE_ATTRIBUTE";

  constructor() {
    super("AI trace attribute failed the operational allowlist.");
    this.name = "AiTraceAttributeError";
  }
}

function safeString(value: unknown, pattern: RegExp) {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new AiTraceAttributeError();
  }
  return value;
}

function safeCount(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new AiTraceAttributeError();
  }
  return value;
}

function safeLatency(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new AiTraceAttributeError();
  }
  return value;
}

export function redactAiTraceAttributes(
  input: Readonly<Record<string, unknown>>,
): TraceAttributes {
  const output: TraceAttributes = {};

  if (input.runId !== undefined) {
    output["ai.run.id"] = safeString(input.runId, SAFE_IDENTIFIER);
  }
  if (input.projectIdHash !== undefined) {
    output["ai.project.id_hash"] = safeString(input.projectIdHash, SHA256);
  }
  if (input.actorScopeHash !== undefined) {
    output["ai.actor.scope_hash"] = safeString(input.actorScopeHash, SHA256);
  }
  if (input.sourceRevisionId !== undefined) {
    output["ai.source.revision_id"] = safeString(
      input.sourceRevisionId,
      SAFE_IDENTIFIER,
    );
  }
  if (input.sourceSha256 !== undefined) {
    output["ai.source.sha256"] = safeString(input.sourceSha256, SHA256);
  }
  if (input.spanKind !== undefined) {
    const spanKind = safeString(input.spanKind, SAFE_VERSION);
    if (!SPAN_KINDS.has(spanKind)) throw new AiTraceAttributeError();
    output["ai.span.kind"] = spanKind;
  }
  if (input.pipelineVersion !== undefined) {
    output["ai.pipeline.version"] = safeString(input.pipelineVersion, SAFE_VERSION);
  }
  if (input.sourceCount !== undefined) {
    output["ai.source.count"] = safeCount(input.sourceCount);
  }
  if (input.candidateCount !== undefined) {
    output["ai.candidate.count"] = safeCount(input.candidateCount);
  }
  if (input.latencyMs !== undefined) {
    output["ai.latency_ms"] = safeLatency(input.latencyMs);
  }
  if (input.inputTokens !== undefined) {
    output["ai.usage.input_tokens"] = safeCount(input.inputTokens);
  }
  if (input.outputTokens !== undefined) {
    output["ai.usage.output_tokens"] = safeCount(input.outputTokens);
  }
  if (input.totalTokens !== undefined) {
    output["ai.usage.total_tokens"] = safeCount(input.totalTokens);
  }
  if (input.failureCode !== undefined) {
    const parsed = AiFailureCodeSchema.safeParse(input.failureCode);
    if (!parsed.success) throw new AiTraceAttributeError();
    output["ai.failure.code"] = parsed.data;
  }
  if (input.providerRequestId !== undefined) {
    output["ai.provider.request_id"] = safeString(
      input.providerRequestId,
      SAFE_IDENTIFIER,
    );
  }

  return output;
}
