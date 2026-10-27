import assert from "node:assert/strict";
import test from "node:test";

import { z } from "zod/v4";

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
