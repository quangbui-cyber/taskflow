import assert from "node:assert/strict";
import test from "node:test";

import type { AiConfig } from "@/lib/ai/config";
import {
  AiTraceAttributeError,
  redactAiTraceAttributes,
} from "@/lib/ai/observability/redaction";
import {
  registerAiObservability,
  type AiObservabilityAdapter,
} from "@/lib/ai/observability/register";

const canaries = {
  prompt: "CANARY_PROMPT_IGNORE_POLICY",
  document: "CANARY_DOCUMENT_BANK_998877",
  output: "CANARY_OUTPUT_TAX_010203",
  personal: "CANARY_PERSONAL_NGUYEN_TEST",
};

test("trace projection exports only allowlisted operational attributes", () => {
  const attributes = redactAiTraceAttributes({
    runId: "run-001",
    sourceSha256: "a".repeat(64),
    spanKind: "generation",
    pipelineVersion: "15-02-v1",
    sourceCount: 2,
    latencyMs: 25,
    inputTokens: 10,
    outputTokens: 5,
    totalTokens: 15,
    failureCode: "TIMEOUT",
    providerRequestId: "request-001",
    rawPrompt: canaries.prompt,
    documentText: canaries.document,
    modelOutput: canaries.output,
    personalValue: canaries.personal,
  });

  assert.deepEqual(attributes, {
    "ai.run.id": "run-001",
    "ai.source.sha256": "a".repeat(64),
    "ai.span.kind": "generation",
    "ai.pipeline.version": "15-02-v1",
    "ai.source.count": 2,
    "ai.latency_ms": 25,
    "ai.usage.input_tokens": 10,
    "ai.usage.output_tokens": 5,
    "ai.usage.total_tokens": 15,
    "ai.failure.code": "TIMEOUT",
    "ai.provider.request_id": "request-001",
  });
  const serialized = JSON.stringify(attributes);
  for (const value of Object.values(canaries)) assert.equal(serialized.includes(value), false);
});

test("invalid allowlisted values fail closed without raw value in error metadata", () => {
  let captured: unknown;
  try {
    redactAiTraceAttributes({ sourceSha256: canaries.document });
  } catch (error) {
    captured = error;
  }
  assert.ok(captured instanceof AiTraceAttributeError);
  assert.equal(JSON.stringify(captured).includes(canaries.document), false);
  assert.equal(String(captured).includes(canaries.document), false);
});

test("observability is disabled by default and registration is idempotent", async () => {
  let registrations = 0;
  const adapter: AiObservabilityAdapter = {
    register: async ({ redactAttributes }) => {
      registrations += 1;
      assert.equal(
        JSON.stringify(redactAttributes({ rawPrompt: canaries.prompt })).includes(canaries.prompt),
        false,
      );
    },
  };
  const disabled: AiConfig = { enabled: false, provider: null, tracingEnabled: false };
  assert.deepEqual(await registerAiObservability(disabled, adapter), {
    enabled: false,
    registered: false,
  });
  assert.equal(registrations, 0);

  const enabled: AiConfig = {
    enabled: true,
    provider: "openai",
    tracingEnabled: true,
    tracingEndpoint: "http://127.0.0.1:6006",
    apiKey: "synthetic-test-key",
    generationModel: "gpt-6-luna",
    embeddingModel: "text-embedding-3-small",
    tasks: ["DOCUMENT_EXTRACTION"],
    timeoutMs: 30_000,
    maxOutputTokens: 1_000,
    maxConcurrency: 1,
  };
  assert.deepEqual(await registerAiObservability(enabled, adapter), {
    enabled: true,
    registered: true,
  });
  assert.deepEqual(await registerAiObservability(enabled, adapter), {
    enabled: true,
    registered: false,
  });
  assert.equal(registrations, 1);
});
