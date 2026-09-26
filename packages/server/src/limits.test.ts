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
  it('skips a review past the budget with a neutral check run, and reviews under it', async () => {
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
    // Pretend today's reviews spent the budget.
    const r = store.reviews[0];
    if (r) r.result.usage.costUsd = 1;
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
    // Another installation is not affected.
    expect(
      (await reviewPullRequest(repo.gh, 8, repo.pr, { providers: repo.providers, store, dailyBudgetUsd: 1 }))
        .status,
    ).toBe('done');
    expect(await store.spendToday(7, new Date(Date.now() + 2 * 86_400_000))).toBe(0);
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
