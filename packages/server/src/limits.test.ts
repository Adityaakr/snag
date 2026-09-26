import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { MemoryDeliveryStore } from './deliveries.js';
import { RATE_LIMITED_DEBOUNCE_MS } from './events.js';
import { fakeRepo } from './fake-harness.js';
import { Metrics } from './metrics.js';
import { MemoryQueue } from './queue.js';
import { reviewPullRequest } from './review-job.js';
import { MemoryStore } from './store.js';
import { signBody } from './webhook-verify.js';

describe('per-installation daily budget', () => {
  it('reserves the per-review maximum, skips past the budget with a neutral check run, and reviews under it', async () => {
    const store = new MemoryStore();
    const repo = fakeRepo('three_reqs_one_missing');
    const metrics = new Metrics();
    const first = await reviewPullRequest(repo.gh, 7, repo.pr, {
      providers: repo.providers,
      store,
      dailyBudgetUsd: 1,
      metrics,
    });
    expect(first.status).toBe('done');
    // The reservation (max_usd_per_review, 0.50) was settled to the real spend (the fakes cost nothing).
    expect(await store.spendToday(7)).toBe(0);
    // Earlier spend today: 0.60. A new review reserves 0.50, which would pass the 1.00 budget, so it is skipped.
    await store.reserveSpend(7, 'rev_earlier', 0.6);
    const second = await reviewPullRequest(repo.gh, 7, repo.pr, {
      providers: repo.providers,
      store,
      dailyBudgetUsd: 1,
      metrics,
    });
    expect(second).toEqual({ status: 'skipped', reason: 'daily budget reached' });
    expect(repo.gh.checkRuns.at(-1)).toMatchObject({
      status: 'completed',
      conclusion: 'neutral',
      output: { title: 'Daily budget reached' },
    });
    expect(metrics.render()).toContain('remit_budget_skips_total 1');
    expect(await store.spendToday(7)).toBeCloseTo(0.6);
    // Another installation is not affected.
    expect(
      (await reviewPullRequest(repo.gh, 8, repo.pr, { providers: repo.providers, store, dailyBudgetUsd: 1 }))
        .status,
    ).toBe('done');
    expect(await store.spendToday(7, new Date(Date.now() + 2 * 86_400_000))).toBe(0);
  });

  it('counts the spend of a failed review, so retries and failures cannot spend past the budget', async () => {
    const store = new MemoryStore();
    const repo = fakeRepo('three_reqs_one_missing');
    const { CostTracker } = await import('@remit/providers');
    const failing = fakeRepo('three_reqs_one_missing');
    // Fails after the providers spent: posting the sticky comment breaks.
    failing.gh.createIssueComment = async () => {
      throw new Error('socket hang up');
    };
    const charged = (config: Parameters<typeof repo.providers>[0]) => {
      const costs = new CostTracker(10);
      costs.addJev(1000, 0.7);
      return { ...failing.providers(config), costs };
    };
    await expect(
      reviewPullRequest(failing.gh, 7, failing.pr, { providers: charged, store, dailyBudgetUsd: 1 }),
    ).rejects.toThrow('socket');
    expect(await store.spendToday(7)).toBeCloseTo(0.7);
    const next = await reviewPullRequest(repo.gh, 7, repo.pr, {
      providers: repo.providers,
      store,
      dailyBudgetUsd: 1,
    });
    expect(next).toEqual({ status: 'skipped', reason: 'daily budget reached' });
  });
});

describe('per-installation review rate', () => {
  it('delays events past the hourly rate instead of dropping them', async () => {
    const delays: number[] = [];
    const queue = new MemoryQueue({
      setTimer: (fn, ms) => {
        delays.push(ms);
        return setTimeout(fn, 0);
      },
    });
    const repo = fakeRepo('three_reqs_one_missing');
    const metrics = new Metrics();
    const secret = ['rate', 'secret'].join('-');
    const app = createApp({
      webhookSecret: secret,
      deliveries: new MemoryDeliveryStore(),
      metrics,
      queue,
      store: new MemoryStore(),
      github: async () => repo.gh,
      providers: repo.providers,
      debounceMs: 0,
      reviewsPerHour: 2,
    });
    const body = readFileSync(
      join(import.meta.dirname, '..', '..', '..', 'fixtures', 'webhooks', 'pull_request.opened.json'),
      'utf8',
    );
    for (let i = 0; i < 3; i++)
      await app.request('/webhooks', {
        method: 'POST',
        body,
        headers: {
          'x-github-event': 'pull_request',
          'x-github-delivery': `r${i}`,
          'x-hub-signature-256': signBody(secret, body),
        },
      });
    expect(delays).toEqual([0, 0, RATE_LIMITED_DEBOUNCE_MS]);
    expect(metrics.render()).toContain('remit_reviews_delayed_total 1');
    await queue.idle();
  });
});
