import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { exchangeOAuthCode, oauthUser } from '@remit/providers';
import { createApp } from './app.js';
import { openPglite } from './db/client.js';
import { DbStore } from './db/store.js';
import { fakeRepo } from './fake-harness.js';
import { Metrics } from './metrics.js';
import { MemoryQueue } from './queue.js';
import { reviewPullRequest } from './review-job.js';
import { RateLimiter, readSession, signSession } from './session.js';

const SECRET = ['session', 'secret', 'for', 'dashboard', 'tests', 'only'].join('-');
const closers: (() => Promise<void>)[] = [];
afterAll(async () => {
  for (const c of closers) await c();
});

async function setup(login = 'maya', installationIds = [4242]) {
  const d = await openPglite();
  closers.push(d.close);
  const store = new DbStore(d.db);
  const repo = fakeRepo('three_reqs_one_missing', { config: 'retention:\n  retain_payloads: true\n' });
  await store.addInstallation(4242, 'acme', ['acme/reports']);
  await store.addInstallation(9999, 'other', ['other/secret']);
  const out = await reviewPullRequest(repo.gh, 4242, repo.pr, {
    providers: repo.providers,
    store,
    newId: () => 'rev_dash',
  });
  if (out.status !== 'done') throw new Error('review failed');
  const staticDir = mkdtempSync(join(tmpdir(), 'remit-dash-'));
  mkdirSync(join(staticDir, 'assets'));
  writeFileSync(join(staticDir, 'index.html'), '<!doctype html><title>Remit</title><div id="root"></div>');
  writeFileSync(join(staticDir, 'assets', 'app.js'), 'console.log(1)');
  const app = createApp({
    webhookSecret: 'x',
    deliveries: store,
    metrics: new Metrics(),
    queue: new MemoryQueue(),
    store,
    github: async () => repo.gh,
    providers: repo.providers,
    dashboard: {
      store,
      sessionSecret: SECRET,
      oauth: { clientId: 'cid', clientSecret: 'csecret' },
      publicUrl: 'https://remit.example.com',
      signIn: async (code) => {
        if (code !== 'good') throw new Error('bad code');
        return { login, installationIds };
      },
      staticDir,
      deadLetters: async () => [
        {
          id: 'j1',
          key: 'review:acme/reports#77',
          kind: 'review',
          createdOn: new Date(0),
          installationId: 4242,
        },
        {
          id: 'j2',
          key: 'review:other/secret#1',
          kind: 'review',
          createdOn: new Date(0),
          installationId: 9999,
        },
        { id: 'j3', key: 'cleanup', kind: 'cleanup', createdOn: new Date(0) },
      ],
      rateLimit: 1000,
    },
  });
  const cookie = signSession(SECRET, { login, installationIds });
  const s = readSession(SECRET, cookie);
  const get = (path: string) => app.request(path, { headers: { cookie: `remit_session=${cookie}` } });
  const post = (path: string, body: unknown, csrf = s?.csrf ?? '') =>
    app.request(path, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: {
        cookie: `remit_session=${cookie}`,
        'x-csrf-token': csrf,
        'content-type': 'application/json',
      },
    });
  return { app, store, get, post, cookie };
}

describe('dashboard auth', () => {
  it('signs in through GitHub OAuth with a state cookie and sets a secure session', async () => {
    const { app } = await setup();
    const login = await app.request('/auth/login');
    expect(login.status).toBe(302);
    const location = login.headers.get('location') ?? '';
    expect(location).toContain('https://github.com/login/oauth/authorize?client_id=cid');
    expect(location).toContain('redirect_uri=https%3A%2F%2Fremit.example.com%2Fauth%2Fcallback');
    const state = new URL(location).searchParams.get('state') ?? '';
    expect((await app.request(`/auth/callback?code=good&state=${state}`)).status).toBe(400);
    const bad = await app.request(`/auth/callback?code=bad&state=${state}`, {
      headers: { cookie: `remit_oauth_state=${state}` },
    });
    expect(bad.status).toBe(502);
    const ok = await app.request(`/auth/callback?code=good&state=${state}`, {
      headers: { cookie: `remit_oauth_state=${state}` },
    });
    expect(ok.status).toBe(302);
    const setCookie = ok.headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(/remit_session=[^;]+;.*HttpOnly/);
    expect(setCookie).toMatch(/Secure/);
    expect(setCookie).toMatch(/SameSite=Lax/);
  });

  it('refuses the API without a session, and mutations without the CSRF token', async () => {
    const { app, post } = await setup();
    expect((await app.request('/api/reviews')).status).toBe(401);
    expect(
      (await app.request('/api/reviews', { headers: { cookie: 'remit_session=forged.value' } })).status,
    ).toBe(401);
    expect(
      (await post('/api/reviews/rev_dash/findings/F-R3/feedback', { label: 'agree' }, 'wrong')).status,
    ).toBe(403);
    expect((await app.request('/auth/logout', { method: 'POST' })).status).toBe(403);
  });

  it('rate limits and expires sessions', () => {
    const r = new RateLimiter(2, 1000);
    expect([r.allow('a', 0), r.allow('a', 1), r.allow('a', 2), r.allow('a', 1001)]).toEqual([
      true,
      true,
      false,
      true,
    ]);
    const c = signSession(SECRET, { login: 'x', installationIds: [] }, 0);
    expect(readSession(SECRET, c, 1)).not.toBeNull();
    expect(readSession(SECRET, c, 9 * 3600_000)).toBeNull();
    expect(readSession(`${SECRET}-other`, c, 1)).toBeNull();
    expect(() => signSession('short', { login: 'x', installationIds: [] })).toThrow(/at least 32/);
  });
});

