/**
 * End to end (BUILD_PROMPT M7): the real server on a socket, LiveGitHub with App JWT and installation tokens,
 * against a local fake GitHub over HTTP. Webhook -> job -> review -> check run, sticky comment and slash command.
 */
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { installationToken, LiveGitHub } from '@remit/providers';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { MemoryDeliveryStore } from './deliveries.js';
import { fakeRepo } from './fake-harness.js';
import { fakeGitHubApi } from './fake-github-server.js';
import { Metrics } from './metrics.js';
import { MemoryQueue } from './queue.js';
import { MemoryStore } from './store.js';
import { signBody } from './webhook-verify.js';

const FIXTURES = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'webhooks');
const closers: (() => void)[] = [];
afterAll(() => {
  for (const c of closers) c();
});

function listen(fetch: (r: Request) => Response | Promise<Response>): Promise<string> {
  return new Promise((resolve) => {
    const server = serve({ fetch, port: 0, hostname: '127.0.0.1' }, (info: AddressInfo) =>
      resolve(`http://127.0.0.1:${info.port}`),
    );
    closers.push(() => server.close());
  });
}

describe('end to end through a local fake GitHub', () => {
  it('reviews a PR from a signed webhook over HTTP and answers a slash command', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
    const repo = fakeRepo('three_reqs_one_missing');
    const api = fakeGitHubApi(repo.gh, publicKey, '321');
    const githubUrl = await listen(api.app.fetch);
    const secret = ['e2e', 'webhook', 'secret'].join('-');
    const queue = new MemoryQueue();
    const store = new MemoryStore();
    const remit = createApp({
      webhookSecret: secret,
      deliveries: new MemoryDeliveryStore(),
      metrics: new Metrics(),
      queue,
      store,
      debounceMs: 0,
      providers: repo.providers,
      github: async (installationId) => {
        const { token } = await installationToken(
          { appId: '321', privateKey: pem, baseUrl: githubUrl },
          installationId,
        );
        return new LiveGitHub({ token, baseUrl: githubUrl, retry: { attempts: 1 } });
      },
    });
    const remitUrl = await listen(remit.fetch);
    const post = async (event: string, file: string, delivery: string) => {
      const body = readFileSync(join(FIXTURES, `${file}.json`), 'utf8');
      const res = await fetch(`${remitUrl}/webhooks`, {
        method: 'POST',
        body,
        headers: {
          'content-type': 'application/json',
          'x-github-event': event,
          'x-github-delivery': delivery,
          'x-hub-signature-256': signBody(secret, body),
        },
      });
      await queue.idle();
      return res;
    };

    const res = await post('pull_request', 'pull_request.opened', 'e2e-1');
    expect(res.status).toBe(202);
    expect(repo.gh.checkRuns).toHaveLength(1);
    expect(repo.gh.checkRuns[0]).toMatchObject({ status: 'completed', conclusion: 'neutral' });
    const summary = repo.gh.posted.get('acme/reports#77')?.[0]?.body ?? '';
    expect(summary).toContain('<!-- remit:summary v1');
    expect(summary).toMatch(/missing/i);
    expect(store.reviews).toHaveLength(1);

    await post('issue_comment', 'issue_comment.agree', 'e2e-2');
    expect(store.feedbackRows).toHaveLength(1);
    // One installation token per job: the review and the slash command each asked for their own.
    expect(api.tokens.length).toBeGreaterThanOrEqual(2);
    expect(new Set(api.tokens).size).toBe(api.tokens.length);

    // A request signed with the wrong secret never reaches the fake GitHub.
    const calls = repo.gh.calls.length;
    const bad = await fetch(`${remitUrl}/webhooks`, {
      method: 'POST',
      body: '{}',
      headers: {
        'x-github-event': 'pull_request',
        'x-github-delivery': 'e2e-3',
        'x-hub-signature-256': signBody('nope', '{}'),
      },
    });
    expect(bad.status).toBe(401);
    expect(repo.gh.calls.length).toBe(calls);
  }, 30_000);
});

describe('fake GitHub API guards', () => {
  it('rejects bad JWTs and calls without an installation token', async () => {
    const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const { privateKey: other } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const repo = fakeRepo('three_reqs_one_missing');
    const api = fakeGitHubApi(repo.gh, publicKey, '321');
    const { appJwt } = await import('@remit/providers');
    const forged = appJwt('321', other.export({ type: 'pkcs1', format: 'pem' }).toString());
    expect(
      (
        await api.app.request('/app/installations/1/access_tokens', {
          method: 'POST',
          headers: { authorization: `Bearer ${forged}` },
        })
      ).status,
    ).toBe(401);
    expect((await api.app.request('/repos/acme/reports/pulls/77')).status).toBe(401);
    expect((await api.app.request('/graphql', { method: 'POST', body: '{}' })).status).toBe(401);
  });
});
