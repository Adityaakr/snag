import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { fakeRepo } from '../fake-harness.js';
import { reviewPullRequest } from '../review-job.js';
import { CostTracker } from '@remit/providers';
import { MemoryStore, type ReviewRecord, type Store } from '../store.js';
import { openPglite } from './client.js';
import { NOT_RETAINED, redactResult } from './redact.js';
import { DbStore } from './store.js';

const closers: (() => Promise<void>)[] = [];
afterAll(async () => {
  for (const c of closers) await c();
});

async function dbStore() {
  const d = await openPglite();
  closers.push(d.close);
  return { store: new DbStore(d.db), d };
}

async function reviewed(store: Store, config?: string) {
  const repo = fakeRepo('three_reqs_one_missing', config ? { config } : {});
  await store.addInstallation(4242, 'acme', ['acme/reports']);
  const out = await reviewPullRequest(repo.gh, 4242, repo.pr, {
    providers: repo.providers,
    store,
    newId: () => 'rev_db1',
  });
  if (out.status !== 'done') throw new Error('review failed');
  return out.record;
}

describe.each([
  ['memory', async () => ({ store: new MemoryStore() as Store })],
  ['postgres (PGlite)', async () => ({ store: (await dbStore()).store as Store })],
])('Store contract: %s', (_name, make) => {
  it('saves and returns the latest review, checklists, feedback and installations', async () => {
    const { store } = await make();
    const record = await reviewed(store);
    const latest = await store.latestReview('acme/reports', 77);
    expect(latest?.id).toBe(record.id);
    expect(latest?.result.findings.map((f) => f.id)).toEqual(record.result.findings.map((f) => f.id));
    expect(await store.latestReview('acme/reports', 1)).toBeNull();

    await store.saveChecklist({
      repo: 'acme/reports',
      issue: 12,
      contentHash: 'h1',
      requirements: record.result.requirements,
    });
    await store.saveChecklist({
      repo: 'acme/reports',
      issue: 12,
      contentHash: 'h1',
      requirements: record.result.requirements,
      confirmedBy: 'maya',
      confirmedAt: '2026-09-27T00:00:00.000Z',
    });
    expect(await store.getChecklist('acme/reports', 12)).toMatchObject({
      contentHash: 'h1',
      confirmedBy: 'maya',
    });
    await store.deleteChecklist('acme/reports', 12);
    expect(await store.getChecklist('acme/reports', 12)).toBeNull();

    const f = record.result.findings[0];
    if (!f) throw new Error('no finding');
    await store.addFeedback({
      repo: 'acme/reports',
      pr: 77,
      findingId: f.id,
      contentKey: f.contentKey,
      login: 'dev',
      label: 'agree',
      source: 'slash',
      createdAt: '2026-09-27T00:00:00.000Z',
    });
    expect(await store.feedback('acme/reports', 77)).toMatchObject([
      { findingId: f.id, label: 'agree', login: 'dev' },
    ]);

    expect(await store.installationOf('acme/reports')).toBe(4242);
    await store.setRepositories(4242, ['acme/other'], ['acme/other']);
    await store.deleteInstallation(4242);
    expect(await store.installationOf('acme/reports')).toBeNull();
    expect(await store.latestReview('acme/reports', 77)).toBeNull();
    expect(await store.feedback('acme/reports', 77)).toEqual([]);
  });
});

