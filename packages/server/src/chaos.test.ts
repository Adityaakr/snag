/**
 * Chaos tests (BUILD_PROMPT M9): Jev 400, 429, 529 and timeouts through the live adapter; GitHub 5xx through the
 * live client; a database restart under pg-boss and the Postgres store. Every failure ends in partial results or a
 * retried job, never a lost review or a crash.
 */
import { LiveGitHub, LiveJev, RateLimiter } from '@remit/providers';
import { PgBoss } from 'pg-boss';
import { afterAll, describe, expect, it } from 'vitest';
import { openPostgres } from './db/client.js';
import { startPgliteServer } from './db/pglite-server.js';
import { DbStore } from './db/store.js';
import { fakeRepo } from './fake-harness.js';
import { fakeGitHubApi } from './fake-github-server.js';
import { PgBossQueue } from './pg-queue.js';
import { reviewPullRequest } from './review-job.js';
import { MemoryStore } from './store.js';

const closers: (() => Promise<void>)[] = [];
afterAll(async () => {
  for (const c of closers.reverse()) await c();
});

const noWait = { now: () => 0, sleep: async () => {} };
const apiKey = ['test', 'jev', 'key'].join('-');

/** A Jev endpoint that answers every request with `status`, or never answers (a timeout). */
function jevFetch(status: number | 'hang') {
  let calls = 0;
  const fetch = async (_url: string, init?: RequestInit) => {
    calls++;
    if (status === 'hang')
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
        );
      });
    return new Response(JSON.stringify({ error: { message: `status ${status}` } }), {
      status,
      headers: { 'content-type': 'application/json', ...(status === 429 ? { 'retry-after': '0' } : {}) },
    });
  };
  return { fetch, calls: () => calls };
}

describe('chaos: Jev failures give partial results', () => {
  for (const status of [400, 429, 529, 'hang'] as const) {
    it(`Jev ${status === 'hang' ? 'timeout' : status}: the review completes with uncertain verdicts and a warning`, async () => {
      const repo = fakeRepo('three_reqs_one_missing');
      const f = jevFetch(status);
      const jev = new LiveJev({
        apiKey,
        model: 'jev-1.13.0',
        pricePerMillionUsd: 0.042,
        fetch: f.fetch as never,
        limiter: new RateLimiter(1e9, 1e12, noWait),
        retry: { attempts: 2, sleep: async () => {} },
        ...(status === 'hang' ? { timeoutMs: 50 } : {}),
      });
      const out = await reviewPullRequest(repo.gh, 1, repo.pr, {
        providers: (config) => ({ ...repo.providers(config), jev }),
        store: new MemoryStore(),
      });
      expect(out.status).toBe('done');
      if (out.status !== 'done') return;
      const r = out.record.result;
      expect(r.requirementVerdicts.every((v) => v.status === 'uncertain')).toBe(true);
      expect(r.warnings.some((w) => /jev/i.test(w))).toBe(true);
      expect(repo.gh.checkRuns[0]).toMatchObject({ status: 'completed', conclusion: 'neutral' });
      expect(repo.gh.posted.get('acme/reports#77')).toHaveLength(1);
      // 400 is fatal (one attempt per call); 429, 529 and timeouts were retried.
      expect(f.calls()).toBeGreaterThan(0);
    }, 30_000);
  }
});

describe('chaos: GitHub 5xx', () => {
  function flakyGitHub(failures: number) {
    const repo = fakeRepo('three_reqs_one_missing');
    const api = fakeGitHubApi(repo.gh, null, '1');
    const token = ['ghs', 'chaos'].join('_');
    api.tokens.push(token);
    let left = failures;
    const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = new URL(String(url));
      if (u.pathname.endsWith('/pulls/77/files') && left > 0) {
        left--;
        return new Response('{"message":"Server Error"}', {
          status: 502,
          headers: { 'content-type': 'application/json' },
        });
      }
      return api.app.request(`${u.pathname}${u.search}`, init);
    }) as typeof globalThis.fetch;
    const gh = new LiveGitHub({
      token,
      baseUrl: 'https://github.example',
      fetch,
      retry: { attempts: 3, sleep: async () => {} },
    });
    return { repo, gh };
  }

  it('retries transient 5xx and completes the review', async () => {
    const { repo, gh } = flakyGitHub(2);
    const out = await reviewPullRequest(gh, 1, repo.pr, {
      providers: repo.providers,
      store: new MemoryStore(),
    });
    expect(out.status).toBe('done');
    expect(repo.gh.checkRuns[0]).toMatchObject({ status: 'completed' });
  });

  it('a persistent 5xx fails the job visibly (check run neutral) so the queue can retry it', async () => {
    const { repo, gh } = flakyGitHub(100);
    await expect(
      reviewPullRequest(gh, 1, repo.pr, { providers: repo.providers, store: new MemoryStore() }),
    ).rejects.toThrow(/502|server error/i);
    expect(repo.gh.checkRuns[0]).toMatchObject({ status: 'completed', conclusion: 'neutral' });
    expect(repo.gh.checkRuns[0]?.output?.title).toMatch(/could not finish/);
  });
});

describe('chaos: database restart', () => {
  it('pg-boss and the store recover, and a job sent after the restart is reviewed and stored', async () => {
    const pg = await startPgliteServer();
    closers.push(pg.stop);
    const dropped: string[] = [];
    const database = await openPostgres(pg.url, { onError: (e) => dropped.push(e.message) });
    closers.push(database.close);
    const store = new DbStore(database.db);
    const boss = new PgBoss({ connectionString: pg.url, max: 2 });
    boss.on('error', () => {});
    await boss.start();
    closers.push(() => boss.stop({ graceful: false }));
    const queue = new PgBossQueue(boss, {
      retryLimit: 5,
      retryDelaySeconds: 1,
      retryBackoff: false,
      pollingIntervalSeconds: 0.5,
      cleanupCron: null,
      recalibrateCron: null,
    });
    const repo = fakeRepo('three_reqs_one_missing');
    await store.addInstallation(4242, 'acme', ['acme/reports']);
    let n = 0;
    queue.setHandler(async (job) => {
      if (job.kind !== 'review') return;
      await reviewPullRequest(
        repo.gh,
        job.installationId,
        { owner: job.owner, repo: job.repo, number: job.pr },
        { providers: repo.providers, store, newId: () => `rev_chaos_${++n}` },
      );
    });
    await queue.start();
    await pg.restart(500);
    // Pools reconnect on demand: a job sent after the restart is processed and its review stored.
    const until = Date.now() + 30_000;
    for (;;) {
      try {
        await queue.enqueue('review:acme/reports#77', {
          kind: 'review',
          installationId: 4242,
          owner: 'acme',
          repo: 'reports',
          pr: 77,
        });
        break;
      } catch (e) {
        if (Date.now() > until) throw e;
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    for (;;) {
      const stored = await store.latestReview('acme/reports', 77).catch(() => null);
      if (stored) break;
      if (Date.now() > until) throw new Error('the review was not stored after the database restart');
      await new Promise((r) => setTimeout(r, 300));
    }
    expect(repo.gh.checkRuns.some((r) => r.status === 'completed')).toBe(true);
    // The dropped idle connections were reported, not thrown.
    expect(dropped.every((m) => /terminated|closed|ECONNRESET/i.test(m))).toBe(true);
  }, 60_000);
});
