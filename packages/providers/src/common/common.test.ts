import { describe, expect, it } from 'vitest';
import { CostTracker } from './budget.js';
import { BudgetExceededError, ProviderError } from './errors.js';
import { type Clock, RateLimiter, Semaphore } from './limits.js';
import { backoffDelay, withRetry } from './retry.js';

function fakeClock() {
  let t = 0;
  const sleeps: number[] = [];
  const clock: Clock = {
    now: () => t,
    sleep: async (ms) => {
      sleeps.push(ms);
      t += ms;
    },
  };
  return { clock, sleeps, advance: (ms: number) => (t += ms) };
}

describe('RateLimiter', () => {
  it('lets a burst through, then waits for refill (requests per minute)', async () => {
    const { clock, sleeps } = fakeClock();
    const rl = new RateLimiter(60, 1e9, clock);
    for (let i = 0; i < 60; i++) await rl.acquire(1);
    expect(sleeps).toEqual([]);
    await rl.acquire(1);
    expect(sleeps).toEqual([1000]);
  });

  it('waits for token capacity (tokens per second)', async () => {
    const { clock, sleeps } = fakeClock();
    const rl = new RateLimiter(1e6, 1000, clock);
    await rl.acquire(1000);
    await rl.acquire(500);
    expect(sleeps).toEqual([500]);
  });

  it('caps oversized requests at the bucket size instead of waiting forever', async () => {
    const { clock } = fakeClock();
    const rl = new RateLimiter(10, 100, clock);
    await expect(rl.acquire(10_000)).resolves.toBeUndefined();
  });
});

describe('Semaphore', () => {
  it('never runs more than its size at once', async () => {
    const s = new Semaphore(2);
    let active = 0;
    let max = 0;
    await Promise.all(
      Array.from({ length: 6 }, () =>
        s.run(async () => {
          active++;
          max = Math.max(max, active);
          await new Promise((r) => setTimeout(r, 2));
          active--;
        }),
      ),
    );
    expect(max).toBe(2);
  });
});

describe('withRetry', () => {
  it('retries retryable errors and returns the eventual result', async () => {
    let n = 0;
    const r = await withRetry(
      async () => {
        if (++n < 3) throw new ProviderError('x', 'server', 'boom');
        return 'ok';
      },
      { sleep: async () => {} },
    );
    expect([r, n]).toEqual(['ok', 3]);
  });

  it('does not retry fatal errors', async () => {
    let n = 0;
    await expect(
      withRetry(async () => {
        n++;
        throw new ProviderError('x', 'auth', 'no');
      }),
    ).rejects.toThrow('x: no');
    expect(n).toBe(1);
  });

  it('computes jittered exponential delays and honors retry-after up to a minute', () => {
    expect(backoffDelay(1, { random: () => 0 })).toBe(250);
    expect(backoffDelay(3, { random: () => 0.999 })).toBe(1999);
    expect(backoffDelay(10, { random: () => 0.5, maxMs: 4000 })).toBe(3000);
    expect(backoffDelay(1, {}, 1234)).toBe(1234);
    expect(backoffDelay(1, {}, 999_999)).toBe(60_000);
  });
});

describe('CostTracker', () => {
  it('accumulates Jev and LLM usage and enforces the limit', () => {
    const c = new CostTracker(0.1);
    c.addJev(1000, 0.04);
    c.addLlm(100, 50, 0.05);
    expect(c.usage).toEqual({
      jevInputTokens: 1000,
      llmInputTokens: 100,
      llmOutputTokens: 50,
      costUsd: 0.09,
      calls: 2,
    });
    expect(() => c.ensure('jev', 0.005)).not.toThrow();
    expect(() => c.ensure('jev', 0.02)).toThrow(BudgetExceededError);
    expect(c.exceeded).toBe(false);
    c.addJev(0, 0.02);
    expect(c.exceeded).toBe(true);
  });
});
