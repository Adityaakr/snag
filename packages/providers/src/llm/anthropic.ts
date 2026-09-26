/**
 * Anthropic structured output (BUILD_PROMPT 8). Uses native structured outputs (`output_config.format`), since
 * forced tool choice is rejected by current Opus models. The model gets no tools at all. Temperature is sent
 * only to models that still accept it. SDK retries are off; Remit's own backoff runs instead.
 */
import Anthropic from '@anthropic-ai/sdk';
import { jsonSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/json-schema';
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

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface AnthropicLlmOptions {
  model: string;
  price: LlmPrice;
  apiKey?: string;
  effort?: Effort;
  costs?: CostTracker;
  logger?: Logger;
  retry?: RetryOptions;
  timeoutMs?: number;
  baseURL?: string;
  fetch?: typeof fetch;
}

/** Models where sampling parameters were removed (sending temperature returns 400). */
const NO_SAMPLING = /^claude-(opus-(4-[78]|5)|fable|mythos|sonnet-5)/;

export function acceptsTemperature(model: string): boolean {
  return !NO_SAMPLING.test(model);
}

/** Maps SDK errors to classified ProviderErrors, most specific first. */
export function classifyAnthropicError(e: unknown): ProviderError {
  if (e instanceof ProviderError) return e;
  if (e instanceof Anthropic.RateLimitError) {
    const ra = Number(e.headers?.get?.('retry-after'));
    return new ProviderError(
      'anthropic',
      'rate_limited',
      'rate limited (429)',
      undefined,
      Number.isFinite(ra) ? ra * 1000 : undefined,
    );
  }
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    return new ProviderError(
      'anthropic',
      'auth',
      'the API key was rejected',
      'Check ANTHROPIC_API_KEY in .env.',
    );
  }
  if (e instanceof Anthropic.NotFoundError) {
    return new ProviderError(
      'anthropic',
      'config',
      'model not found',
      'Check extraction.model in .remit.yml; `remit doctor` lists the models your key can use.',
    );
  }
  if (e instanceof Anthropic.BadRequestError)
    return new ProviderError('anthropic', 'bad_request', `request rejected: ${e.message}`);
  if (e instanceof Anthropic.APIConnectionTimeoutError)
    return new ProviderError('anthropic', 'timeout', 'request timed out');
  if (e instanceof Anthropic.APIConnectionError)
    return new ProviderError(
      'anthropic',
      'connection',
      'could not reach the Anthropic API',
      'Check network access, or run with --offline.',
    );
  if (e instanceof Anthropic.InternalServerError) {
    return e.status === 529
      ? new ProviderError('anthropic', 'overloaded', 'overloaded (529)')
      : new ProviderError('anthropic', 'server', `server error (${e.status})`);
  }
  if (e instanceof Anthropic.APIError)
    return new ProviderError('anthropic', 'server', `unexpected status ${e.status}`);
  return new ProviderError('anthropic', 'connection', e instanceof Error ? e.message : String(e));
}

export class AnthropicLlm implements LlmProvider {
  readonly provider = 'anthropic' as const;
  readonly model: string;
  private client: Anthropic | null = null;
  private readonly logger: Logger;

  constructor(private readonly opts: AnthropicLlmOptions) {
    this.model = opts.model;
    this.logger = opts.logger ?? silentLogger;
  }

  /** The underlying client, created on first use so a missing key fails with a fix. */
  sdk(): Anthropic {
    if (this.client) return this.client;
    const apiKey = this.opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new ProviderError(
        'anthropic',
        'config',
        'ANTHROPIC_API_KEY is not set',
        'Add it to .env, use extraction.mode: tasklist_only, or run with --offline to see demo data.',
      );
    }
    this.client = new Anthropic({
      apiKey,
      maxRetries: 0,
      ...(this.opts.timeoutMs ? { timeout: this.opts.timeoutMs } : {}),
      ...(this.opts.baseURL ? { baseURL: this.opts.baseURL } : {}),
      ...(this.opts.fetch ? { fetch: this.opts.fetch } : {}),
    });
    return this.client;
  }

  async structured<T>(
    schema: z.ZodType<T>,
    messages: LlmMessage[],
    opts: StructuredOptions,
  ): Promise<LlmResult<T>> {
    const format = jsonSchemaOutputFormat(z.toJSONSchema(schema, { target: 'draft-2020-12' }) as never);
    const usage = { inputTokens: 0, outputTokens: 0 };
    let model = this.model;
    const call = async (msgs: LlmMessage[]): Promise<string> => {
      this.opts.costs?.ensure('anthropic');
      const res = await withRetry(
        async () => {
          try {
            return await this.sdk().messages.create(
              {
                model: this.model,
                max_tokens: opts.maxTokens ?? 16_000,
                system: opts.system,
                messages: msgs,
                output_config: {
                  format: { type: 'json_schema', schema: format.schema },
                  ...(this.opts.effort ? { effort: this.opts.effort } : {}),
                },
                ...(acceptsTemperature(this.model) ? { temperature: 0 } : {}),
              },
              opts.signal ? { signal: opts.signal } : undefined,
            );
          } catch (e) {
            throw classifyAnthropicError(e);
          }
        },
        {
          ...this.opts.retry,
          onRetry: (err, attempt, delay) =>
            this.logger.warn(
              {
                provider: 'anthropic',
                kind: opts.kind,
                reviewId: opts.reviewId,
                error: err.kind,
                attempt,
                delay,
              },
              'retrying llm call',
            ),
        },
      );
      model = res.model;
      usage.inputTokens += res.usage.input_tokens;
      usage.outputTokens += res.usage.output_tokens;
      this.opts.costs?.addLlm(
        res.usage.input_tokens,
        res.usage.output_tokens,
        llmCost(this.opts.price, res.usage.input_tokens, res.usage.output_tokens),
      );
      this.logger.info(
        {
          provider: 'anthropic',
          kind: opts.kind,
          target: opts.targetId,
          reviewId: opts.reviewId,
          model: res.model,
          stop: res.stop_reason,
          inputTokens: res.usage.input_tokens,
          outputTokens: res.usage.output_tokens,
        },
        'llm call',
      );
      if (res.stop_reason === 'refusal') {
        throw new ProviderError(
          'anthropic',
          'bad_request',
          `the model declined the request (${res.stop_details?.category ?? 'no category'})`,
          'Review the issue text; you can switch extraction.provider or use extraction.mode: tasklist_only.',
        );
      }
      if (res.stop_reason === 'max_tokens') {
        throw new ProviderError(
          'anthropic',
          'bad_request',
          'the output hit max_tokens before finishing',
          'The issue may be very long; raise the extraction token limit.',
        );
      }
      return res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
    };
    const { data, repairs } = await withRepair('anthropic', schema, messages, call);
    return {
      data,
      usage,
      model,
      costUsd: llmCost(this.opts.price, usage.inputTokens, usage.outputTokens),
      cached: false,
      repairs,
    };
  }

  /** Lists model ids the key can use (Models API, auto-paginated). */
  async listModels(): Promise<string[]> {
    try {
      const ids: string[] = [];
      for await (const m of this.sdk().models.list()) ids.push(m.id);
      return ids;
    } catch (e) {
      throw classifyAnthropicError(e);
    }
  }
}
