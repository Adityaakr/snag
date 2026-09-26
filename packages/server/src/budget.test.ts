import { defaultConfig } from '@remit/core';
import { CostTracker } from '@remit/providers';
import { describe, expect, it } from 'vitest';
import { reserveBudget } from './budget.js';
import { postChecklist } from './checklist.js';
import { fakeRepo } from './fake-harness.js';
import { silent } from './logger.js';
import { MemoryStore } from './store.js';

describe('reserveBudget', () => {
  it('is a no-op without a budget, and caps the per-run limit at a quarter of the budget', async () => {
    const store = new MemoryStore();
    const none = await reserveBudget(store, undefined, 1, 'r0', defaultConfig(), silent);
    expect(none).not.toBe('over');
    const r = await reserveBudget(store, 1, 1, 'r1', defaultConfig(), silent);
    if (r === 'over') throw new Error('over');
    expect(r.config.budgets.max_usd_per_review).toBe(0.25);
    expect(await store.spendToday(1)).toBe(0.25);
    await r.settle(0.1);
    expect(await store.spendToday(1)).toBeCloseTo(0.1);
  });

  it('settles the reservation when the budget check itself fails, and never throws from settle', async () => {
    const store = new MemoryStore();
    store.spendToday = async () => {
      throw new Error('database down');
    };
    await expect(reserveBudget(store, 1, 1, 'r1', defaultConfig(), silent)).rejects.toThrow('database down');
    expect(store.ledger[0]?.amountUsd).toBe(0);
    const ok = new MemoryStore();
    const r = await reserveBudget(ok, 1, 1, 'r2', defaultConfig(), silent);
    if (r === 'over') throw new Error('over');
    ok.settleSpend = async () => {
      throw new Error('database down');
    };
    await expect(r.settle(0.1)).resolves.toBeUndefined();
  });
});

describe('non-finite costs fail closed', () => {
  it('a NaN cost keeps the full reservation, and a NaN ledger total counts as over budget', async () => {
    const store = new MemoryStore();
    const r = await reserveBudget(store, 1, 1, 'r1', defaultConfig(), silent);
    if (r === 'over') throw new Error('over');
    await r.settle(Number.NaN);
    expect(await store.spendToday(1)).toBe(0.25);
    store.spendToday = async () => Number.NaN;
    expect(await reserveBudget(store, 1, 1, 'r2', defaultConfig(), silent)).toBe('over');
  });

  it('the cost tracker refuses further calls after a NaN or negative cost', () => {
    const t = new CostTracker(1);
    expect(() => t.ensure('x', Number.NaN)).toThrow();
    t.addLlm(10, 10, Number.NaN);
    expect(t.exceeded).toBe(true);
    expect(() => t.ensure('x', 0)).toThrow();
    const j = new CostTracker(1);
    j.addJev(10, -5);
    expect(j.exceeded).toBe(true);
  });
});

describe('issue checklists and the daily budget', () => {
  it('reserve and settle through the ledger, and stop once the budget is spent', async () => {
    const store = new MemoryStore();
    const repo = fakeRepo('three_reqs_one_missing');
    const ref = { owner: 'acme', repo: 'reports', number: 12 };
    const first = await postChecklist(
      repo.gh,
      ref,
      { providers: repo.providers, store, dailyBudgetUsd: 1 },
      7,
    );
    expect(first).toHaveProperty('requirements');
    expect(await store.spendToday(7)).toBe(0);
    expect(store.ledger).toHaveLength(1);
    await store.reserveSpend(7, 'earlier', 0.9);
    const second = await postChecklist(
      repo.gh,
      ref,
      { providers: repo.providers, store, dailyBudgetUsd: 1 },
      7,
    );
    expect(second).toEqual({ skipped: 'daily budget reached' });
  });
});
