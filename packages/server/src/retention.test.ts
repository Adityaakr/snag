/**
 * Retention and deletion jobs (BUILD_PROMPT 9.9, M9) through the job path: the nightly `cleanup` job deletes expired
 * payloads and text columns, and an `installation.deleted` webhook deletes that installation's data.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { openPglite } from './db/client.js';
import { NOT_RETAINED } from './db/redact.js';
import { DbStore } from './db/store.js';
import { runJob } from './events.js';
import { fakeRepo } from './fake-harness.js';
import { Metrics } from './metrics.js';
import { MemoryQueue } from './queue.js';
import { signBody } from './webhook-verify.js';

const closers: (() => Promise<void>)[] = [];
afterAll(async () => {
  for (const c of closers) await c();
});

async function setup() {
  const d = await openPglite();
  closers.push(d.close);
  const store = new DbStore(d.db);
  const repo = fakeRepo('three_reqs_one_missing', {
    config: 'retention:\n  retain_payloads: true\n  retention_days: 1\n',
  });
  const queue = new MemoryQueue();
  let now = new Date();
  const secret = ['retention', 'secret'].join('-');
  const deps = {
    webhookSecret: secret,
    deliveries: store,
    metrics: new Metrics(),
    queue,
    store,
    github: async () => repo.gh,
    providers: repo.providers,
    debounceMs: 0,
    maintenance: async (kind: 'cleanup' | 'recalibrate') => {
      if (kind === 'cleanup') await store.cleanup(now);
    },
  };
  const app = createApp(deps);
  const hook = async (event: string, file: string) => {
    const body = readFileSync(
      join(import.meta.dirname, '..', '..', '..', 'fixtures', 'webhooks', `${file}.json`),
      'utf8',
    );
    await app.request('/webhooks', {
      method: 'POST',
      body,
      headers: {
        'x-github-event': event,
        'x-github-delivery': `${file}-${Math.random()}`,
        'x-hub-signature-256': signBody(secret, body),
      },
    });
    await queue.idle();
  };
  return { store, hook, deps, setNow: (d: Date) => (now = d) };
}

describe('retention job', () => {
  it('keeps payloads within retention_days and deletes them after, through the cleanup job', async () => {
    const { store, hook, deps, setNow } = await setup();
    await hook('installation', 'installation.created');
    await hook('pull_request', 'pull_request.opened');
    const before = await store.latestReview('acme/reports', 77);
    expect(before?.result.requirements[0]?.quote).not.toBe(NOT_RETAINED);
    await runJob({ kind: 'cleanup' }, deps, new AbortController().signal);
    expect((await store.latestReview('acme/reports', 77))?.result.requirements[0]?.quote).not.toBe(
      NOT_RETAINED,
    );
    setNow(new Date(Date.now() + 2 * 86_400_000));
    await runJob({ kind: 'cleanup' }, deps, new AbortController().signal);
    expect((await store.latestReview('acme/reports', 77))?.result.requirements[0]?.quote).toBe(NOT_RETAINED);
  });
});

describe('deletion on uninstall', () => {
  it('deletes reviews, findings, feedback and checklists of the installation', async () => {
    const { store, hook } = await setup();
    await hook('installation', 'installation.created');
    await hook('pull_request', 'pull_request.opened');
    const r = await store.latestReview('acme/reports', 77);
    const f = r?.result.findings[0];
    if (!f) throw new Error('no finding');
    await store.addFeedback({
      repo: 'acme/reports',
      pr: 77,
      findingId: f.id,
      contentKey: f.contentKey,
      login: 'dev',
      label: 'agree',
      source: 'slash',
      createdAt: new Date().toISOString(),
    });
    await hook('installation', 'installation.deleted');
    expect(await store.latestReview('acme/reports', 77)).toBeNull();
    expect(await store.feedback('acme/reports', 77)).toEqual([]);
    expect(await store.installationOf('acme/reports')).toBeNull();
    expect(await store.listReviews({ installationIds: [4242] })).toEqual([]);
  });
});
