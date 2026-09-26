/**
 * The generative LLM contract (BUILD_PROMPT 8): one structured call that returns zod-validated data.
 * Used only for requirement extraction and the single-pass eval baseline.
 */
import type { z } from 'zod';

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface StructuredOptions {
  /** Short name for the output schema (used as the JSON Schema name and in cache keys). */
  schemaName: string;
  system: string;
  /** Versioned prompt id, part of the cache key (for example `xp-0.1.0`). */
  promptVersion: string;
  maxTokens?: number;
  /** For logs and fakes. */
  kind?: string;
  targetId?: string;
  reviewId?: string;
  signal?: AbortSignal;
}

export interface LlmResult<T> {
  data: T;
  usage: { inputTokens: number; outputTokens: number };
  model: string;
  costUsd: number;
  cached: boolean;
  /** Number of repair turns used (0 or 1). */
  repairs: number;
}

export interface LlmProvider {
  readonly provider: 'anthropic' | 'openai_compatible' | 'fake';
  readonly model: string;
  structured<T>(schema: z.ZodType<T>, messages: LlmMessage[], opts: StructuredOptions): Promise<LlmResult<T>>;
}

/** Per-million-token prices. */
export interface LlmPrice {
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
}

export function llmCost(price: LlmPrice, inputTokens: number, outputTokens: number): number {
  return (inputTokens * price.inputPerMillionUsd + outputTokens * price.outputPerMillionUsd) / 1e6;
}
