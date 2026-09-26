/**
 * Server entry point: `node packages/server/dist/main.js` (or `pnpm server` in development). Reads configuration
 * from the environment (see docs/github-app.md); `.env` is loaded by the process manager, never read here.
 */
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { BRAND } from '@remit/core';
import { CALIBRATION_ROOT, loadCalibration } from '@remit/eval';
import { type AppCredentials, installationToken, LiveGitHub, providersFromEnv } from '@remit/providers';
import { createApp } from './app.js';
import { MemoryDeliveryStore } from './deliveries.js';
import { Metrics } from './metrics.js';
import { MemoryQueue } from './queue.js';
import { FileSecretStore } from './secrets.js';
import { MemoryStore } from './store.js';

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
  const queue = new MemoryQueue({
    onError: (key, e) => log('job failed', { key, error: (e as Error).message }),
    onCancel: (key) => metrics.inc('remit_jobs_cancelled_total', { key: key.split(':')[0] ?? 'job' }),
  });
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
    deliveries: new MemoryDeliveryStore(),
    metrics,
    queue,
    store: new MemoryStore(),
    ...(env.PUBLIC_URL ? { publicUrl: env.PUBLIC_URL } : {}),
    ...(secrets ? { secrets } : {}),
    log,
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
  const port = Number(env.PORT ?? 3000);
  serve({ fetch: app.fetch, port });
  log(`${BRAND.name} server listening`, { port, configured: Boolean(creds) });
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) void start();
