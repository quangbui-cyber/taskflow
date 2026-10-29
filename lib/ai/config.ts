import "server-only";

import {
  GenerationTaskSchema,
  type GenerationTask,
} from "@/lib/ai/contracts";

const OPENAI_GENERATION_MODELS = ["gpt-6-luna", "gpt-6.1-sol"] as const;
const OPENAI_EMBEDDING_MODELS = ["text-embedding-3-small"] as const;
const GEMINI_GENERATION_MODELS = ["gemini-3.8-flash"] as const;
const GEMINI_EMBEDDING_MODELS = ["gemini-embedding-2"] as const;

type Environment = Record<string, string | undefined>;

export type AiDisabledConfig = {
  enabled: false;
  provider: null;
  tracingEnabled: false;
};

type AiEnabledBase = {
  enabled: true;
  tracingEnabled: boolean;
  tracingEndpoint: string | null;
  apiKey: string;
  tasks: readonly GenerationTask[];
  timeoutMs: number;
  maxOutputTokens: number;
  maxConcurrency: number;
};

export type OpenAiEnabledConfig = AiEnabledBase & {
  provider: "openai";
  generationModel: (typeof OPENAI_GENERATION_MODELS)[number];
  embeddingModel: (typeof OPENAI_EMBEDDING_MODELS)[number];
};

export type GeminiEnabledConfig = AiEnabledBase & {
  provider: "gemini";
  generationModel: (typeof GEMINI_GENERATION_MODELS)[number];
  embeddingModel: (typeof GEMINI_EMBEDDING_MODELS)[number];
};

export type AiEnabledConfig = OpenAiEnabledConfig | GeminiEnabledConfig;

export type AiConfig = AiDisabledConfig | AiEnabledConfig;

function required(value: string | undefined, label: string) {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${label} is required when AI is enabled.`);
  return normalized;
}

function boundedInteger(
  value: string | undefined,
  label: string,
  minimum: number,
  maximum: number,
) {
  const normalized = required(value, label);
  if (!/^\d+$/.test(normalized)) throw new Error(`${label} must be an integer.`);
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function allowlisted<const T extends readonly string[]>(
  value: string | undefined,
  label: string,
  allowed: T,
): T[number] {
  const normalized = required(value, label);
  if (!allowed.includes(normalized)) throw new Error(`${label} is not approved.`);
  return normalized as T[number];
}

function configuredTasks(value: string | undefined): readonly GenerationTask[] {
  const requested = (value ?? GenerationTaskSchema.options.join(","))
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (requested.length === 0 || new Set(requested).size !== requested.length) {
    throw new Error("AI task IDs must be unique and non-empty.");
  }
  return requested.map((item) => {
    const parsed = GenerationTaskSchema.safeParse(item);
    if (!parsed.success) throw new Error(`AI task ID is not approved: ${item}`);
    return parsed.data;
  });
}

export function loadAiConfig(env: Environment = process.env): AiConfig {
  if (env.AI_ENABLED !== "true") {
    return { enabled: false, provider: null, tracingEnabled: false };
  }

  const provider = required(env.AI_PROVIDER, "AI provider");
  if (provider !== "openai" && provider !== "gemini") {
    throw new Error("AI provider is not approved.");
  }

  const tracingEnabled = env.AI_TRACING_ENABLED === "true";
  const tracingEndpoint = tracingEnabled
    ? required(env.PHOENIX_COLLECTOR_ENDPOINT, "Tracing endpoint")
    : null;

  const common = {
    enabled: true as const,
    tracingEnabled,
    tracingEndpoint,
    tasks: configuredTasks(env.AI_TASKS),
    timeoutMs: boundedInteger(env.AI_TIMEOUT_MS, "AI timeout", 1_000, 120_000),
    maxOutputTokens: boundedInteger(
      env.AI_MAX_OUTPUT_TOKENS,
      "AI output token limit",
      1,
      8_000,
    ),
    maxConcurrency: boundedInteger(
      env.AI_MAX_CONCURRENCY,
      "AI concurrency",
      1,
      8,
    ),
  };

  if (provider === "gemini") {
    return {
      ...common,
      provider,
      apiKey: required(env.GEMINI_API_KEY, "Gemini API key"),
      generationModel: allowlisted(
        env.AI_GENERATION_MODEL,
        "AI generation model",
        GEMINI_GENERATION_MODELS,
      ),
      embeddingModel: allowlisted(
        env.AI_EMBEDDING_MODEL,
        "AI embedding model",
        GEMINI_EMBEDDING_MODELS,
      ),
    };
  }

  return {
    ...common,
    provider,
    apiKey: required(env.OPENAI_API_KEY, "OpenAI API key"),
    generationModel: allowlisted(
      env.AI_GENERATION_MODEL,
      "AI generation model",
      OPENAI_GENERATION_MODELS,
    ),
    embeddingModel: allowlisted(
      env.AI_EMBEDDING_MODEL,
      "AI embedding model",
      OPENAI_EMBEDDING_MODELS,
    ),
  };
}
