/**
 * Jev over the official SDK (BUILD_PROMPT 7.3, DECISIONS D5). SDK retries are off; this adapter owns backoff,
 * the process-wide rate limiter, overflow shrinking, answer validation, cost accounting and model logging.
 */
import { estimateTokens } from '@remit/core';
import {
  APIConnectionError,
  APIError,
  APITimeoutError,
  AuthenticationError,
  BadRequestError,
  type Fetch,
  InternalServerError,
  type EntryType,
  PermissionDeniedError,
  type Questions,
  RateLimitError,
  TypeSafeClient,
  UnprocessableEntityError,
} from '@typesafe-ai/sdk';
import type { CostTracker } from '../common/budget.js';
import { ProviderError } from '../common/errors.js';
import { type Logger, RateLimiter, Semaphore, silentLogger } from '../common/limits.js';
import { type RetryOptions, withRetry } from '../common/retry.js';
import type { AskOptions, CallMeta, JevAnswers, JevProvider, JevResult } from './types.js';
import { validateAnswers } from './validate.js';

export interface LiveJevOptions {
  apiKey?: string;
  model: string;
  pricePerMillionUsd: number;
  maxStateTokens?: number;
  maxRequestTokens?: number;
  concurrency?: number;
  limiter?: RateLimiter;
  costs?: CostTracker;
  logger?: Logger;
  retry?: RetryOptions;
  timeoutMs?: number;
  baseURL?: string;
  fetch?: Fetch;
}

/** One limiter per process, shared by every LiveJev (about 1200 rpm and 250k tokens/s, docs/providers.md). */
let sharedLimiter: RateLimiter | null = null;
export function processJevLimiter(): RateLimiter {
  sharedLimiter ??= new RateLimiter(1200, 250_000);
  return sharedLimiter;
}

const OVERFLOW_TEXT = /token|too (long|large)|max_tokens|context length|exceed/i;

/** Maps SDK errors to classified ProviderErrors. */
export function classifyJevError(e: unknown): ProviderError {
  if (e instanceof ProviderError) return e;
  if (e instanceof RateLimitError)
    return new ProviderError(
      'jev',
      'rate_limited',
      'rate limited (429)',
      undefined,
      e.retryAfterMs ?? undefined,
    );
  if (e instanceof APITimeoutError) return new ProviderError('jev', 'timeout', 'request timed out');
  if (e instanceof APIConnectionError)
    return new ProviderError(
      'jev',
      'connection',
      'could not reach api.typesafe.ai',
      'Check network access, or run with --offline.',
    );
  if (e instanceof AuthenticationError || e instanceof PermissionDeniedError) {
    return new ProviderError(
      'jev',
      'auth',
      'the API key was rejected',
      'Check TYPESAFE_API_KEY in .env (see https://docs.typesafe.ai/introduction/quickstart).',
    );
  }
  if (e instanceof BadRequestError || e instanceof UnprocessableEntityError) {
    const text = `${e.message} ${JSON.stringify(e.body ?? '')}`;
    if (OVERFLOW_TEXT.test(text))
      return new ProviderError('jev', 'overflow', `request too large (${e.status})`);
    return new ProviderError('jev', 'bad_request', `request rejected (${e.status})`);
  }
  if (e instanceof InternalServerError) {
    return e.status === 529
      ? new ProviderError('jev', 'overloaded', 'service overloaded (529)')
      : new ProviderError('jev', 'server', `server error (${e.status})`);
  }
  if (e instanceof APIError) return new ProviderError('jev', 'server', `unexpected status ${e.status}`);
  return new ProviderError('jev', 'connection', e instanceof Error ? e.message : String(e));
}

function requestTokens(state: EntryType, questions: Questions): { state: number; total: number } {
  const s = estimateTokens(state);
  return { state: s, total: s + Object.values(questions).reduce((n, q) => n + estimateTokens(q), 0) };
}

export class LiveJev implements JevProvider {
  readonly model: string;
  private client: TypeSafeClient | null = null;
  private readonly semaphore: Semaphore;
  private readonly limiter: RateLimiter;
  private readonly logger: Logger;
  private readonly maxState: number;
  private readonly maxRequest: number;

