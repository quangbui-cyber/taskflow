import "server-only";

import type { AiEnabledConfig } from "@/lib/ai/config";
import { GeminiGenerationModel } from "@/lib/ai/providers/gemini";
import { OpenAiGenerationModel } from "@/lib/ai/providers/openai";
import type { GenerationModel } from "@/lib/ai/providers/types";

export function createGenerationModel(config: AiEnabledConfig): GenerationModel {
  switch (config.provider) {
    case "gemini":
      return new GeminiGenerationModel(config);
    case "openai":
      return new OpenAiGenerationModel(config);
  }
}
