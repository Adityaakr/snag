/**
 * The HTTP server (BUILD_PROMPT 10.2, 10.4): `/webhooks`, `/setup` and its callback, `/healthz`, `/readyz` and
 * `/metrics`. The webhook verifies the signature before parsing, dedupes by delivery id, enqueues, and answers 202.
 */
import { randomBytes } from 'node:crypto';
import { BRAND } from '@remit/core';
import { convertManifest, type ManifestConversion } from '@remit/providers';
import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import type { DeliveryStore } from './deliveries.js';
import { type AppDeps, handleEvent } from './events.js';
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
  log?: (msg: string, data?: Record<string, unknown>) => void;
}

export function createApp(deps: ServerDeps): Hono {
  const app = new Hono();
  const log = deps.log ?? (() => {});

  app.get('/healthz', (c) => c.text('ok'));
  app.get('/readyz', async (c) =>
    (await (deps.ready?.() ?? Promise.resolve(true))) ? c.text('ready') : c.text('not ready', 503),
  );
  app.get('/metrics', (c) =>
    c.text(deps.metrics.render(), 200, { 'content-type': 'text/plain; version=0.0.4' }),
  );

  app.post('/webhooks', async (c) => {
    const length = Number(c.req.header('content-length') ?? 0);
    if (length > MAX_WEBHOOK_BYTES) return c.text('payload too large', 413);
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
      return c.text('invalid JSON', 400);
    }
    try {
      const r = await handleEvent(event, payload, deps);
      deps.metrics.inc('remit_webhooks_total', { event, result: 'handled' in r ? 'handled' : 'ignored' });
      return c.json(r, 202);
    } catch (e) {
      log('webhook payload rejected', { event, delivery, error: (e as Error).name });
      deps.metrics.inc('remit_webhooks_total', { event, result: 'invalid' });
      return c.text('unexpected payload', 400);
    }
  });

  app.get('/setup', (c) => {
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
    const code = c.req.query('code') ?? '';
    const state = c.req.query('state') ?? '';
    const expected = getCookie(c, `${BRAND.slug}_setup_state`);
    if (!expected || state !== expected)
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
        return c.html(setupDonePage(conv.htmlUrl, true));
      }
      return c.html(setupDonePage(conv.htmlUrl, false, secrets));
    } catch {
      return c.html(errorPage('GitHub did not accept the setup code. Start again.'), 502);
    }
  });

  return app;
}
