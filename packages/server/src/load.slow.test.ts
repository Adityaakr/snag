/**
 * Load test with fakes (BUILD_PROMPT M9): 50 concurrent PR events against the app with Postgres (PGlite), the
 * pg-boss queue and a fake GitHub. Records p50 and p95 time from webhook to stored review, and the error rate.
 * The summary is written to REMIT_LOAD_OUT (default: the OS temp dir) and recorded in docs/operations.md.
 * The pg-boss queue and the Postgres store run on PGlite; see the note in the test.
 */
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { PgBoss } from 'pg-boss';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { openPglite } from './db/client.js';
import { startPgliteServer } from './db/pglite-server.js';
import { DbStore } from './db/store.js';
import { fakeRepo } from './fake-harness.js';
import { Metrics } from './metrics.js';
import { PgBossQueue } from './pg-queue.js';
import { signBody } from './webhook-verify.js';

const EVENTS = 50;
const closers: (() => Promise<void>)[] = [];
afterAll(async () => {
  for (const c of closers.reverse()) await c();
});

const pct = (xs: number[], q: number) =>
  [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(q * xs.length))] ?? 0;

describe('load test', () => {
  it(`handles ${EVENTS} concurrent PR events`, async () => {
    // The store runs on in-process PGlite (it serializes transactions itself) and pg-boss on its own PGlite socket
    // with one connection: PGlite serves every socket connection in one session, so concurrent transactions from
    // several connections would collide there, unlike in Postgres. Job handlers still run 8 at a time.
    const pg = await startPgliteServer();
    closers.push(pg.stop);
    const database = await openPglite();
    closers.push(database.close);
    const done = new Map<number, number>();
    // Records when each review is stored, to measure webhook-to-review latency.
    class TimedStore extends DbStore {
      override async saveReview(r: Parameters<DbStore['saveReview']>[0]) {
        await super.saveReview(r);
        done.set(r.pr, Date.now());
      }
    }
    const store = new TimedStore(database.db);
    const boss = new PgBoss({ connectionString: pg.url, max: 1 });
    boss.on('error', () => {});
    await boss.start();
    closers.push(() => boss.stop({ graceful: false }));
    let errors = 0;
    const messages: string[] = [];
    const queue = new PgBossQueue(boss, {
      concurrency: 8,
      retryLimit: 0,
      pollingIntervalSeconds: 0.5,
      cleanupCron: null,
      recalibrateCron: null,
      hooks: {
        onError: (_k, e) => {
          errors++;
          messages.push((e as Error).message);
        },
      },
    });
    const repo = fakeRepo('three_reqs_one_missing');
    const base = repo.gh.pulls.get('acme/reports#77');
    if (!base) throw new Error('fixture');
    for (let n = 1; n <= EVENTS; n++)
      repo.gh.addPull({ owner: 'acme', repo: 'reports', number: 1000 + n }, { ...base, headSha: 'head0000' });
    await store.addInstallation(4242, 'acme', ['acme/reports']);
    const secret = ['load', 'secret'].join('-');
    const sent = new Map<number, number>();
    const app = createApp({
      webhookSecret: secret,
      deliveries: store,
      metrics: new Metrics(),
      queue,
      store,
      github: async () => repo.gh,
      providers: repo.providers,
      debounceMs: 0,
    });
    await queue.start();
    const fixture = JSON.parse(
      readFileSync(
        join(import.meta.dirname, '..', '..', '..', 'fixtures', 'webhooks', 'pull_request.opened.json'),
        'utf8',
      ),
    );
    const started = Date.now();
    const responses = await Promise.all(
      Array.from({ length: EVENTS }, async (_, i) => {
        const pr = 1001 + i;
        const body = JSON.stringify({
          ...fixture,
          number: pr,
          pull_request: { ...fixture.pull_request, number: pr },
        });
        sent.set(pr, Date.now());
        return app.request('/webhooks', {
          method: 'POST',
          body,
          headers: {
            'x-github-event': 'pull_request',
            'x-github-delivery': `load-${pr}`,
            'x-hub-signature-256': signBody(secret, body),
          },
        });
      }),
    );
    const accepted = responses.filter((r) => r.status === 202).length;
    const until = Date.now() + 240_000;
    while (done.size + errors < accepted && Date.now() < until) await new Promise((r) => setTimeout(r, 200));
    const latencies = [...done.entries()].map(([pr, t]) => t - (sent.get(pr) ?? started));
    const summary = {
      events: EVENTS,
      accepted,
      reviewed: done.size,
      errors: errors + (EVENTS - accepted),
      errorRate: (errors + (EVENTS - accepted)) / EVENTS,
      p50Ms: pct(latencies, 0.5),
      p95Ms: pct(latencies, 0.95),
      totalMs: Date.now() - started,
      messages: [...new Set(messages)].slice(0, 5),
    };
    writeFileSync(
      process.env.REMIT_LOAD_OUT ?? join(tmpdir(), 'remit-load.json'),
      `${JSON.stringify(summary, null, 2)}\n`,
    );
    expect(summary.errorRate).toBe(0);
    expect(summary.reviewed).toBe(EVENTS);
  }, 300_000);
});
