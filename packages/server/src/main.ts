/**
 * Server entry point: `node packages/server/dist/main.js` (or `pnpm server` in development). `REMIT_ROLE` picks the
 * process role: `all` (web and jobs in one process; the default), `web` (HTTP only; jobs go to pg-boss) or `worker`
 * (pg-boss consumers, with `/healthz` and `/metrics` on `WORKER_PORT`). Configuration comes from the environment
 * (see docs/github-app.md and docs/operations.md); `.env` is loaded by the process manager, never read here.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { BRAND, QUESTION_SET_VERSION } from '@remit/core';
import { CALIBRATION_ROOT, EVAL_ROOT, loadCalibration } from '@remit/eval';
import {
  type AppCredentials,
  appSlug,
  installationToken,
  LiveGitHub,
  providersFromEnv,
} from '@remit/providers';
import { Hono } from 'hono';
import { createApp, type ServerDeps } from './app.js';
import { openPglite, openPostgres } from './db/client.js';
import { DbStore } from './db/store.js';
import { runJob } from './events.js';
import { createLogger } from './logger.js';
import { Metrics } from './metrics.js';
import { PgBossQueue } from './pg-queue.js';
import { MemoryQueue } from './queue.js';
import { FileSecretStore } from './secrets.js';

export type Role = 'all' | 'web' | 'worker';

export interface Runtime {
  role: Role;
  app: Hono;
  store: DbStore;
  queue: MemoryQueue | PgBossQueue;
  metrics: Metrics;
  stop(): Promise<void>;
}

export async function start(
  env: Record<string, string | undefined> = process.env,
  opts: { listen?: boolean } = {},
): Promise<Runtime> {
  const role = (env.REMIT_ROLE ?? 'all') as Role;
  if (!['all', 'web', 'worker'].includes(role))
    throw new Error(`REMIT_ROLE ${role} is not all, web or worker.`);
  if (role !== 'all' && !env.DATABASE_URL)
    throw new Error(`REMIT_ROLE ${role} needs DATABASE_URL (Postgres and pg-boss).`);
  const logger = createLogger({ role });
  const log = (msg: string, data: Record<string, unknown> = {}) => logger.info(data, msg);
  const secrets = env.SECRETS_ENCRYPTION_KEY
    ? new FileSecretStore(join(env.DATA_DIR ?? '.data', 'app-secrets.enc'), env.SECRETS_ENCRYPTION_KEY)
    : undefined;
  const stored = await secrets?.load();
  const appId = env.GITHUB_APP_ID ?? stored?.appId;
  // Secrets may come from files (the *_FILE convention for container secrets).
  const fromFile = (name: string) => {
    const path = env[`${name}_FILE`];
    return path ? readFileSync(path, 'utf8').trim() : env[name];
  };
  const privateKey = fromFile('GITHUB_APP_PRIVATE_KEY')?.replace(/\\n/g, '\n') ?? stored?.privateKey;
  const webhookSecret = fromFile('GITHUB_WEBHOOK_SECRET') ?? stored?.webhookSecret ?? '';
  const apiUrl = env.GITHUB_API_URL;
  const metrics = new Metrics();
  const hooks = {
    onError: (key: string, e: unknown) => logger.error({ key, error: (e as Error).message }, 'job failed'),
    onCancel: (key: string) => metrics.inc('remit_jobs_cancelled_total', { key: key.split(':')[0] ?? 'job' }),
  };
  // Postgres and pg-boss when DATABASE_URL is set; otherwise PGlite on disk with the in-process queue.
  const database = env.DATABASE_URL
    ? await openPostgres(env.DATABASE_URL, {
        onError: (e) => logger.warn({ error: e.message }, 'database connection dropped'),
      })
    : await openPglite(join(env.DATA_DIR ?? '.data', 'pgdata'));
  const store = new DbStore(database.db);
  let boss: import('pg-boss').PgBoss | undefined;
  let queue: MemoryQueue | PgBossQueue;
  if (env.DATABASE_URL) {
    const { PgBoss } = await import('pg-boss');
    boss = new PgBoss({ connectionString: env.DATABASE_URL });
    boss.on('error', (e) => logger.error({ error: e.message }, 'queue error'));
    await boss.start();
    queue = new PgBossQueue(boss, { hooks });
  } else queue = new MemoryQueue(hooks);
  const creds: AppCredentials | null =
    appId && privateKey ? { appId, privateKey, ...(apiUrl ? { baseUrl: apiUrl } : {}) } : null;
  let slug = env.GITHUB_APP_SLUG ?? stored?.slug;
  if (!slug && creds) {
    // Known slug means only this App's comments are ever edited (sticky upsert by author).
    slug = await appSlug(creds).catch((e: Error) => {
      logger.warn({ error: e.message }, 'could not read the App slug; sticky comments match any bot');
      return undefined;
    });
  }
  // Setup is only possible before the App is configured, and only with this one-time token (printed once here).
  const setupToken =
    creds || role === 'worker' ? undefined : (env.SETUP_TOKEN ?? randomBytes(24).toString('hex'));
  if (setupToken && !env.SETUP_TOKEN)
    process.stderr.write(
      `${BRAND.name} is not configured yet. Open ${env.PUBLIC_URL ?? 'http://localhost:3000'}/setup?token=${setupToken}\n`,
    );
  const maintenance = async (kind: 'cleanup' | 'recalibrate') => {
    if (kind === 'cleanup') {
      const r = await store.cleanup();
      await store.pruneDeliveries(7);
      logger.info(r, 'retention cleanup done');
    } else {
      await store.recalibrateFromFeedback(env.JEV_MODEL ?? 'jev-1.13.0', QUESTION_SET_VERSION);
      await store.importEvalRuns(env.REMIT_REPORTS_DIR ?? join(EVAL_ROOT, 'reports'));
    }
  };
  const deps: ServerDeps = {
    webhookSecret,
    deliveries: store,
    metrics,
    queue,
    store,
    logger,
    maintenance,
    ...(env.PUBLIC_URL ? { publicUrl: env.PUBLIC_URL } : {}),
    ...(secrets ? { secrets } : {}),
    log,
    ...(env.REMIT_DAILY_BUDGET_USD
      ? { dailyBudgetUsd: Number(env.REMIT_DAILY_BUDGET_USD) }
      : { dailyBudgetUsd: 20 }),
    ...(env.REMIT_REVIEWS_PER_HOUR
      ? { reviewsPerHour: Number(env.REMIT_REVIEWS_PER_HOUR) }
      : { reviewsPerHour: 200 }),
    ...(env.SESSION_SECRET &&
    (env.GITHUB_CLIENT_ID ?? stored?.clientId) &&
    (env.GITHUB_CLIENT_SECRET ?? stored?.clientSecret)
      ? {
          dashboard: {
            store,
            sessionSecret: env.SESSION_SECRET,
            oauth: {
              clientId: (env.GITHUB_CLIENT_ID ?? stored?.clientId) as string,
              clientSecret: (env.GITHUB_CLIENT_SECRET ?? stored?.clientSecret) as string,
            },
            publicUrl: env.PUBLIC_URL ?? 'http://localhost:3000',
            staticDir: join(import.meta.dirname, '..', '..', 'dashboard', 'dist'),
            ...(queue instanceof PgBossQueue
              ? { deadLetters: () => (queue as PgBossQueue).deadLetters() }
              : {}),
          },
        }
      : {}),
    ready: async () => Boolean(creds && webhookSecret),
    configured: async () => Boolean(creds) || Boolean(await secrets?.load()),
    ...(setupToken ? { setupToken } : {}),
    ...(env.METRICS_TOKEN ? { metricsToken: env.METRICS_TOKEN } : {}),
    ...(slug ? { botLogin: `${slug}[bot]` } : {}),
    github: async (installationId, repo) => {
      if (!creds)
        throw new Error('GitHub App credentials are not configured (run /setup or set GITHUB_APP_ID).');
      // A fresh installation token per job, narrowed to the repository; it is never stored (9.2).
      const { token } = await installationToken(creds, installationId, Date.now(), repo ? [repo] : undefined);
      return new LiveGitHub({ token, ...(apiUrl ? { baseUrl: apiUrl } : {}) });
    },
    providers: (config) =>
      providersFromEnv(config, { ...env, REMIT_CACHE_MODE: env.REMIT_CACHE_MODE ?? 'live' }),
    calibration: (jevModel) => loadCalibration(env.REMIT_CALIBRATION_DIR ?? CALIBRATION_ROOT, jevModel),
  };

  let app: Hono;
  if (role === 'worker') {
    // The worker only consumes jobs; its HTTP port serves health and metrics for the orchestrator.
    queue.setHandler((job, signal) => runJob(job, deps, signal));
    app = new Hono();
    app.get('/healthz', (c) => c.text('ok'));
    app.get('/readyz', (c) => c.text('ready'));
    app.get('/metrics', (c) =>
      c.text(metrics.render(), 200, { 'content-type': 'text/plain; version=0.0.4' }),
    );
  } else app = createApp(deps);

  if (role !== 'worker') await store.importEvalRuns(env.REMIT_REPORTS_DIR ?? join(EVAL_ROOT, 'reports'));
  const timers: NodeJS.Timeout[] = [];
  if (queue instanceof PgBossQueue) await queue.start({ consume: role !== 'web' });
  else timers.push(...scheduleMaintenance(queue));

  let server: { close(): void } | undefined;
  if (opts.listen !== false) {
    const port = Number(role === 'worker' ? (env.WORKER_PORT ?? 3001) : (env.PORT ?? 3000));
    server = serve({ fetch: app.fetch, port });
    logger.info({ port, configured: Boolean(creds) }, `${BRAND.name} ${role} listening`);
  }
  return {
    role,
    app,
    store,
    queue,
    metrics,
    stop: async () => {
      for (const t of timers) clearInterval(t);
      server?.close();
      await boss?.stop({ graceful: true, timeout: 10_000 });
      await database.close();
    },
  };
}

/** Without pg-boss, the nightly jobs run on daily timers so retention still holds (9.9). Returns the timers. */
export function scheduleMaintenance(queue: MemoryQueue, dayMs = 24 * 3600_000): NodeJS.Timeout[] {
  const timers = [
    setInterval(() => void queue.enqueue('cleanup', { kind: 'cleanup' }), dayMs),
    setInterval(() => void queue.enqueue('recalibrate', { kind: 'recalibrate' }), dayMs),
  ];
  for (const t of timers) t.unref();
  void queue.enqueue('cleanup', { kind: 'cleanup' });
  return timers;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const runtime = await start();
  const shutdown = async (signal: string) => {
    process.stderr.write(`${signal}: shutting down\n`);
    await runtime.stop();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}
