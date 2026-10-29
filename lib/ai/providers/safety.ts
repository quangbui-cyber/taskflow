import "server-only";

import {
  AiFailureCodeSchema,
  AuthorizedRetrievalSpanSchema,
  type AiFailureCode,
  type CandidateBatch,
} from "@/lib/ai/contracts";
import type { GenerationRequest } from "@/lib/ai/providers/types";

export class AiProviderFailure extends Error {
  readonly code: AiFailureCode;

  constructor(code: AiFailureCode, message: string, options?: ErrorOptions) {
    AiFailureCodeSchema.parse(code);
    super(message, options);
    this.name = "AiProviderFailure";
    this.code = code;
  }
}

export function abortScope(parent: AbortSignal, timeoutMs: number) {
  const controller = new AbortController();
  let timedOut = false;
  const onParentAbort = () => controller.abort(parent.reason);
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error("AI provider timeout"));
  }, timeoutMs);
  timer.unref?.();

  if (parent.aborted) onParentAbort();
  else parent.addEventListener("abort", onParentAbort, { once: true });

  return {
    abort: controller.signal,
    timedOut: () => timedOut,
    cleanup: () => {
      clearTimeout(timer);
      parent.removeEventListener("abort", onParentAbort);
    },
  };
}

export function normalizeGenerationRequest(request: GenerationRequest): GenerationRequest {
  if (!request.instruction.trim() || request.instruction.length > 5_000) {
    throw new AiProviderFailure("INVALID_SCHEMA", "AI instruction is invalid.");
  }
  const sourceResult = AuthorizedRetrievalSpanSchema.array().min(1).max(100).safeParse(
    request.authorizedSources,
  );
  if (!sourceResult.success) {
    throw new AiProviderFailure("INVALID_SCHEMA", "Authorized sources are invalid.");
  }
  if (new Set(sourceResult.data.map((item) => item.span.spanId)).size !== sourceResult.data.length) {
    throw new AiProviderFailure("INVALID_SCHEMA", "Authorized source IDs must be unique.");
  }
  return {
    ...request,
    instruction: request.instruction.trim(),
    authorizedSources: sourceResult.data,
  };
}

export function assertAuthorizedOutput(output: CandidateBatch, request: GenerationRequest) {
  if (output.task !== request.task) {
    throw new Error("Output task does not match the requested task.");
  }
  const allowed = new Map(
    request.authorizedSources.map((item) => [item.span.spanId, item.span]),
  );
  for (const candidate of output.candidates) {
    for (const source of candidate.sources) {
      const expected = allowed.get(source.spanId);
      if (
        !expected ||
        expected.sourceRevisionId !== source.sourceRevisionId ||
        expected.page !== source.page ||
        expected.cellRange !== source.cellRange ||
        expected.quote !== source.quote
      ) {
        throw new Error("Output source is outside the authorized source set.");
      }
    }
  }
}

export function mapProviderFailure(
  error: unknown,
  timedOut: boolean,
  cancelled: boolean,
): AiProviderFailure {
  if (error instanceof AiProviderFailure) return error;
  if (timedOut || cancelled) {
    return new AiProviderFailure("TIMEOUT", "AI provider timed out or was cancelled.", {
      cause: error,
    });
  }
  if (typeof error === "object" && error !== null && "status" in error) {
    if (error.status === 429) {
      return new AiProviderFailure("QUOTA", "AI provider quota was exceeded.", {
        cause: error,
      });
    }
    if ([400, 401, 403].includes(Number(error.status))) {
      return new AiProviderFailure("DISABLED", "AI provider configuration was rejected.", {
        cause: error,
      });
    }
    if (Number(error.status) >= 500) {
      return new AiProviderFailure("TIMEOUT", "AI provider is unavailable.", {
        cause: error,
      });
    }
  }
  return new AiProviderFailure("INVALID_SCHEMA", "AI provider response was invalid.", {
    cause: error,
  });
}
