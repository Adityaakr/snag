/**
 * OpenAI-compatible structured output (BUILD_PROMPT 8, decorrelated extraction). Uses JSON Schema response
 * format with temperature 0 and no tools.
 */
import OpenAI from 'openai';
import { z } from 'zod';
import type { CostTracker } from '../common/budget.js';
import { ProviderError } from '../common/errors.js';
import { type Logger, silentLogger } from '../common/limits.js';
import { type RetryOptions, withRetry } from '../common/retry.js';
import { withRepair } from './repair.js';
import {
  type LlmMessage,
  type LlmPrice,
  type LlmProvider,
  type LlmResult,
  llmCost,
  type StructuredOptions,
} from './types.js';

export interface OpenAiCompatibleOptions {
  model: string;
  price: LlmPrice;
  apiKey?: string;
  baseURL?: string;
  costs?: CostTracker;
  logger?: Logger;
  retry?: RetryOptions;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export function classifyOpenAiError(e: unknown): ProviderError {
  if (e instanceof ProviderError) return e;
  if (e instanceof OpenAI.RateLimitError)
    return new ProviderError('openai_compatible', 'rate_limited', 'rate limited (429)');
  if (e instanceof OpenAI.AuthenticationError || e instanceof OpenAI.PermissionDeniedError) {
    return new ProviderError(
      'openai_compatible',
      'auth',
      'the API key was rejected',
      'Check OPENAI_COMPATIBLE_API_KEY in .env.',
    );
  }
  if (e instanceof OpenAI.BadRequestError || e instanceof OpenAI.NotFoundError)
    return new ProviderError('openai_compatible', 'bad_request', `request rejected: ${e.message}`);
  if (e instanceof OpenAI.APIConnectionTimeoutError)
    return new ProviderError('openai_compatible', 'timeout', 'request timed out');
  if (e instanceof OpenAI.APIConnectionError)
    return new ProviderError(
      'openai_compatible',
      'connection',
      'could not reach the endpoint',
      'Check OPENAI_COMPATIBLE_BASE_URL and network access.',
    );
  if (e instanceof OpenAI.APIError)
    return new ProviderError('openai_compatible', 'server', `server error (${e.status})`);
  return new ProviderError('openai_compatible', 'connection', e instanceof Error ? e.message : String(e));
}

export class OpenAiCompatibleLlm implements LlmProvider {
  readonly provider = 'openai_compatible' as const;
  readonly model: string;
  private client: OpenAI | null = null;
  private readonly logger: Logger;

  constructor(private readonly opts: OpenAiCompatibleOptions) {
    this.model = opts.model;
    this.logger = opts.logger ?? silentLogger;
  }

  private sdk(): OpenAI {
    if (this.client) return this.client;
    const apiKey = this.opts.apiKey ?? process.env.OPENAI_COMPATIBLE_API_KEY;
    const baseURL = this.opts.baseURL ?? process.env.OPENAI_COMPATIBLE_BASE_URL;
    if (!apiKey || !baseURL) {
      throw new ProviderError(
        'openai_compatible',
        'config',
        'OPENAI_COMPATIBLE_API_KEY and OPENAI_COMPATIBLE_BASE_URL must both be set',
        'Add them to .env, or set extraction.provider: anthropic.',
      );
    }
    this.client = new OpenAI({
      apiKey,
      baseURL,
      maxRetries: 0,
      ...(this.opts.timeoutMs ? { timeout: this.opts.timeoutMs } : {}),
      ...(this.opts.fetch ? { fetch: this.opts.fetch } : {}),
    });
    return this.client;
  }

  async structured<T>(
    schema: z.ZodType<T>,
    messages: LlmMessage[],
    opts: StructuredOptions,
  ): Promise<LlmResult<T>> {
    const jsonSchema = z.toJSONSchema(schema, { target: 'draft-2020-12' }) as Record<string, unknown>;
    const usage = { inputTokens: 0, outputTokens: 0 };
    let model = this.model;
    const call = async (msgs: LlmMessage[]): Promise<string> => {
      this.opts.costs?.ensure('openai_compatible');
      const res = await withRetry(async () => {
        try {
          return await this.sdk().chat.completions.create(
            {
              model: this.model,
              temperature: 0,
              max_tokens: opts.maxTokens ?? 16_000,
              messages: [{ role: 'system', content: opts.system }, ...msgs],
              response_format: {
                type: 'json_schema',
                json_schema: { name: opts.schemaName, schema: jsonSchema, strict: false },
              },
            },
            opts.signal ? { signal: opts.signal } : undefined,
          );
        } catch (e) {
          throw classifyOpenAiError(e);
        }
      }, this.opts.retry);
      model = res.model;
      const inT = res.usage?.prompt_tokens ?? 0;
      const outT = res.usage?.completion_tokens ?? 0;
      usage.inputTokens += inT;
      usage.outputTokens += outT;
      this.opts.costs?.addLlm(inT, outT, llmCost(this.opts.price, inT, outT));
      this.logger.info(
        {
          provider: 'openai_compatible',
          kind: opts.kind,
          reviewId: opts.reviewId,
          model: res.model,
          inputTokens: inT,
          outputTokens: outT,
        },
        'llm call',
      );
      return res.choices[0]?.message?.content ?? '';
    };
    const { data, repairs } = await withRepair('openai_compatible', schema, messages, call);
    return {
      data,
      usage,
      model,
      costUsd: llmCost(this.opts.price, usage.inputTokens, usage.outputTokens),
      cached: false,
      repairs,
    };
  }
}