  constructor(private readonly opts: LiveJevOptions) {
    this.model = opts.model;
    this.semaphore = new Semaphore(opts.concurrency ?? 8);
    this.limiter = opts.limiter ?? processJevLimiter();
    this.logger = opts.logger ?? silentLogger;
    this.maxState = opts.maxStateTokens ?? 24_000;
    this.maxRequest = opts.maxRequestTokens ?? 56_000;
  }

  private getClient(): TypeSafeClient {
    if (this.client) return this.client;
    const apiKey = this.opts.apiKey ?? process.env.TYPESAFE_API_KEY;
    if (!apiKey) {
      throw new ProviderError(
        'jev',
        'config',
        'TYPESAFE_API_KEY is not set',
        'See https://docs.typesafe.ai/introduction/quickstart, add the key to .env, or run with --offline to see demo data.',
      );
    }
    this.client = new TypeSafeClient({
      apiKey,
      defaultModel: this.model,
      logLevel: 'warn', // never 'debug': it logs request bodies (DECISIONS D5)
      retry: { maxRetries: 0 },
      ...(this.opts.timeoutMs ? { timeout: this.opts.timeoutMs } : {}),
      ...(this.opts.baseURL ? { baseURL: this.opts.baseURL } : {}),
      ...(this.opts.fetch ? { fetch: this.opts.fetch } : {}),
    });
    return this.client;
  }

  async ask<Q extends Questions>(
    meta: CallMeta,
    state: EntryType,
    questions: Q,
    opts: AskOptions = {},
  ): Promise<JevResult<Q>> {
    let currentState = state;
    let currentQuestions: Questions = questions;
    let shrinks = 0;
    const shrink = (why: string) => {
      shrinks++;
      const next = shrinks <= 3 ? opts.shrink?.(shrinks) : null;
      if (!next)
        throw new ProviderError(
          'jev',
          'overflow',
          `${why}; could not shrink ${meta.kind} ${meta.targetId} further`,
        );
      currentState = next.state;
      currentQuestions = next.questions;
    };
    for (;;) {
      const t = requestTokens(currentState, currentQuestions);
      if (t.state <= this.maxState && t.total <= this.maxRequest) break;
      shrink(`request estimated at ${t.total} tokens (state ${t.state})`);
    }
    for (;;) {
      try {
        return await this.send(meta, currentState, currentQuestions as Q, opts);
      } catch (e) {
        if (e instanceof ProviderError && e.kind === 'overflow' && shrinks < 3) {
          shrink('the API rejected the request as too large');
          continue;
        }
        throw e;
      }
    }
  }

  private async send<Q extends Questions>(
    meta: CallMeta,
    state: EntryType,
    questions: Q,
    opts: AskOptions,
  ): Promise<JevResult<Q>> {
    const tokens = requestTokens(state, questions).total;
    this.opts.costs?.ensure('jev', (tokens * this.opts.pricePerMillionUsd) / 1e6);
    return this.semaphore.run(async () => {
      let validationRetries = 0;
      for (;;) {
        const res = await withRetry(
          async () => {
            await this.limiter.acquire(tokens);
            try {
              return await this.getClient().systemOne(
                { state, questions, model: this.model },
                { retry: { maxRetries: 0 }, ...(opts.signal ? { signal: opts.signal } : {}) },
              );
            } catch (e) {
              throw classifyJevError(e);
            }
          },
          {
            ...this.opts.retry,
            onRetry: (err, attempt, delay) =>
              this.logger.warn(
                {
                  provider: 'jev',
                  kind: meta.kind,
                  target: meta.targetId,
                  reviewId: meta.reviewId,
                  error: err.kind,
                  attempt,
                  delay,
                },
                'retrying jev call',
              ),
          },
        );
        const inputTokens = res.usage.input_tokens;
        const costUsd = (inputTokens * this.opts.pricePerMillionUsd) / 1e6;
        this.opts.costs?.addJev(inputTokens, costUsd);
        this.logger.info(
          {
            provider: 'jev',
            kind: meta.kind,
            target: meta.targetId,
            reviewId: meta.reviewId,
            model: res.model,
            inputTokens,
            costUsd,
          },
          'jev call',
        );
        try {
          validateAnswers(questions, res.answers);
        } catch (e) {
          if (validationRetries++ < 1) continue;
          throw e;
        }
        return {
          answers: res.answers as unknown as JevAnswers<Q>,
          model: res.model,
          usage: { inputTokens, outputTokens: res.usage.output_tokens },
          costUsd,
          cached: false,
        };
      }
    });
  }
}
