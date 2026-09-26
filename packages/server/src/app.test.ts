/**
 * Integration tests: recorded webhook payloads (fixtures/webhooks) replayed against the app, with FakeGitHub as the
 * local GitHub and a golden scenario's scripted providers (BUILD_PROMPT M7).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Calibration } from '@remit/core';
import { describe, expect, it } from 'vitest';
import { createApp, type ServerDeps } from './app.js';
import { MemoryDeliveryStore } from './deliveries.js';
import { fakeRepo } from './fake-harness.js';
import { Metrics } from './metrics.js';
import { MemoryQueue } from './queue.js';
import { MemoryStore } from './store.js';
import { signBody } from './webhook-verify.js';

const FIXTURES = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'webhooks');
const SECRET = ['whsec', 'test', 'only'].join('-');
const fixture = (name: string) => readFileSync(join(FIXTURES, `${name}.json`), 'utf8');

function setup(opts: { config?: string; calibration?: Calibration } = {}) {
  const repo = fakeRepo('three_reqs_one_missing', opts.config ? { config: opts.config } : {});
  const store = new MemoryStore();
  const metrics = new Metrics();
  const queue = new MemoryQueue();
  let n = 0;
  const deps: ServerDeps = {
    webhookSecret: SECRET,
    deliveries: new MemoryDeliveryStore(),
    metrics,
    queue,
    store,
    github: async () => repo.gh,
    providers: repo.providers,
    ...(opts.calibration ? { calibration: () => opts.calibration } : {}),
    newId: () => `rev_${++n}`,
    debounceMs: 0,
    publicUrl: 'https://remit.example.com',
    setupToken: 'setup-token-for-tests',
  };
  const app = createApp(deps);
  let delivery = 0;
  const send = async (event: string, body: string, headers: Record<string, string> = {}) =>
    app.request('/webhooks', {
      method: 'POST',
      body,
      headers: {
        'x-github-event': event,
        'x-github-delivery': `d-${++delivery}`,
        'x-hub-signature-256': signBody(SECRET, body),
        ...headers,
      },
    });
  const hook = async (event: string, name: string) => {
    const res = await send(event, fixture(name));
    await queue.idle();
    return res;
  };
  return { repo, store, metrics, queue, app, send, hook, deps };
}

describe('webhook handling', () => {
  it('rejects unsigned, badly signed and oversized requests, and dedupes deliveries', async () => {
    const { app, send, repo } = setup();
    const body = fixture('pull_request.opened');
    expect(
      (
        await app.request('/webhooks', {
          method: 'POST',
          body,
          headers: { 'x-github-event': 'pull_request', 'x-github-delivery': 'x' },
        })
      ).status,
    ).toBe(401);
    expect(
      (await send('pull_request', body, { 'x-hub-signature-256': signBody('wrong', body) })).status,
    ).toBe(401);
    expect((await send('pull_request', body, { 'x-github-delivery': '' })).status).toBe(400);
    expect((await send('pull_request', body, { 'content-length': String(26 * 1024 * 1024) })).status).toBe(
      413,
    );
    const first = await send('pull_request', body, { 'x-github-delivery': 'same' });
    const again = await send('pull_request', body, { 'x-github-delivery': 'same' });
    expect(first.status).toBe(202);
    expect(again.status).toBe(200);
    expect(await again.text()).toBe('duplicate delivery');
    expect(repo.gh.checkRuns.length).toBeLessThanOrEqual(1);
    // A chunked body without Content-Length is capped while streaming, before the signature check.
    const big = new ReadableStream({
      start(controller) {
        const chunk = new Uint8Array(1024 * 1024);
        for (let i = 0; i < 26; i++) controller.enqueue(chunk);
        controller.close();
      },
    });
    const chunked = await app.request('/webhooks', {
      method: 'POST',
      body: big,
      headers: { 'x-github-event': 'pull_request', 'x-github-delivery': 'big' },
      duplex: 'half',
    } as RequestInit);
    expect(chunked.status).toBe(413);
    const bad = '{"action":"opened"}';
    expect((await send('pull_request', bad, { 'x-github-delivery': 'retry-me' })).status).toBe(400);
    // The failed delivery was released, so GitHub's redelivery is processed, not dropped as a duplicate.
    expect((await send('pull_request', body, { 'x-github-delivery': 'retry-me' })).status).toBe(202);
    expect((await send('pull_request', 'not json', { 'x-github-delivery': 'bad-json' })).status).toBe(400);
    expect((await send('pull_request', body, { 'x-github-delivery': 'bad-json' })).status).toBe(202);
  });

  it('reviews a PR on opened: check run, sticky comment, stored result', async () => {
    const { hook, repo, store, metrics } = setup();
    const res = await hook('pull_request', 'pull_request.opened');
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ handled: 'pull_request.opened' });
    expect(repo.gh.checkRuns).toHaveLength(1);
    expect(repo.gh.checkRuns[0]).toMatchObject({ status: 'completed', conclusion: 'neutral' });
    expect(repo.gh.posted.get('acme/reports#77')).toHaveLength(1);
    expect(store.reviews).toHaveLength(1);
    expect(metrics.render()).toContain('remit_reviews_total{status="done"} 1');
    // A second event for the same PR updates the one sticky comment instead of adding another.
    await hook('pull_request', 'pull_request.reopened');
    expect(repo.gh.posted.get('acme/reports#77')).toHaveLength(1);
    expect(repo.gh.checkRuns).toHaveLength(2);
  });

  it('handles every 10.2 pull_request action and ignores others', async () => {
    const { hook } = setup();
    for (const a of ['synchronize', 'ready_for_review', 'edited'])
      expect(await (await hook('pull_request', `pull_request.${a}`)).json()).toEqual({
        handled: `pull_request.${a}`,
      });
    expect(await (await hook('pull_request', 'pull_request.closed')).json()).toEqual({
      ignored: 'pull_request.closed',
    });
    expect(await (await hook('pull_request', 'pull_request.edited-base-only')).json()).toEqual({
      ignored: 'pull_request.edited (no title or body change)',
    });
    expect(await (await hook('ping', 'ping')).json()).toEqual({ handled: 'ping' });
    expect(await (await hook('star', 'ping')).json()).toEqual({ ignored: 'star' });
  });

  it('re-runs on check_run rerequested', async () => {
    const { hook, repo } = setup();
    await hook('check_run', 'check_run.rerequested');
    expect(repo.gh.checkRuns).toHaveLength(1);
  });

  it('tracks installations and deletes their data on uninstall', async () => {
    const { hook, store } = setup();
    await hook('installation', 'installation.created');
    expect(await store.installationOf('acme/reports')).toBe(4242);
    await hook('pull_request', 'pull_request.opened');
    await hook('installation_repositories', 'installation_repositories.added');
    expect(await store.installationOf('acme/other')).toBe(4242);
    await hook('installation', 'installation.deleted');
    expect(store.reviews).toHaveLength(0);
    expect(await store.installationOf('acme/other')).toBeNull();
  });
});

describe('slash commands', () => {
  it('accepts commands only from writers, ignores bots and plain comments', async () => {
    const { hook, repo } = setup();
    expect(await (await hook('issue_comment', 'issue_comment.review-by-reader')).json()).toEqual({
      handled: 'slash.review',
    });
    expect(repo.gh.checkRuns).toHaveLength(0);
    expect(await (await hook('issue_comment', 'issue_comment.from-bot')).json()).toEqual({
      ignored: 'bot comment',
    });
    expect(await (await hook('issue_comment', 'issue_comment.plain')).json()).toEqual({
      ignored: 'no command',
    });
    await hook('issue_comment', 'issue_comment.review');
    expect(repo.gh.checkRuns).toHaveLength(1);
  });

  it('records agree feedback, explains a finding, and prints help', async () => {
    const { hook, repo, store } = setup();
    await hook('pull_request', 'pull_request.opened');
    await hook('issue_comment', 'issue_comment.agree');
    expect(store.feedbackRows).toHaveLength(1);
    expect(store.feedbackRows[0]).toMatchObject({
      findingId: 'F-R3',
      label: 'agree',
      source: 'slash',
      login: 'maintainer',
    });
    await hook('issue_comment', 'issue_comment.explain');
    await hook('issue_comment', 'issue_comment.help');
    const bodies = (repo.gh.posted.get('acme/reports#77') ?? []).map((c) => c.body);
    expect(bodies.some((b) => b.startsWith('Recorded agree for 1 finding'))).toBe(true);
    expect(bodies.some((b) => b.includes('F-R3') && /threshold/i.test(b))).toBe(true);
    expect(bodies.some((b) => b.startsWith('### Remit commands'))).toBe(true);
  });
});

describe('issue-time checklist', () => {
  const config = 'issue_checklist: on_label\n';

  it('posts on label, confirms by the author, feeds reviews, and is invalidated by an edit', async () => {
    const { hook, repo, store } = setup({ config });
    await hook('issues', 'issues.labeled');
    const posted = repo.gh.posted.get('acme/reports#12') ?? [];
    expect(posted[0]?.body).toContain('<!-- remit:checklist v1');
    expect(posted[0]?.body).toContain('requirement');
    await hook('issue_comment', 'issue_comment.confirm');
    const confirmed = await store.getChecklist('acme/reports', 12);
    expect(confirmed?.confirmedBy).toBe('maya');
    await hook('pull_request', 'pull_request.opened');
    expect(store.reviews[0]?.result.requirements.every((r) => r.confirmed)).toBe(true);
    // Editing the issue text invalidates the confirmation and re-posts the checklist.
    const issue = repo.gh.issues.get('acme/reports#12');
    if (issue) issue.body = `${issue.body}\n\n- Also support TSV.`;
    await hook('issues', 'issues.edited');
    expect((await store.getChecklist('acme/reports', 12))?.confirmedBy).toBeUndefined();
    expect(
      repo.gh.posted.get('acme/reports#12')?.filter((c) => c.body.includes('remit:checklist')),
    ).toHaveLength(1);
  });

  it('a confirm on a changed issue re-reads it through the issue queue, not inline', async () => {
    const { hook, repo, store, queue } = setup({ config });
    await hook('issues', 'issues.labeled');
    const before = (await store.getChecklist('acme/reports', 12))?.contentHash;
    const issue = repo.gh.issues.get('acme/reports#12');
    if (issue) issue.body = `${issue.body}\n\n- Also support TSV.`;
    const keys: string[] = [];
    const enqueue = queue.enqueue.bind(queue);
    queue.enqueue = (key, job, opts) => {
      keys.push(key);
      return enqueue(key, job, opts);
    };
    await hook('issue_comment', 'issue_comment.confirm');
    expect(keys).toContain('issue:acme/reports#12');
    const after = await store.getChecklist('acme/reports', 12);
    expect(after?.confirmedBy).toBeUndefined();
    expect(after?.contentHash).not.toBe(before);
    const bodies = (repo.gh.posted.get('acme/reports#12') ?? []).map((c) => c.body);
    expect(bodies.some((b) => b.includes('will be read again shortly'))).toBe(true);
  });

  it('does nothing when the checklist is off or the label differs', async () => {
    const { hook, repo } = setup();
    await hook('issues', 'issues.labeled');
    await hook('issues', 'issues.assigned');
    expect(repo.gh.posted.get('acme/reports#12')).toBeUndefined();
  });
});

describe('modes', () => {
  it('config errors appear in the check run and defaults are used', async () => {
    const { hook, repo } = setup({ config: 'mode: loud\n' });
    await hook('pull_request', 'pull_request.opened');
    expect(repo.gh.checkRuns[0]?.output?.summary).toContain('.remit.yml');
  });

  it('rework mode posts the rework request with the configured mention', async () => {
    const { hook, repo } = setup({ config: 'mode: rework\nrework:\n  mention: "@claude"\n' });
    await hook('pull_request', 'pull_request.opened');
    const rework = repo.gh.posted.get('acme/reports#77')?.find((c) => c.body.includes('remit:rework'));
    expect(rework?.body).toContain('@claude This PR does not yet do everything');
    expect(repo.gh.checkRuns[0]?.conclusion).toBe('neutral');
  });

  it('gate mode refuses without calibration evidence and fails with it', async () => {
    const refused = setup({ config: 'mode: gate\n' });
    await refused.hook('pull_request', 'pull_request.opened');
    expect(refused.repo.gh.checkRuns[0]?.conclusion).toBe('neutral');
    expect(refused.store.reviews[0]?.result.summary.gateDecision).toBe('refused');
    const calibration: Calibration = {
      id: 'cal-1',
      jevModel: 'jev-1.13.0',
      questionSet: 'qs-0.1.0',
      maps: {},
      labeledFindings: 500,
      p0Precision: 0.95,
    };
    const gated = setup({ config: 'mode: gate\ngate:\n  threshold: 0.5\n', calibration });
    await gated.hook('pull_request', 'pull_request.opened');
    expect(gated.store.reviews[0]?.result.summary.gateDecision).toBe('fail');
    expect(gated.repo.gh.checkRuns[0]?.conclusion).toBe('failure');
  });

  it('adds inline comments and labels when enabled', async () => {
    const { hook, repo } = setup({ config: 'surfaces:\n  inline_comments: true\n  labels: true\n' });
    await hook('pull_request', 'pull_request.opened');
    expect(repo.gh.labels.get('acme/reports#77')).toEqual(['remit:needs-work']);
  });
});

describe('health, metrics and setup', () => {
  it('serves health, readiness and metrics', async () => {
    const { app } = setup();
    expect(await (await app.request('/healthz')).text()).toBe('ok');
    expect((await app.request('/readyz')).status).toBe(200);
    expect(await (await app.request('/metrics')).text()).toBe('\n');
  });

  it('runs the manifest flow with a one-time token, a state cookie and no-store headers', async () => {
    const saved: unknown[] = [];
    const { deps } = setup();
    const app = createApp({
      ...deps,
      secrets: { save: async (s) => void saved.push(s), load: async () => null },
      convert: async () => ({
        id: 5,
        slug: 'remit',
        htmlUrl: 'https://github.com/apps/remit',
        pem: 'PEM',
        webhookSecret: 'w',
        clientId: 'c',
        clientSecret: 's',
      }),
    });
    expect((await app.request('/setup?org=acme')).status).toBe(403);
    const page = await app.request('/setup?org=acme&token=setup-token-for-tests');
    expect(page.headers.get('cache-control')).toBe('no-store');
    expect(page.headers.get('referrer-policy')).toBe('no-referrer');
    expect(page.headers.get('content-security-policy')).toContain("default-src 'none'");
    const html = await page.text();
    expect(html).toContain('https://github.com/organizations/acme/settings/apps/new?state=');
    expect(html).toContain('https://remit.example.com/webhooks');
    const cookie = page.headers.get('set-cookie') ?? '';
    const state = /remit_setup_state=([0-9a-f]+)/.exec(cookie)?.[1] ?? '';
    expect((await app.request(`/setup/callback?code=abc&state=${state}`)).status).toBe(400);
    const done = await app.request(`/setup/callback?code=abc&state=${state}`, {
      headers: { cookie: `remit_setup_state=${state}` },
    });
    expect(done.headers.get('cache-control')).toBe('no-store');
    expect(await done.text()).toContain('https://github.com/apps/remit/installations/new');
    expect(saved).toHaveLength(1);
    // The token is single use: after a successful setup the flow is closed.
    expect((await app.request('/setup?token=setup-token-for-tests')).status).toBe(404);
    const noUrl = createApp({ ...deps, publicUrl: undefined as unknown as string });
    expect((await noUrl.request('/setup?token=setup-token-for-tests')).status).toBe(500);
  });

  it('closes setup once the App is configured, and when no setup token exists', async () => {
    const { deps } = setup();
    const configured = createApp({ ...deps, configured: async () => true });
    expect((await configured.request('/setup?token=setup-token-for-tests')).status).toBe(404);
    expect((await configured.request('/setup/callback?code=a&state=b')).status).toBe(404);
    const noToken = createApp({ ...deps, setupToken: undefined as unknown as string });
    expect((await noToken.request('/setup')).status).toBe(404);
  });

  it('protects /metrics with a bearer token when one is set', async () => {
    const { deps } = setup();
    const app = createApp({ ...deps, metricsToken: 'metrics-token' });
    expect((await app.request('/metrics')).status).toBe(401);
    expect(
      (await app.request('/metrics', { headers: { authorization: 'Bearer metrics-token' } })).status,
    ).toBe(200);
  });
});

describe('feedback dedupe', () => {
  it('records one label per finding and person when a command comment is edited', async () => {
    const { hook, store } = setup();
    await hook('pull_request', 'pull_request.opened');
    await hook('issue_comment', 'issue_comment.agree');
    await hook('issue_comment', 'issue_comment.agree');
    expect(store.feedbackRows).toHaveLength(1);
  });
});