describe('dashboard API', () => {
  it('lists and shows only reviews in the user installations, with filters', async () => {
    const { get } = await setup();
    const list = (await (await get('/api/reviews?hasP0=true&repo=acme/reports')).json()) as { id: string }[];
    expect(list.map((r) => r.id)).toEqual(['rev_dash']);
    const detail = (await (await get('/api/reviews/rev_dash')).json()) as { result: { findings: unknown[] } };
    expect(detail.result.findings.length).toBeGreaterThan(0);
    const outsider = await setup('eve', [9999]);
    expect(await (await outsider.get('/api/reviews')).json()).toEqual([]);
    expect((await outsider.get('/api/reviews/rev_dash')).status).toBe(404);
  });

  it('records dashboard feedback and removes labeled findings from the queue', async () => {
    const { get, post, store } = await setup();
    const before = (await (await get('/api/queue')).json()) as { finding: { id: string } }[];
    expect(before.some((q) => q.finding.id === 'F-R3')).toBe(true);
    expect((await post('/api/reviews/rev_dash/findings/F-R3/feedback', { label: 'maybe' })).status).toBe(400);
    expect((await post('/api/reviews/rev_dash/findings/F-NOPE/feedback', { label: 'agree' })).status).toBe(
      404,
    );
    expect(
      (
        await post('/api/reviews/rev_dash/findings/F-R3/feedback', {
          label: 'disagree',
          reason: 'not what @team meant',
        })
      ).status,
    ).toBe(201);
    expect((await store.feedback('acme/reports', 77))[0]).toMatchObject({
      source: 'dashboard',
      label: 'disagree',
      login: 'maya',
    });
    const after = (await (await get('/api/queue')).json()) as { finding: { id: string } }[];
    expect(after.some((q) => q.finding.id === 'F-R3')).toBe(false);
  });

  it('serves metrics, settings, dead letters and the static dashboard', async () => {
    const { get, app } = await setup();
    const m = (await (await get('/api/metrics')).json()) as { reviews: number; cost: { p50: number } };
    expect(m.reviews).toBe(1);
    const settings = (await (await get('/api/settings')).json()) as {
      installations: { id: number }[];
      repositories: unknown[];
    };
    expect(settings.installations.map((i) => i.id)).toEqual([4242]);
    expect(settings.repositories).toHaveLength(1);
    expect(((await (await get('/api/dead-letters')).json()) as { id: string }[]).map((d) => d.id)).toEqual([
      'j1',
    ]);
    const outsider = await setup('eve', []);
    expect(await (await outsider.get('/api/dead-letters')).json()).toEqual([]);
    const me = (await (await get('/api/me')).json()) as { login: string; csrf: string };
    expect(me.login).toBe('maya');
    expect((await app.request('/')).headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(await (await app.request('/assets/app.js')).text()).toBe('console.log(1)');
    expect((await app.request('/assets/missing.js')).status).toBe(404);
  });
});

describe('OAuth provider (msw)', () => {
  const server = setupServer(
    http.post('https://github.com/login/oauth/access_token', async ({ request }) => {
      const body = (await request.json()) as { code: string };
      return body.code === 'good'
        ? HttpResponse.json({ access_token: 'user-token' })
        : HttpResponse.json({ error: 'bad_verification_code' });
    }),
    http.get('https://api.github.com/user', () => HttpResponse.json({ login: 'maya' })),
    http.get('https://api.github.com/user/installations', () =>
      HttpResponse.json({ total_count: 1, installations: [{ id: 4242 }] }),
    ),
  );
  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());

  it('exchanges the code and reads the user installations', async () => {
    const opts = { clientId: 'c', clientSecret: 's' };
    expect(await exchangeOAuthCode(opts, 'good', 'https://x/cb')).toBe('user-token');
    await expect(exchangeOAuthCode(opts, 'bad', 'https://x/cb')).rejects.toThrow(/refused/);
    await expect(exchangeOAuthCode(opts, 'bad code!', 'https://x/cb')).rejects.toThrow(/invalid/);
    expect(await oauthUser(opts, 'user-token')).toEqual({ login: 'maya', installationIds: [4242] });
  });
});
