import "server-only";

import type { AiConfig } from "@/lib/ai/config";
import { redactAiTraceAttributes } from "@/lib/ai/observability/redaction";

type RegistrationInput = {
  endpoint: string;
  projectName: "taskflow-phase15";
  redactAttributes: typeof redactAiTraceAttributes;
};

export type AiObservabilityAdapter = {
  register(input: RegistrationInput): void | Promise<void>;
};

const registeredAdapters = new WeakMap<AiObservabilityAdapter, Promise<void>>();

const phoenixAdapter: AiObservabilityAdapter = {
  async register({ endpoint, projectName }) {
    const [{ register }, { OpenAIInstrumentation }, { default: OpenAI }] =
      await Promise.all([
        import("@arizeai/phoenix-otel"),
        import("@arizeai/openinference-instrumentation-openai"),
        import("openai"),
      ]);
    const provider = register({
      projectName,
      url: endpoint,
      batch: true,
      global: true,
    });
    const instrumentation = new OpenAIInstrumentation({
      tracerProvider: provider,
      traceConfig: {
        hideInputs: true,
        hideOutputs: true,
        hideInputMessages: true,
        hideOutputMessages: true,
        hideInputImages: true,
        hideInputText: true,
        hideOutputText: true,
        hideEmbeddingVectors: true,
        hidePrompts: true,
        hideLLMTools: true,
      },
    });
    instrumentation.manuallyInstrument(OpenAI);
  },
};

export async function registerAiObservability(
  config: AiConfig,
  adapter: AiObservabilityAdapter = phoenixAdapter,
) {
  if (!config.enabled || !config.tracingEnabled || !config.tracingEndpoint) {
    return { enabled: false, registered: false } as const;
  }

  const existing = registeredAdapters.get(adapter);
  if (existing) {
    await existing;
    return { enabled: true, registered: false } as const;
  }

  const registration = Promise.resolve(
    adapter.register({
      endpoint: config.tracingEndpoint,
      projectName: "taskflow-phase15",
      redactAttributes: redactAiTraceAttributes,
    }),
  );
  registeredAdapters.set(adapter, registration);
  try {
    await registration;
  } catch (error) {
    registeredAdapters.delete(adapter);
    throw error;
  }
  return { enabled: true, registered: true } as const;
}
