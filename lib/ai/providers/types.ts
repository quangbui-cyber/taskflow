import "server-only";

import type {
  AuthorizedRetrievalSpan,
  CandidateBatch,
  GenerationTask,
  Usage,
} from "@/lib/ai/contracts";

export type GenerationRequest = {
  task: GenerationTask;
  instruction: string;
  authorizedSources: readonly AuthorizedRetrievalSpan[];
};

export type GenerationResult = {
  providerRequestId: string;
  output: CandidateBatch;
  usage: Usage;
};

export interface GenerationModel {
  extract(request: GenerationRequest, abort: AbortSignal): Promise<GenerationResult>;
}

export type EmbeddingRequest = {
  task: GenerationTask;
  authorizedSources: readonly AuthorizedRetrievalSpan[];
};

export type EmbeddingResult = {
  providerRequestId: string;
  vectors: readonly (readonly number[])[];
  usage: Usage;
};

export interface EmbeddingModel {
  embed(request: EmbeddingRequest, abort: AbortSignal): Promise<EmbeddingResult>;
}
