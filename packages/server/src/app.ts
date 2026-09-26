/**
 * The HTTP server (BUILD_PROMPT 10.2, 10.4): `/webhooks`, `/setup` and its callback, `/healthz`, `/readyz` and
 * `/metrics`. The webhook caps the body while streaming, verifies the signature before parsing, dedupes by delivery
 * id, enqueues, and answers 202. Setup needs a one-time token and closes once the App is configured.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { BRAND } from '@remit/core';
import { convertManifest, type ManifestConversion } from '@remit/providers';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { getCookie, setCookie } from 'hono/cookie';
import type { DeliveryStore } from './deliveries.js';
import { type AppDeps, handleEvent, runJob } from './events.js';
import type { Metrics } from './metrics.js';
import type { SecretStore } from './secrets.js';
import { errorPage, setupDonePage, setupPage } from './setup.js';
import { verifySignature } from './webhook-verify.js';

export const MAX_WEBHOOK_BYTES = 25 * 1024 * 1024;

export interface ServerDeps extends AppDeps {
  webhookSecret: string;
  deliveries: DeliveryStore;
  metrics: Metrics;
  publicUrl?: string;
  secrets?: SecretStore;
  /** For tests: replaces the manifest code exchange. */
  convert?: (code: string) => Promise<ManifestConversion>;
  ready?: () => Promise<boolean>;
  /** True once App credentials exist (env or storage): setup then answers 404 and never overwrites them. */
  configured?: () => Promise<boolean>;
  /** One-time token required by /setup (printed at startup when the App is not configured); unset means setup is off. */
  setupToken?: string;
  /** Bearer token for /metrics; when unset, /metrics is open, so bind it to an internal network. */
  metricsToken?: string;
  log?: (msg: string, data?: Record<string, unknown>) => void;
}

/** Constant-time string comparison for tokens; empty values never match. */
export function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length > 0 && x.length === y.length && timingSafeEqual(x, y);
}

const SETUP_HEADERS: Record<string, string> = {
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'content-security-policy':
    "default-src 'none'; style-src 'unsafe-inline'; form-action https://github.com; base-uri 'none'; frame-ancestors 'none'",
};

export function createApp(deps: ServerDeps): Hono {
  const app = new Hono();
  const log = deps.log ?? (() => {});
  deps.queue.setHandler((job, signal) => runJob(job, deps, signal));

  app.get('/healthz', (c) => c.text('ok'));
  app.get('/readyz', async (c) =>
    (await (deps.ready?.() ?? Promise.resolve(true))) ? c.text('ready') : c.text('not ready', 503),
  );
  app.get('/metrics', (c) => {
    if (deps.metricsToken && !sameSecret(c.req.header('authorization') ?? '', `Bearer ${deps.metricsToken}`))
      return c.text('unauthorized', 401);
    return c.text(deps.metrics.render(), 200, { 'content-type': 'text/plain; version=0.0.4' });
  });

  app.post(
    '/webhooks',
    // Counts bytes while streaming, so chunked bodies without Content-Length are capped too.
    bodyLimit({ maxSize: MAX_WEBHOOK_BYTES, onError: (c) => c.text('payload too large', 413) }),
    async (c) => {
      const body = await c.req.text();
      if (!verifySignature(deps.webhookSecret, body, c.req.header('x-hub-signature-256'))) {
        deps.metrics.inc('remit_webhooks_total', { event: 'unknown', result: 'bad_signature' });
        return c.text('invalid signature', 401);
      }
      const event = c.req.header('x-github-event') ?? '';
      const delivery = c.req.header('x-github-delivery') ?? '';
      if (!delivery) return c.text('missing delivery id', 400);
      if (!(await deps.deliveries.claim(delivery))) {
        deps.metrics.inc('remit_webhooks_total', { event, result: 'duplicate' });
        return c.text('duplicate delivery', 200);
      }
      let payload: unknown;
      try {
        payload = JSON.parse(body);
      } catch {
        await deps.deliveries.release?.(delivery);
        return c.text('invalid JSON', 400);
      }
      try {
        const r = await handleEvent(event, payload, deps);
        deps.metrics.inc('remit_webhooks_total', { event, result: 'handled' in r ? 'handled' : 'ignored' });
        return c.json(r, 202);
      } catch (e) {
        // Handling failed before a job was queued: release the claim so GitHub's redelivery is processed.
        await deps.deliveries.release?.(delivery);
        log('webhook payload rejected', { event, delivery, error: (e as Error).name });
        deps.metrics.inc('remit_webhooks_total', { event, result: 'invalid' });
        return c.text('unexpected payload', 400);
      }
    },
  );

  // One use per process: after a successful callback, setup stays closed even without stored credentials.
  let setupUsed = false;
  const setupClosed = async () =>
    setupUsed || !deps.setupToken || (await (deps.configured?.() ?? Promise.resolve(false)));
  for (const path of ['/setup', '/setup/*'])
    app.use(path, async (c, next) => {
      await next();
      for (const [k, v] of Object.entries(SETUP_HEADERS)) c.res.headers.set(k, v);
    });

  app.get('/setup', async (c) => {
    if (await setupClosed()) return c.text('not found', 404);
    if (!sameSecret(c.req.query('token') ?? '', deps.setupToken ?? ''))
      return c.html(errorPage('This setup link needs the one-time token printed in the server log.'), 403);
    if (!deps.publicUrl)
      return c.html(
        errorPage('Set PUBLIC_URL to the address GitHub can reach (see docs/github-app.md).'),
        500,
      );
    const state = randomBytes(16).toString('hex');
    setCookie(c, `${BRAND.slug}_setup_state`, state, {
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      path: '/setup',
      maxAge: 3600,
    });
    const org = c.req.query('org');
    return c.html(
      setupPage(
        deps.publicUrl,
        state,
        org && /^[\w-]{1,39}$/.test(org) ? org : undefined,
        c.req.query('read_only') === '1',
      ),
    );
  });

  app.get('/setup/callback', async (c) => {
    if (await setupClosed()) return c.text('not found', 404);
    const code = c.req.query('code') ?? '';
    const state = c.req.query('state') ?? '';
    const expected = getCookie(c, `${BRAND.slug}_setup_state`) ?? '';
    if (!sameSecret(state, expected))
      return c.html(errorPage('The setup link expired or did not come from this server.'), 400);
    try {
      const conv = await (deps.convert ?? convertManifest)(code);
      const secrets = {
        appId: String(conv.id),
        slug: conv.slug,
        privateKey: conv.pem,
        webhookSecret: conv.webhookSecret,
        clientId: conv.clientId,
        clientSecret: conv.clientSecret,
      };
      if (deps.secrets) {
        await deps.secrets.save(secrets);
        setupUsed = true;
        return c.html(setupDonePage(conv.htmlUrl, true));
      }
      setupUsed = true;
      return c.html(setupDonePage(conv.htmlUrl, false, secrets));
    } catch {
      return c.html(
        errorPage('Setup could not finish: GitHub rejected the code, or credentials are already stored.'),
        502,
      );
    }
  });

  return app;
}
