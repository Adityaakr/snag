/**
 * End to end for M8 (BUILD_PROMPT M8): webhook -> pg-boss job -> review stored in Postgres -> sticky comment ->
 * slash-command feedback -> dashboard sign-in, listing and feedback -> corpus C export.
 */
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PgBoss } from 'pg-boss';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { openPglite } from './db/client.js';
import { startPgliteServer } from './db/pglite-server.js';
import { DbStore } from './db/store.js';
import { shadowRecords, writeShadowCorpus } from './export.js';
import { fakeRepo } from './fake-harness.js';
import { Metrics } from './metrics.js';
import { PgBossQueue } from './pg-queue.js';
import { signBody } from './webhook-verify.js';

const FIXTURES = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'webhooks');
const closers: (() => Promise<void>)[] = [];
afterAll(async () => {
  for (const c of closers.reverse()) await c();
});

describe('M8 end to end', () => {
  it('webhook, job, review, comment, slash feedback, dashboard and export', async () => {
    const db = await openPglite();
    closers.push(db.close);
    const store = new DbStore(db.db);
    const pgServer = await startPgliteServer();
    closers.push(pgServer.stop);
    const boss = new PgBoss({ connectionString: pgServer.url, max: 1 });
    boss.on('error', () => {});
    await boss.start();
    closers.push(() => boss.stop({ graceful: false }));
    const queue = new PgBossQueue(boss, {
      retryLimit: 0,
      pollingIntervalSeconds: 0.5,
      cleanupCron: null,
      recalibrateCron: null,
    });

    const repo = fakeRepo('three_reqs_one_missing', { config: 'retention:\n  retain_payloads: true\n' });
    const secret = ['e2e', 'm8', 'webhook', 'secret'].join('-');
    const sessionSecret = ['e2e', 'm8', 'session', 'secret', 'long', 'enough'].join('-');
    await store.addInstallation(4242, 'acme', ['acme/reports']);
    const app = createApp({
      webhookSecret: secret,
      deliveries: store,
      metrics: new Metrics(),
      queue,
      store,
      github: async () => repo.gh,
      providers: repo.providers,
      debounceMs: 0,
      dashboard: {
        store,
        sessionSecret,
        oauth: { clientId: 'cid', clientSecret: 'cs' },
        publicUrl: 'https://remit.example.com',
        signIn: async () => ({ login: 'maya', installationIds: [4242] }),
        deadLetters: () => queue.deadLetters(),
      },
    });
    await queue.start();

    let n = 0;
    const hook = async (event: string, file: string) => {
      const body = readFileSync(join(FIXTURES, `${file}.json`), 'utf8');
      const res = await app.request('/webhooks', {
        method: 'POST',
        body,
        headers: {
          'x-github-event': event,
          'x-github-delivery': `m8-${++n}`,
          'x-hub-signature-256': signBody(secret, body),
        },
      });
      await queue.idle();
      return res;
    };

    // Webhook -> job -> review -> comment, stored in Postgres.
    expect((await hook('pull_request', 'pull_request.opened')).status).toBe(202);
    expect(repo.gh.checkRuns[0]).toMatchObject({ status: 'completed' });
    expect(repo.gh.posted.get('acme/reports#77')?.[0]?.body).toContain('<!-- remit:summary v1');
    const stored = await store.latestReview('acme/reports', 77);
    expect(stored?.result.findings.some((f) => f.id === 'F-R3' && f.priority === 'P0')).toBe(true);

    // Slash-command feedback.
    await hook('issue_comment', 'issue_comment.agree');
    expect((await store.feedback('acme/reports', 77)).map((f) => [f.findingId, f.label, f.source])).toEqual([
      ['F-R3', 'agree', 'slash'],
    ]);

    // Dashboard: sign in, list, see the queue, label another finding.
    const login = await app.request('/auth/login');
    const state = new URL(login.headers.get('location') ?? '').searchParams.get('state') ?? '';
    const cb = await app.request(`/auth/callback?code=ok&state=${state}`, {
      headers: { cookie: `remit_oauth_state=${state}` },
    });
    const cookie = /remit_session=[^;]+/.exec(cb.headers.get('set-cookie') ?? '')?.[0] ?? '';
    const me = (await (await app.request('/api/me', { headers: { cookie } })).json()) as { csrf: string };
    const reviews = (await (await app.request('/api/reviews', { headers: { cookie } })).json()) as {
      id: string;
    }[];
    expect(reviews).toHaveLength(1);
    const queued = (await (await app.request('/api/queue', { headers: { cookie } })).json()) as {
      finding: { id: string };
    }[];
    expect(queued.some((q) => q.finding.id === 'F-R3')).toBe(false);
    const other = stored?.result.findings.find((f) => f.id !== 'F-R3');
    if (other) {
      const res = await app.request(`/api/reviews/${reviews[0]?.id}/findings/${other.id}/feedback`, {
        method: 'POST',
        body: JSON.stringify({ label: 'disagree' }),
        headers: { cookie, 'x-csrf-token': me.csrf, 'content-type': 'application/json' },
      });
      expect(res.status).toBe(201);
    }

    // Export: JSONL from the API and eval items on disk.
    const jsonl = await (await app.request('/api/export/shadow', { headers: { cookie } })).text();
    const record = JSON.parse(jsonl.trim().split('\n')[0] ?? '{}');
    expect(record).toMatchObject({ format: 'remit-shadow-1', repo: 'acme/reports', prNumber: 77 });
    expect(record.feedback.length).toBe(other ? 2 : 1);
    const root = mkdtempSync(join(tmpdir(), 'remit-shadow-'));
    const counts = writeShadowCorpus(await shadowRecords(store), root);
    expect(counts.dev + counts.test).toBe(1);
    const split = counts.dev ? 'dev' : 'test';
    const [file] = readdirSync(join(root, 'shadow', split));
    const item = JSON.parse(readFileSync(join(root, 'shadow', split, file as string), 'utf8'));
    expect(item).toMatchObject({ corpus: 'shadow', labels: { pr: 'problem' } });
  }, 120_000);
});
