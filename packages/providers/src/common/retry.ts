import { ProviderError } from './errors.js';

export interface RetryOptions {
  /** Total attempts including the first. Default 5 (BUILD_PROMPT 7.3). */
  attempts?: number;
  baseMs?: number;
  maxMs?: number;
  /** Returns a number in [0, 1); injectable for tests. */
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (error: ProviderError, attempt: number, delayMs: number) => void;
}

export const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Delay before retry `attempt` (1-based): exponential with full jitter, or the server's retry-after when given. */
export function backoffDelay(attempt: number, opts: RetryOptions, retryAfterMs?: number): number {
  if (retryAfterMs !== undefined && retryAfterMs >= 0) return Math.min(retryAfterMs, 60_000);
  const base = opts.baseMs ?? 500;
  const cap = opts.maxMs ?? 20_000;
  const exp = Math.min(cap, base * 2 ** (attempt - 1));
  const r = (opts.random ?? Math.random)();
  return Math.round(exp / 2 + (r * exp) / 2);
}

/** Runs `fn`, retrying retryable ProviderErrors with backoff. Non-retryable errors are thrown at once. */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 5;
  const sleep = opts.sleep ?? realSleep;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (e) {
      if (!(e instanceof ProviderError) || !e.retryable || attempt >= attempts) throw e;
      const delay = backoffDelay(attempt, opts, e.retryAfterMs);
      opts.onRetry?.(e, attempt, delay);
      await sleep(delay);
    }
  }
}
