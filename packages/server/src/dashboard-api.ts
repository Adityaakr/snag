/**
 * Dashboard routes (BUILD_PROMPT 10.4): GitHub OAuth under `/auth/*`, JSON under `/api/*`, and the static dashboard.
 * Users see only installations they can access on GitHub; every mutation needs the session's CSRF token; cookies are
 * httpOnly, Secure and SameSite=Lax; requests are rate limited.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BRAND, defaultConfig, sanitize } from '@remit/core';
import { exchangeOAuthCode, type OAuthOptions, type OAuthUser, oauthUser } from '@remit/providers';
import type { Context, Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import type { DbStore } from './db/store.js';
import { RateLimiter, readSession, type Session, signSession } from './session.js';

export interface DashboardDeps {
  store: DbStore;
  sessionSecret: string;
  oauth: OAuthOptions;
  publicUrl: string;
  /** The dead-letter list, when the durable queue runs. */
  deadLetters?: () => Promise<{ id: string; key: string; kind: string; createdOn: Date }[]>;
  /** For tests: replaces the GitHub code exchange and user lookup. */
  signIn?: (code: string) => Promise<OAuthUser>;
  /** The built dashboard (packages/dashboard/dist). */
  staticDir?: string;
  rateLimit?: number;
}

const COOKIE = `${BRAND.slug}_session`;
const STATE = `${BRAND.slug}_oauth_state`;
const cookieOpts = { httpOnly: true, secure: true, sameSite: 'Lax' as const, path: '/' };

const FeedbackBody = z.object({
  label: z.enum(['agree', 'disagree']),
  reason: z.string().max(500).optional(),
});

function pct(xs: number[], q: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))] as number;
}

