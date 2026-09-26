import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPgliteServer } from './db/pglite-server.js';
import { installationOf, PgBossQueue, queueOf } from './pg-queue.js';
import type { JobSpec } from './queue.js';

let stop: () => Promise<void> = async () => {};
let boss: PgBoss;
let queue: PgBossQueue;
const runs: { job: JobSpec; aborted: () => boolean }[] = [];
const failures = new Map<string, number>();
const cancelled: string[] = [];

beforeAll(async () => {
  const server = await startPgliteServer();
  stop = server.stop;
  boss = new PgBoss({ connectionString: server.url, max: 1 });
  boss.on('error', () => {});
  await boss.start();
  queue = new PgBossQueue(boss, {
    retryLimit: 2,
    retryDelaySeconds: 0,
    retryBackoff: false,
    pollingIntervalSeconds: 0.5,
    cleanupCron: null,
    recalibrateCron: null,
    hooks: { onCancel: (k) => cancelled.push(k) },
  });
  queue.setHandler(async (job, signal) => {
    runs.push({ job, aborted: () => signal.aborted });
    if (job.kind === 'review' && job.repo === 'flaky') {
      const n = (failures.get('flaky') ?? 0) + 1;
      failures.set('flaky', n);
      if (n < 3) throw new Error('transient');
    }
    if (job.kind === 'review' && job.repo === 'broken') throw new Error('always');
  });
  await queue.start();
}, 60_000);
afterAll(async () => {
  await boss.stop({ graceful: false });
  await stop();
});

const review = (repo: string, pr = 1): JobSpec => ({
  kind: 'review',
  installationId: 1,
  owner: 'a',
  repo,
  pr,
});
const until = async (cond: () => boolean | Promise<boolean>, ms = 20_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('timed out');
};

describe('PgBossQueue', () => {
  it('maps jobs to the 10.4 queues', () => {
    expect(queueOf(review('x'))).toBe('review');
    expect(
      queueOf({ kind: 'issue', installationId: 1, owner: 'a', repo: 'r', number: 1, action: 'edited' }),
    ).toBe('reextract');
    expect(queueOf({ kind: 'slash', event: {} })).toBe('command');
    expect(queueOf({ kind: 'cleanup' })).toBe('cleanup');
    expect(queueOf({ kind: 'recalibrate' })).toBe('recalibrate');
  });

  it('runs jobs and retries transient failures', async () => {
    await queue.enqueue('review:a/ok#1', review('ok'));
    await queue.enqueue('review:a/flaky#1', review('flaky'));
    await until(
      () => failures.get('flaky') === 3 && runs.some((r) => r.job.kind === 'review' && r.job.repo === 'ok'),
    );
    expect(failures.get('flaky')).toBe(3);
  }, 60_000);

  it('dead-letters a job that fails every retry', async () => {
    await queue.enqueue('review:a/broken#1', review('broken'));
    await until(async () => (await queue.deadLetters()).some((d) => d.key === 'review:a/broken#1'));
    const dead = await queue.deadLetters();
    expect(dead.find((d) => d.key === 'review:a/broken#1')).toMatchObject({
      kind: 'review',
      installationId: 1,
    });
    expect(installationOf({ kind: 'slash', event: { installation: { id: 7 } } })).toBe(7);
    expect(installationOf({ kind: 'slash', event: null })).toBeUndefined();
    expect(installationOf({ kind: 'cleanup' })).toBeUndefined();
    expect(runs.filter((r) => r.job.kind === 'review' && r.job.repo === 'broken')).toHaveLength(3);
  }, 60_000);

  it('debounces a burst for the same key: at most one run now and one in the next slot, per slot the burst spans', async () => {
    const before = runs.length;
    const window = 1000;
    const sentAt: number[] = [];
    for (const pr of [11, 12, 13]) {
      sentAt.push(Date.now());
      await queue.enqueue('review:a/burst#1', review('burst', pr), { debounceMs: window });
    }
    await until(() => runs.slice(before).some((r) => r.job.kind === 'review' && r.job.repo === 'burst'));
    await new Promise((r) => setTimeout(r, 2500));
    const burst = runs.slice(before).filter((r) => r.job.kind === 'review' && r.job.repo === 'burst');
    // pg-boss sendDebounced: a slot is floor(now / window); a send takes the current slot or, if taken, the next one.
    const slots =
      Math.floor((sentAt.at(-1) as number) / window) - Math.floor((sentAt[0] as number) / window) + 1;
    expect(burst.length).toBeGreaterThanOrEqual(1);
    expect(burst.length).toBeLessThanOrEqual(slots + 1);
    expect(burst.length).toBeLessThan(sentAt.length + (slots > 1 ? 1 : 0));
  }, 60_000);
});
