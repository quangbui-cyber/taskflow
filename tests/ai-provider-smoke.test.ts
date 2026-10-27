import assert from "node:assert/strict";
import test from "node:test";

import { z } from "zod/v4";

import { loadAiConfig } from "@/lib/ai/config";
import { CandidateBatchSchema } from "@/lib/ai/contracts";
import {
  AiProviderFailure,
  OpenAiGenerationModel,
  type StructuredOutputInvoker,
} from "@/lib/ai/providers/openai";

const SourceSpanSchema = z
  .object({
    sourceRevisionId: z.string().min(1),
    page: z.number().int().positive().optional(),
    cellRange: z.string().min(1).optional(),
    quote: z.string().min(1).max(240).optional(),
  })
  .strict()
  .refine((span) => span.page !== undefined || span.cellRange !== undefined, {
    message: "A page or cell range is required",
  });

const CandidateSchema = z
  .object({
    fieldKey: z.string().min(1),
    value: z.string().nullable(),
    sources: z.array(SourceSpanSchema).min(1),
  })
  .strict();

test("approved AI packages import offline and strict provenance remains enforced", async () => {
  const originalKey = process.env.OPENAI_API_KEY;
  const originalFetch = globalThis.fetch;
  let networkAttempts = 0;

  delete process.env.OPENAI_API_KEY;
  globalThis.fetch = async () => {
    networkAttempts += 1;
    throw new Error("AI smoke test forbids network access");
  };

  try {
    const packages = await Promise.all([
      import("llamaindex"),
      import("@llamaindex/openai"),
      import("openai"),
      import("zod/v4"),
      import("@arizeai/phoenix-otel"),
      import("@arizeai/openinference-instrumentation-openai"),
      import("@arizeai/phoenix-client"),
      import("@arizeai/phoenix-evals"),
      import("promptfoo"),
    ]);

    assert.ok(packages.every((loaded) => typeof loaded === "object"));
    assert.equal(networkAttempts, 0);

    assert.equal(
      CandidateSchema.safeParse({
        fieldKey: "grossAmount",
        value: "1250000",
        sources: [{ sourceRevisionId: "rev-1", cellRange: "B12" }],
      }).success,
      true,
    );
    assert.equal(
      CandidateSchema.safeParse({
        fieldKey: "grossAmount",
        value: "1250000",
        sources: [{ sourceRevisionId: "rev-1" }],
      }).success,
      false,
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalKey;
    }
  }
});

test("AI configuration is disabled by default and rejects unapproved or unbounded values", () => {
  assert.deepEqual(loadAiConfig({}), {
    enabled: false,
    provider: null,
    tracingEnabled: false,
  });

  const base = {
    AI_ENABLED: "true",
    AI_PROVIDER: "openai",
    AI_GENERATION_MODEL: "gpt-6-luna",
    AI_EMBEDDING_MODEL: "text-embedding-3-small",
    AI_TIMEOUT_MS: "30000",
    AI_MAX_OUTPUT_TOKENS: "4000",
    AI_MAX_CONCURRENCY: "2",
    OPENAI_API_KEY: "test-only",
  };

  assert.throws(
    () => loadAiConfig({ ...base, AI_GENERATION_MODEL: "unknown-model" }),
    /generation model/i,
  );
  assert.throws(
    () => loadAiConfig({ ...base, AI_MAX_OUTPUT_TOKENS: "999999" }),
    /output token/i,
  );
  assert.throws(
    () => loadAiConfig({ ...base, AI_MAX_CONCURRENCY: "0" }),
    /concurrency/i,
  );
  assert.throws(
    () => loadAiConfig({ ...base, AI_TIMEOUT_MS: "999999" }),
    /timeout/i,
  );
  assert.throws(
    () => loadAiConfig({ ...base, AI_TASKS: "DOCUMENT_EXTRACTION,UNKNOWN" }),
    /task ID/i,
  );
});

test("OpenAI adapter rejects candidate sources outside the authorized payload after one repair", async () => {
  const config = loadAiConfig({
    AI_ENABLED: "true",
    AI_PROVIDER: "openai",
    AI_GENERATION_MODEL: "gpt-6-luna",
    AI_EMBEDDING_MODEL: "text-embedding-3-small",
    AI_TIMEOUT_MS: "30000",
    AI_MAX_OUTPUT_TOKENS: "4000",
    AI_MAX_CONCURRENCY: "2",
    OPENAI_API_KEY: "test-only",
  });
  let attempts = 0;
  const invoke: StructuredOutputInvoker = async () => {
    attempts += 1;
    return {
      id: `response-${attempts}`,
      outputParsed: CandidateBatchSchema.parse({
        task: "DOCUMENT_EXTRACTION",
        candidates: [
          {
            key: "grossAmount",
            value: "1250000",
            decimalValue: "1250000",
            confidence: 0.99,
            sources: [
              {
                spanId: "span-outside-scope",
                sourceRevisionId: "rev-1",
                page: 1,
                cellRange: null,
                quote: "1.250.000",
              },
            ],
            needsHumanReview: true,
          },
        ],
        warnings: [],
      }),
      usage: { inputTokens: 10, outputTokens: 8, totalTokens: 18 },
    };
  };
  const model = new OpenAiGenerationModel(config, invoke);

  await assert.rejects(
    model.extract(
      {
        task: "DOCUMENT_EXTRACTION",
        instruction: "Extract candidates only.",
        authorizedSources: [
          {
            span: {
              spanId: "span-authorized",
              sourceRevisionId: "rev-1",
              page: 1,
              cellRange: null,
              quote: "1.250.000",
            },
            content: "Gross amount: 1.250.000",
          },
        ],
      },
      new AbortController().signal,
    ),
    (error: unknown) =>
      error instanceof AiProviderFailure && error.code === "INVALID_SCHEMA",
  );
  assert.equal(attempts, 2);
});

test("caller cancellation stops without a repair attempt", async () => {
  const config = loadAiConfig({
    AI_ENABLED: "true",
    AI_PROVIDER: "openai",
    AI_GENERATION_MODEL: "gpt-6-luna",
    AI_EMBEDDING_MODEL: "text-embedding-3-small",
    AI_TIMEOUT_MS: "30000",
    AI_MAX_OUTPUT_TOKENS: "4000",
    AI_MAX_CONCURRENCY: "2",
    OPENAI_API_KEY: "test-only",
  });
  let attempts = 0;
  const invoke: StructuredOutputInvoker = async ({ abort }) => {
    attempts += 1;
    assert.equal(abort.aborted, true);
    throw new DOMException("Cancelled", "AbortError");
  };
  const model = new OpenAiGenerationModel(config, invoke);
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    model.extract(
      {
        task: "DOCUMENT_EXTRACTION",
        instruction: "Extract candidates only.",
        authorizedSources: [
          {
            span: {
              spanId: "span-authorized",
              sourceRevisionId: "rev-1",
              page: 1,
              cellRange: null,
              quote: "1.250.000",
            },
            content: "Gross amount: 1.250.000",
          },
        ],
      },
      controller.signal,
    ),
    (error: unknown) =>
      error instanceof AiProviderFailure && error.code === "TIMEOUT",
  );
  assert.equal(attempts, 1);
});
