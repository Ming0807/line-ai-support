export interface EmbeddingRequest {
  modelId: string;
  baseUrl: string;
  apiKey: string;
  input: string[];
  dimensions: number;
  signal: AbortSignal;
}

export interface EmbeddingResponse {
  vectors: number[][];
  inputTokens: number | null;
}

export interface EmbeddingAdapter {
  embed(request: EmbeddingRequest): Promise<EmbeddingResponse>;
}
import type {AIModelConfig,AIAttempt} from './types';


export type EmbeddingModelConfig=Omit<AIModelConfig,'supportsJson'|'supportsTools'>&{dimensions:number};
export interface EmbeddingStore {
  loadEmbeddingModels():Promise<EmbeddingModelConfig[]>;
  recordAttempt(attempt:AIAttempt):Promise<void>;
}