export function mountDashboard(app: Hono, deps: DashboardDeps): void {
  const limiter = new RateLimiter(deps.rateLimit ?? 120);
  const session = (c: Context): Session | null => readSession(deps.sessionSecret, getCookie(c, COOKIE));

  app.use('/api/*', async (c, next) => {
    const s = session(c);
    const key = s?.login ?? c.req.header('x-forwarded-for') ?? 'anonymous';
    if (!limiter.allow(key)) return c.json({ error: 'rate limited' }, 429);
    if (!s) return c.json({ error: 'sign in first', login: '/auth/login' }, 401);
    if (c.req.method !== 'GET' && c.req.header('x-csrf-token') !== s.csrf)
      return c.json({ error: 'bad CSRF token' }, 403);
    c.set('session' as never, s as never);
    c.header('cache-control', 'no-store');
    return next();
  });
  const me = (c: Context) => c.get('session' as never) as Session;
  const canSee = (s: Session, installationId: number) => s.installationIds.includes(installationId);

  app.use('/auth/*', async (c, next) => {
    if (!limiter.allow(`auth:${c.req.header('x-forwarded-for') ?? 'anonymous'}`))
      return c.text('rate limited', 429);
    return next();
  });

  app.get('/auth/login', (c) => {
    const state = randomBytes(16).toString('hex');
    setCookie(c, STATE, state, { ...cookieOpts, maxAge: 600 });
    const redirect = `${deps.publicUrl.replace(/\/+$/, '')}/auth/callback`;
    const url = new URL(`${deps.oauth.webUrl ?? 'https://github.com'}/login/oauth/authorize`);
    url.searchParams.set('client_id', deps.oauth.clientId);
    url.searchParams.set('redirect_uri', redirect);
    url.searchParams.set('state', state);
    return c.redirect(url.toString(), 302);
  });

  app.get('/auth/callback', async (c) => {
    const state = c.req.query('state') ?? '';
    const expected = getCookie(c, STATE);
    deleteCookie(c, STATE, { path: '/' });
    if (!expected || state !== expected) return c.text('The sign-in link expired. Try again.', 400);
    try {
      const code = c.req.query('code') ?? '';
      const user = deps.signIn
        ? await deps.signIn(code)
        : await oauthUser(
            deps.oauth,
            await exchangeOAuthCode(deps.oauth, code, `${deps.publicUrl.replace(/\/+$/, '')}/auth/callback`),
          );
      setCookie(c, COOKIE, signSession(deps.sessionSecret, user), { ...cookieOpts, maxAge: 8 * 3600 });
      return c.redirect('/', 302);
    } catch {
      return c.text('GitHub sign-in failed. Try again.', 502);
    }
  });

  app.post('/auth/logout', (c) => {
    const s = session(c);
    if (!s || c.req.header('x-csrf-token') !== s.csrf) return c.text('bad CSRF token', 403);
    deleteCookie(c, COOKIE, { path: '/' });
    return c.body(null, 204);
  });

  app.get('/api/me', (c) => {
    const s = me(c);
    return c.json({ login: s.login, installationIds: s.installationIds, csrf: s.csrf });
  });

  app.get('/api/reviews', async (c) => {
    const s = me(c);
    const q = c.req.query();
    const rows = await deps.store.listReviews({
      installationIds: s.installationIds,
      ...(q.repo ? { repo: q.repo } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.hasP0 === 'true' ? { hasP0: true } : q.hasP0 === 'false' ? { hasP0: false } : {}),
      ...(q.since && !Number.isNaN(Date.parse(q.since)) ? { since: new Date(q.since) } : {}),
    });
    return c.json(rows);
  });

  app.get('/api/reviews/:id', async (c) => {
    const s = me(c);
    const r = await deps.store.getReview(c.req.param('id'));
    if (!r || !canSee(s, r.installationId)) return c.json({ error: 'not found' }, 404);
    const feedback = await deps.store.feedback(r.repo, r.pr);
    return c.json({
      id: r.id,
      repo: r.repo,
      pr: r.pr,
      headSha: r.headSha,
      createdAt: r.createdAt,
      result: r.result,
      feedback,
    });
  });

  app.post('/api/reviews/:id/findings/:fid/feedback', async (c) => {
    const s = me(c);
    const r = await deps.store.getReview(c.req.param('id'));
    if (!r || !canSee(s, r.installationId)) return c.json({ error: 'not found' }, 404);
    const f = r.result.findings.find((x) => x.id === c.req.param('fid'));
    if (!f) return c.json({ error: 'no such finding' }, 404);
    const body = FeedbackBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'label must be agree or disagree' }, 400);
    await deps.store.addFeedback({
      repo: r.repo,
      pr: r.pr,
      findingId: f.id,
      contentKey: f.contentKey,
      login: s.login,
      label: body.data.label,
      ...(body.data.reason ? { reason: sanitize(body.data.reason, 500) } : {}),
      source: 'dashboard',
      createdAt: new Date().toISOString(),
    });
    return c.json({ recorded: body.data.label }, 201);
  });

  /** The labeling queue: sampled findings with no human label yet. */
  app.get('/api/queue', async (c) => {
    const s = me(c);
    const rows = await deps.store.listReviews({ installationIds: s.installationIds, limit: 200 });
    const items: unknown[] = [];
    for (const row of rows) {
      if (items.length >= 20) break;
      const r = await deps.store.getReview(row.id);
      if (!r) continue;
      const labeled = new Set(
        (await deps.store.feedback(r.repo, r.pr))
          .filter((f) => f.source !== 'implicit')
          .map((f) => f.contentKey),
      );
      for (const f of r.result.findings) {
        if (labeled.has(f.contentKey) || items.length >= 20) continue;
        const req = r.result.requirements.find((q) => q.id === f.targetId);
        items.push({
          reviewId: r.id,
          repo: r.repo,
          pr: r.pr,
          finding: {
            id: f.id,
            type: f.type,
            priority: f.priority,
            confidence: f.confidence,
            locations: f.locations,
            reasons: f.reasons.map((x) => x.text),
          },
          ...(req ? { quote: req.quote } : {}),
        });
      }
    }
    return c.json(items);
  });

  app.get('/api/metrics', async (c) => {
    const s = me(c);
    const since = new Date(Date.now() - 30 * 86_400_000);
    const rows = await deps.store.listReviews({ installationIds: s.installationIds, since, limit: 500 });
    const runs = await deps.store.evalRuns();
    return c.json({
      evalRuns: runs.map((r) => ({
        id: r.id,
        corpus: r.corpus,
        split: r.split,
        createdAt: r.createdAt,
        metrics: r.metrics,
      })),
      agreement: await deps.store.agreementByType(s.installationIds),
      cost: {
        p50: pct(
          rows.map((r) => r.costUsd),
          0.5,
        ),
        p95: pct(
          rows.map((r) => r.costUsd),
          0.95,
        ),
      },
      latency: {
        p50: pct(
          rows.map((r) => r.latencyMs),
          0.5,
        ),
        p95: pct(
          rows.map((r) => r.latencyMs),
          0.95,
        ),
      },
      reviews: rows.length,
    });
  });

  app.get('/api/settings', async (c) => {
    const s = me(c);
    const all = await deps.store.installations();
    const defaults = defaultConfig();
    return c.json({
      installations: all.filter((i) => canSee(s, i.id)).map((i) => ({ id: i.id, account: i.accountLogin })),
      repositories: (await deps.store.repositoriesOf(s.installationIds)).map((r) => ({
        fullName: r.fullName,
        installationId: r.installationId,
        configHash: r.configHash,
      })),
      defaults: {
        mode: defaults.mode,
        budgets: defaults.budgets,
        retention: defaults.retention,
        surfaces: defaults.surfaces,
      },
    });
  });

  app.get('/api/dead-letters', async (c) => c.json(deps.deadLetters ? await deps.deadLetters() : []));

  const dir = deps.staticDir;
  if (dir && existsSync(join(dir, 'index.html'))) {
    const types: Record<string, string> = {
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.svg': 'image/svg+xml',
      '.html': 'text/html',
    };
    const index = readFileSync(join(dir, 'index.html'), 'utf8');
    app.get('/assets/*', (c) => {
      const rel = c.req.path.replace(/^\/+/, '');
      if (rel.includes('..')) return c.text('not found', 404);
      const file = join(dir, rel);
      if (!existsSync(file)) return c.text('not found', 404);
      const ext = rel.slice(rel.lastIndexOf('.'));
      return c.body(readFileSync(file), 200, {
        'content-type': types[ext] ?? 'application/octet-stream',
        'cache-control': 'public, max-age=31536000, immutable',
      });
    });
    app.get('/', (c) =>
      c.html(index, 200, {
        'content-security-policy':
          "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
      }),
    );
  }
}
