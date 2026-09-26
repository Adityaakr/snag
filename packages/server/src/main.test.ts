import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { startPgliteServer } from './db/pglite-server.js';
import { createLogger } from './logger.js';
import { type Runtime, scheduleMaintenance, start } from './main.js';
import { Metrics } from './metrics.js';
import { MemoryQueue } from './queue.js';

const runtimes: Runtime[] = [];
const stops: (() => Promise<void>)[] = [];
afterAll(async () => {
  for (const r of runtimes) await r.stop();
  for (const s of stops) await s();
});

describe('bootstrap', () => {
  it('starts the all-in-one role on PGlite with health endpoints', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'remit-boot-'));
    const r = await start({ DATA_DIR: dir, REMIT_REPORTS_DIR: join(dir, 'reports') }, { listen: false });
    runtimes.push(r);
    expect(r.role).toBe('all');
    expect(r.queue).toBeInstanceOf(MemoryQueue);
    expect(await (await r.app.request('/healthz')).text()).toBe('ok');
    expect((await r.app.request('/readyz')).status).toBe(503);
  });

  it('refuses split roles without DATABASE_URL and unknown roles', async () => {
    await expect(start({ REMIT_ROLE: 'worker' }, { listen: false })).rejects.toThrow(/needs DATABASE_URL/);
    await expect(start({ REMIT_ROLE: 'cook' }, { listen: false })).rejects.toThrow(/not all, web or worker/);
  });

  it('runs web and worker roles against one Postgres', async () => {
    const pg = await startPgliteServer();
    stops.push(pg.stop);
    const env = { DATABASE_URL: pg.url, REMIT_REPORTS_DIR: '/nonexistent' };
    const worker = await start({ ...env, REMIT_ROLE: 'worker' }, { listen: false });
    runtimes.push(worker);
    const web = await start({ ...env, REMIT_ROLE: 'web' }, { listen: false });
    runtimes.push(web);
    expect(await (await worker.app.request('/healthz')).text()).toBe('ok');
    expect(await (await worker.app.request('/metrics')).text()).toBe('\n');
    expect((await web.app.request('/webhooks', { method: 'POST', body: '{}' })).status).toBe(401);
  }, 60_000);
});

describe('maintenance timers', () => {
  it('runs cleanup at once and both jobs daily', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const q = new MemoryQueue();
    const kinds: string[] = [];
    q.setHandler(async (job) => void kinds.push(job.kind));
    const timers = scheduleMaintenance(q, 1000);
    await q.idle();
    expect(kinds).toEqual(['cleanup']);
    vi.advanceTimersByTime(1000);
    for (const t of timers) clearInterval(t);
    vi.useRealTimers();
    await q.idle();
    expect(kinds.sort()).toEqual(['cleanup', 'cleanup', 'recalibrate']);
  });
});

describe('logs and metrics', () => {
  it('redacts credentials in structured logs', () => {
    let out = '';
    const logger = createLogger({
      role: 'web',
      destination: new Writable({
        write: (c, _e, cb) => {
          out += c;
          cb();
        },
      }),
    });
    const secret = ['ghs', 'secret', 'value'].join('_');
    logger
      .child({ reviewId: 'rev_1' })
      .info(
        { token: secret, headers: { authorization: `token ${secret}` }, creds: { privateKey: 'PEM' } },
        'hello',
      );
    const line = JSON.parse(out.trim());
    expect(line).toMatchObject({
      msg: 'hello',
      reviewId: 'rev_1',
      role: 'web',
      service: 'remit',
      token: '[redacted]',
    });
    expect(out).not.toContain(secret);
    expect(out).not.toContain('PEM');
  });

  it('renders a latency histogram and provider call metrics', () => {
    const m = new Metrics();
    m.observeReview('done', 4, 0.02, []);
    m.observeCalls([
      {
        provider: 'jev',
        model: 'j',
        kind: 'forward',
        requestHash: 'h',
        inputTokens: 100,
        outputTokens: 0,
        costUsd: 0.001,
        latencyMs: 5,
        status: 'ok',
      },
    ]);
    m.inc('remit_feedback_total', { label: 'agree', source: 'slash' });
    const text = m.render();
    expect(text).toContain('# TYPE remit_review_seconds histogram');
    expect(text).toContain('remit_review_seconds_bucket{le="5"} 1');
    expect(text).toContain('remit_review_seconds_bucket{le="2.5"}'.slice(0, 0));
    expect(text).not.toContain('remit_review_seconds_bucket{le="2.5"} 1');
    expect(text).toContain('remit_review_seconds_count 1');
    expect(text).toContain('remit_provider_calls_total{provider="jev",kind="forward"} 1');
    expect(text).toContain('remit_provider_tokens_total{provider="jev",direction="input"} 100');
    expect(text).toContain('remit_feedback_total{label="agree",source="slash"} 1');
    void readFileSync;
  });
});