describe('DbStore', () => {
  it('applies every 10.4 table in the migration', async () => {
    const { d } = await dbStore();
    const rows = await d.db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = 'public' order by 1`,
    );
    const names = (rows as unknown as { rows: { table_name: string }[] }).rows.map((r) => r.table_name);
    expect(names).toEqual(
      expect.arrayContaining([
        'installations',
        'repositories',
        'deliveries',
        'reviews',
        'requirements',
        'units',
        'findings',
        'facts',
        'feedback',
        'confirmed_checklists',
        'calibrations',
        'eval_runs',
        'api_calls',
        'payloads',
      ]),
    );
  });

  it('dedupes deliveries across instances and releases claims', async () => {
    const { store } = await dbStore();
    expect(await store.claim('d1')).toBe(true);
    expect(await store.claim('d1')).toBe(false);
    await store.release('d1');
    expect(await store.claim('d1')).toBe(true);
    await store.pruneDeliveries(0, new Date(Date.now() + 1000));
    expect(await store.claim('d1')).toBe(true);
  });

  it('keeps no issue text by default, and retains payloads with a TTL when configured', async () => {
    const plain = (await dbStore()).store;
    const r1 = await reviewed(plain);
    const stored = await plain.latestReview('acme/reports', 77);
    expect(stored?.result.requirements.every((q) => q.quote === NOT_RETAINED)).toBe(true);
    expect(JSON.stringify(stored?.result)).not.toContain(r1.result.requirements[0]?.quote ?? 'x');
    expect(await plain.exportable()).toEqual([]);

    const kept = (await dbStore()).store;
    const r2 = await reviewed(kept, 'retention:\n  retain_payloads: true\n  retention_days: 2\n');
    expect((await kept.latestReview('acme/reports', 77))?.result.requirements[0]?.quote).toBe(
      r2.result.requirements[0]?.quote,
    );
    const f = r2.result.findings[0] as NonNullable<(typeof r2.result.findings)[0]>;
    await kept.addFeedback({
      repo: 'acme/reports',
      pr: 77,
      findingId: f.id,
      contentKey: f.contentKey,
      login: 'dev',
      label: 'disagree',
      source: 'dashboard',
      createdAt: new Date().toISOString(),
    });
    const exp = await kept.exportable([4242]);
    expect(exp).toHaveLength(1);
    expect(exp[0]?.input.diffText).toContain('diff --git');
    expect(await kept.agreementByType([4242])).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: 'disagree', n: 1 })]),
    );
    const cal = await kept.recalibrateFromFeedback('jev-1.13.0', 'qs-0.1.0');
    expect(cal.n).toBe(1);
    expect(cal.p0Precision === null || (cal.p0Precision >= 0 && cal.p0Precision <= 1)).toBe(true);
    expect((await kept.recalibrateFromFeedback('jev-1.13.0', 'qs-0.1.0')).n).toBe(1);
    // After the TTL, the cleanup job deletes payloads and text columns.
    expect(await kept.cleanup(new Date(Date.now() + 3 * 86_400_000))).toEqual({ payloads: 2 });
    expect((await kept.latestReview('acme/reports', 77))?.result.requirements[0]?.quote).toBe(NOT_RETAINED);
    expect(await kept.exportable()).toEqual([]);
  });

  it('lists reviews for authorized installations with filters', async () => {
    const { store } = await dbStore();
    await reviewed(store);
    expect(await store.listReviews({ installationIds: [] })).toEqual([]);
    expect(await store.listReviews({ installationIds: [1] })).toEqual([]);
    const rows = await store.listReviews({
      installationIds: [4242],
      hasP0: true,
      repo: 'acme/reports',
      status: 'done',
      since: new Date(0),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ repo: 'acme/reports', prNumber: 77, hasP0: true });
    expect(await store.getReview(rows[0]?.id ?? '')).toMatchObject({ pr: 77, installationId: 4242 });
    expect(await store.getReview('nope')).toBeNull();
    await store.saveEvalRun({
      id: 'run1',
      corpus: 'mutations',
      split: 'dev',
      gitSha: 'abc',
      questionSet: 'qs-0.1.0',
      metrics: {},
    });
    expect((await store.evalRuns()).map((r) => r.id)).toEqual(['run1']);
    expect(await store.repositoriesOf([4242])).toHaveLength(1);
    expect((await store.installations()).map((i) => i.id)).toEqual([4242]);
  });
});

describe('redactResult', () => {
  it('removes quotes, reason text, claim sentences and fact details', async () => {
    const r = (await reviewed(new MemoryStore())) as ReviewRecord;
    const red = redactResult(r.result);
    expect(red.findings.every((f) => f.reasons.every((x) => x.text === x.template))).toBe(true);
    expect(red.units.every((u) => u.facts.every((f) => f.detail === f.kind))).toBe(true);
    expect(r.result.requirements[0]?.quote).not.toBe(NOT_RETAINED);
  });
});

describe('DbStore data minimization and records', () => {
  it('stores no code by default: no patches, judge views or before/after text', async () => {
    const { store } = await dbStore();
    const r = await reviewed(store);
    const stored = await store.latestReview('acme/reports', 77);
    const text = JSON.stringify(stored?.result);
    for (const u of r.result.units) {
      if (u.patch) expect(text.includes(u.patch)).toBe(false);
      expect(stored?.result.units.find((x) => x.id === u.id)).toMatchObject({ patch: '', judgeView: '' });
    }
    expect(text).not.toContain('+import');
    expect(text).not.toContain('diff --git');
  });

  it('persists per-call usage and the effective config', async () => {
    const { store, d } = await dbStore();
    const repo = fakeRepo('three_reqs_one_missing', { config: 'mode: rework\n' });
    await store.addInstallation(4242, 'acme', ['acme/reports']);
    const out = await reviewPullRequest(repo.gh, 4242, repo.pr, {
      providers: (config) => {
        const p = repo.providers(config);
        const costs = new CostTracker(1);
        costs.addJev(100, 0.001, {
          provider: 'jev',
          model: 'jev-1.13.0',
          kind: 'forward',
          requestHash: 'h1',
          latencyMs: 12,
        });
        return { ...p, costs };
      },
      store,
      newId: () => 'rev_calls',
    });
    expect(out.status).toBe('done');
    expect(await store.apiCallsFor('rev_calls')).toEqual([
      expect.objectContaining({
        provider: 'jev',
        kind: 'forward',
        inputTokens: 100,
        requestHash: 'h1',
        status: 'ok',
      }),
    ]);
    const [repoRow] = await store.repositoriesOf([4242]);
    expect(repoRow?.configHash).toMatch(/^[0-9a-f]{32}$/);
    expect((repoRow?.config as { mode?: string } | null)?.mode).toBe('rework');
    void d;
  });

  it('imports eval runs from report directories once', async () => {
    const { store } = await dbStore();
    const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'remit-reports-'));
    mkdirSync(join(dir, 'run-a'));
    writeFileSync(
      join(dir, 'run-a', 'metrics.json'),
      JSON.stringify({
        info: { corpus: 'mutations', split: 'dev', gitSha: 'abc', startedAt: '2026-09-26T00:00:00Z' },
        metrics: { ops: { costTotal: 0.5 } },
      }),
    );
    mkdirSync(join(dir, 'broken'));
    writeFileSync(join(dir, 'broken', 'metrics.json'), '{not json');
    expect(await store.importEvalRuns(dir)).toBe(1);
    expect(await store.importEvalRuns(dir)).toBe(0);
    expect(await store.importEvalRuns(join(dir, 'missing'))).toBe(0);
    expect((await store.evalRuns())[0]).toMatchObject({ id: 'run-a', corpus: 'mutations', costUsd: 0.5 });
  });
});
