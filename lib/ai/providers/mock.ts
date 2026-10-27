import "server-only";

import { createHash } from "node:crypto";

import {
  AiFailureCodeSchema,
  type AiFailureCode,
  type GenerationTask,
} from "@/lib/ai/contracts";
import type {
  EmbeddingModel,
  EmbeddingRequest,
  EmbeddingResult,
  GenerationModel,
  GenerationRequest,
  GenerationResult,
} from "@/lib/ai/providers/types";

type Success<T> = { type: "success"; result: T };
type Failure = { type: "failure"; code: AiFailureCode };

type QueuedOutcome<T> = {
  fixtureId: string;
  runId: string;
  task: GenerationTask;
  outcome: Success<T> | Failure;
};

export type MockGenerationOutcome = QueuedOutcome<GenerationResult>;
export type MockEmbeddingOutcome = QueuedOutcome<EmbeddingResult>;

export type MockCallRecord = {
  fixtureId: string;
  runId: string;
  task: GenerationTask;
  instructionSha256: string | null;
  instructionChars: number;
  sourceCount: number;
  sourceChars: number;
  sourceSha256: readonly string[];
};

export class MockProviderFailure extends Error {
  readonly code: AiFailureCode;

  constructor(code: AiFailureCode) {
    AiFailureCodeSchema.parse(code);
    super(`Mock AI provider outcome: ${code}`);
    this.name = "MockProviderFailure";
    this.code = code;
  }
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function captureCall(
  queued: Pick<QueuedOutcome<unknown>, "fixtureId" | "runId" | "task">,
  request: {
    instruction?: string;
    authorizedSources: GenerationRequest["authorizedSources"];
  },
): MockCallRecord {
  const sourcePayloads = request.authorizedSources.map((source) =>
    JSON.stringify({
      spanIdSha256: sha256(source.span.spanId),
      revisionIdSha256: sha256(source.span.sourceRevisionId),
      page: source.span.page,
      cellRangeSha256:
        source.span.cellRange === null ? null : sha256(source.span.cellRange),
      quoteSha256: sha256(source.span.quote),
      contentSha256: sha256(source.content),
    }),
  );
  const instruction = request.instruction ?? "";
  return {
    fixtureId: queued.fixtureId,
    runId: queued.runId,
    task: queued.task,
    instructionSha256: instruction ? sha256(instruction) : null,
    instructionChars: instruction.length,
    sourceCount: request.authorizedSources.length,
    sourceChars: request.authorizedSources.reduce(
      (total, source) => total + source.content.length + source.span.quote.length,
      0,
    ),
    sourceSha256: sourcePayloads.map(sha256),
  };
}

function takeOutcome<T>(queue: QueuedOutcome<T>[], task: GenerationTask) {
  const index = queue.findIndex((item) => item.task === task);
  if (index === -1) throw new MockProviderFailure("DISABLED");
  return queue.splice(index, 1)[0]!;
}

function resolveOutcome<T>(outcome: Success<T> | Failure): T {
  if (outcome.type === "failure") throw new MockProviderFailure(outcome.code);
  return outcome.result;
}

export class MockGenerationModel implements GenerationModel {
  private readonly queue: MockGenerationOutcome[];
  readonly calls: MockCallRecord[] = [];

  constructor(outcomes: readonly MockGenerationOutcome[]) {
    this.queue = [...outcomes];
  }

  async extract(request: GenerationRequest, abort: AbortSignal) {
    const queued = takeOutcome(this.queue, request.task);
    this.calls.push(captureCall(queued, request));
    if (abort.aborted) throw new MockProviderFailure("TIMEOUT");
    return resolveOutcome(queued.outcome);
  }
}

export class MockEmbeddingModel implements EmbeddingModel {
  private readonly queue: MockEmbeddingOutcome[];
  readonly calls: MockCallRecord[] = [];

  constructor(outcomes: readonly MockEmbeddingOutcome[]) {
    this.queue = [...outcomes];
  }

  async embed(request: EmbeddingRequest, abort: AbortSignal) {
    const queued = takeOutcome(this.queue, request.task);
    this.calls.push(captureCall(queued, request));
    if (abort.aborted) throw new MockProviderFailure("TIMEOUT");
    return resolveOutcome(queued.outcome);
  }
}
