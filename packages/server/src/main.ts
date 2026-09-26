/**
 * Server entry point: `node packages/server/dist/main.js` (or `pnpm server` in development). Reads configuration
 * from the environment (see docs/github-app.md); `.env` is loaded by the process manager, never read here.
 */
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { BRAND, QUESTION_SET_VERSION } from '@remit/core';
import { CALIBRATION_ROOT, EVAL_ROOT, loadCalibration } from '@remit/eval';
import { type AppCredentials, installationToken, LiveGitHub, providersFromEnv } from '@remit/providers';
import { createApp } from './app.js';
import { Metrics } from './metrics.js';
import { MemoryQueue } from './queue.js';
import { FileSecretStore } from './secrets.js';
import { openPglite, openPostgres } from './db/client.js';
import { DbStore } from './db/store.js';
import { PgBossQueue } from './pg-queue.js';

export async function start(env: Record<string, string | undefined> = process.env) {
  const secrets = env.SECRETS_ENCRYPTION_KEY
    ? new FileSecretStore(join(env.DATA_DIR ?? '.data', 'app-secrets.enc'), env.SECRETS_ENCRYPTION_KEY)
    : undefined;
  const stored = await secrets?.load();
  const appId = env.GITHUB_APP_ID ?? stored?.appId;
  const privateKey = env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, '\n') ?? stored?.privateKey;
  const webhookSecret = env.GITHUB_WEBHOOK_SECRET ?? stored?.webhookSecret ?? '';
  const metrics = new Metrics();
  const log = (msg: string, data: Record<string, unknown> = {}) =>
    process.stderr.write(`${JSON.stringify({ level: 'info', msg, ...data })}\n`);
  const hooks = {
    onError: (key: string, e: unknown) => log('job failed', { key, error: (e as Error).message }),
    onCancel: (key: string) => metrics.inc('remit_jobs_cancelled_total', { key: key.split(':')[0] ?? 'job' }),
  };
  // Postgres and pg-boss when DATABASE_URL is set; otherwise PGlite on disk with the in-process queue.
  const database = env.DATABASE_URL
    ? await openPostgres(env.DATABASE_URL)
    : await openPglite(join(env.DATA_DIR ?? '.data', 'pgdata'));
  const store = new DbStore(database.db);
  let queue: MemoryQueue | PgBossQueue;
  if (env.DATABASE_URL) {
    const { PgBoss } = await import('pg-boss');
    const boss = new PgBoss({ connectionString: env.DATABASE_URL });
    boss.on('error', (e) => log('queue error', { error: e.message }));
    await boss.start();
    queue = new PgBossQueue(boss, { hooks });
  } else queue = new MemoryQueue(hooks);
  const creds: AppCredentials | null = appId && privateKey ? { appId, privateKey } : null;
  const slug = env.GITHUB_APP_SLUG ?? stored?.slug;
  // Setup is only possible before the App is configured, and only with this one-time token (printed once here).
  const setupToken = creds ? undefined : (env.SETUP_TOKEN ?? randomBytes(24).toString('hex'));
  if (setupToken && !env.SETUP_TOKEN)
    process.stderr.write(
      `${BRAND.name} is not configured yet. Open ${env.PUBLIC_URL ?? 'http://localhost:3000'}/setup?token=${setupToken}\n`,
    );
  const app = createApp({
    webhookSecret,
    deliveries: store,
    metrics,
    queue,
    store,
    maintenance: async (kind) => {
      if (kind === 'cleanup') {
        await store.cleanup();
        await store.pruneDeliveries(7);
      } else {
        await store.recalibrateFromFeedback(env.JEV_MODEL ?? 'jev-1.13.0', QUESTION_SET_VERSION);
        await store.importEvalRuns(env.REMIT_REPORTS_DIR ?? join(EVAL_ROOT, 'reports'));
      }
    },
    ...(env.PUBLIC_URL ? { publicUrl: env.PUBLIC_URL } : {}),
    ...(secrets ? { secrets } : {}),
    log,
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
      // A fresh installation token per job; it is never stored (9.2).
      const { token } = await installationToken(creds, installationId, Date.now(), repo ? [repo] : undefined);
      return new LiveGitHub({ token });
    },
    providers: (config) =>
      providersFromEnv(config, { ...env, REMIT_CACHE_MODE: env.REMIT_CACHE_MODE ?? 'live' }),
    calibration: (jevModel) => loadCalibration(env.REMIT_CALIBRATION_DIR ?? CALIBRATION_ROOT, jevModel),
  });
  const reportsDir = env.REMIT_REPORTS_DIR ?? join(EVAL_ROOT, 'reports');
  await store.importEvalRuns(reportsDir);
  if (queue instanceof PgBossQueue) await queue.start();
  else {
    // Without pg-boss, the nightly jobs run on timers so retention still holds (9.9).
    const day = 24 * 3600_000;
    setInterval(() => void queue.enqueue('cleanup', { kind: 'cleanup' }), day).unref();
    setInterval(() => void queue.enqueue('recalibrate', { kind: 'recalibrate' }), day).unref();
    void queue.enqueue('cleanup', { kind: 'cleanup' });
  }
  const port = Number(env.PORT ?? 3000);
  serve({ fetch: app.fetch, port });
  log(`${BRAND.name} server listening`, { port, configured: Boolean(creds) });
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) void start();
