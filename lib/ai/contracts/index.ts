import "server-only";

import { z } from "zod/v4";

export const GenerationTaskSchema = z.enum([
  "DOCUMENT_EXTRACTION",
  "EXCEL_STRUCTURE",
  "RISK_SUSPICION",
]);

export const CanonicalDecimalSchema = z
  .string()
  .regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/, "Canonical decimal string required");

export const SourceRevisionSchema = z
  .object({
    projectId: z.string().min(1),
    sourceRevisionId: z.string().min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export const SourceSpanSchema = z
  .object({
    spanId: z.string().min(1),
    sourceRevisionId: z.string().min(1),
    page: z.number().int().positive().nullable(),
    cellRange: z.string().min(1).nullable(),
    quote: z.string().min(1).max(240),
  })
  .strict()
  .refine((span) => span.page !== null || span.cellRange !== null, {
    message: "A page or cell range is required",
  });

export const AuthorizedRetrievalSpanSchema = z
  .object({
    span: SourceSpanSchema,
    content: z.string().min(1).max(20_000),
  })
  .strict();

export const CandidateProvenanceSchema = z
  .object({
    key: z.string().min(1),
    value: z.string().nullable(),
    decimalValue: CanonicalDecimalSchema.nullable(),
    confidence: z.number().min(0).max(1),
    sources: z.array(SourceSpanSchema).min(1),
    needsHumanReview: z.boolean(),
  })
  .strict();

export const CandidateBatchSchema = z
  .object({
    task: GenerationTaskSchema,
    candidates: z.array(CandidateProvenanceSchema).max(500),
    warnings: z.array(z.string().max(500)).max(100),
  })
  .strict();

export const UsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
  })
  .strict();

export const CitedClaimSchema = z
  .object({
    claim: z.string().min(1),
    sources: z.array(SourceSpanSchema).min(1),
  })
  .strict();

export const AiRunCodeSchema = z.enum([
  "READY",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
]);

export const AiFailureCodeSchema = z.enum([
  "TIMEOUT",
  "QUOTA",
  "REFUSAL",
  "INVALID_SCHEMA",
  "DISABLED",
]);

export type GenerationTask = z.infer<typeof GenerationTaskSchema>;
export type SourceRevision = z.infer<typeof SourceRevisionSchema>;
export type SourceSpan = z.infer<typeof SourceSpanSchema>;
export type AuthorizedRetrievalSpan = z.infer<typeof AuthorizedRetrievalSpanSchema>;
export type CandidateProvenance = z.infer<typeof CandidateProvenanceSchema>;
export type CandidateBatch = z.infer<typeof CandidateBatchSchema>;
export type Usage = z.infer<typeof UsageSchema>;
export type CitedClaim = z.infer<typeof CitedClaimSchema>;
export type AiRunCode = z.infer<typeof AiRunCodeSchema>;
export type AiFailureCode = z.infer<typeof AiFailureCodeSchema>;
