import { createVerify, generateKeyPairSync } from 'node:crypto';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { appJwt, appSlug, convertManifest, installationToken } from './app.js';
import { FakeGitHub } from './fake.js';
import { LiveGitHub } from './live.js';

const API = 'https://api.github.com';
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
const token = ['test', 'token', 'not', 'real'].join('-');
const gh = () => new LiveGitHub({ token, retry: { attempts: 1 } });
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();

describe('LiveGitHub writer (msw)', () => {
  it('creates and updates check runs, comments, labels and reviews', async () => {
    const seen: Record<string, unknown> = {};
    server.use(
      http.post(`${API}/repos/a/r/check-runs`, async ({ request }) => {
        seen.create = await request.json();
        return HttpResponse.json({ id: 7 });
      }),
      http.patch(`${API}/repos/a/r/check-runs/7`, async ({ request }) => {
        seen.update = await request.json();
        return HttpResponse.json({ id: 7 });
      }),
      http.get(`${API}/repos/a/r/issues/3/comments`, () =>
        HttpResponse.json([
          { id: 1, body: 'hi', user: { login: 'remit[bot]', type: 'Bot' } },
          { id: 2, body: null, user: null },
        ]),
      ),
      http.post(`${API}/repos/a/r/issues/3/comments`, () => HttpResponse.json({ id: 9 })),
      http.patch(`${API}/repos/a/r/issues/comments/9`, async ({ request }) => {
        seen.comment = await request.json();
        return HttpResponse.json({ id: 9 });
      }),
      http.post(`${API}/repos/a/r/issues/3/labels`, async ({ request }) => {
        seen.labels = await request.json();
        return HttpResponse.json([]);
      }),
      http.post(`${API}/repos/a/r/pulls/3/reviews`, async ({ request }) => {
        seen.review = await request.json();
        return HttpResponse.json({ id: 1 });
      }),
      http.get(`${API}/repos/a/r/collaborators/dev/permission`, () =>
        HttpResponse.json({ permission: 'write', role_name: 'maintain' }),
      ),
      http.get(
        `${API}/repos/a/r/collaborators/nobody/permission`,
        () => new HttpResponse(null, { status: 404 }),
      ),
      http.get(`${API}/repos/a/r`, () => HttpResponse.json({ default_branch: 'trunk' })),
    );
    const g = gh();
    expect(
      await g.createCheckRun('a', 'r', {
        name: 'Remit',
        headSha: 'h',
        status: 'in_progress',
        externalId: 'rev1',
      }),
    ).toEqual({ id: 7 });
    expect(seen.create).toMatchObject({
      name: 'Remit',
      head_sha: 'h',
      status: 'in_progress',
      external_id: 'rev1',
    });
    await g.updateCheckRun('a', 'r', 7, {
      status: 'completed',
      conclusion: 'neutral',
      output: { title: 't', summary: 's' },
    });
    expect(seen.update).toMatchObject({ status: 'completed', conclusion: 'neutral', output: { title: 't' } });
    const ref = { owner: 'a', repo: 'r', number: 3 };
    expect(await g.listIssueComments(ref)).toEqual([
      { id: 1, body: 'hi', author: 'remit[bot]', authorIsBot: true },
      { id: 2, body: '', author: 'ghost', authorIsBot: false },
    ]);
    expect(await g.createIssueComment(ref, 'x')).toEqual({ id: 9 });
    await g.updateIssueComment('a', 'r', 9, 'y');
    expect(seen.comment).toEqual({ body: 'y' });
    await g.addLabels(ref, []);
    await g.addLabels(ref, ['remit:missing']);
    expect(seen.labels).toEqual({ labels: ['remit:missing'] });
    await g.createReviewComments(ref, 'h', []);
    await g.createReviewComments(ref, 'h', [{ path: 'a.ts', line: 3, body: 'b' }]);
    expect(seen.review).toMatchObject({
      commit_id: 'h',
      event: 'COMMENT',
      comments: [{ path: 'a.ts', line: 3, side: 'RIGHT' }],
    });
    expect(await g.getPermission('a', 'r', 'dev')).toBe('maintain');
    expect(await g.getPermission('a', 'r', 'nobody')).toBe('none');
    expect(await g.getDefaultBranch('a', 'r')).toBe('trunk');
  });
});

describe('FakeGitHub writer', () => {
  it('keeps check runs, posted comments, labels, reviews and permissions in memory', async () => {
    const f = new FakeGitHub().addIssue(
      { owner: 'a', repo: 'r', number: 1 },
      { title: 'T', body: 'B', author: 'u', comments: [{ id: 'c1', author: 'u', body: 'first' }] },
    );
    const run = await f.createCheckRun('a', 'r', { name: 'Remit', headSha: 'h', status: 'in_progress' });
    await f.updateCheckRun('a', 'r', run.id, {
      status: 'completed',
      conclusion: 'success',
      output: { title: 't', summary: 's', annotations: [] },
    });
    expect(f.checkRuns[0]).toMatchObject({ status: 'completed', conclusion: 'success', updates: 1 });
    const tooMany = Array.from({ length: 51 }, () => ({
      path: 'a',
      start_line: 1,
      end_line: 1,
      annotation_level: 'notice' as const,
      title: 't',
      message: 'm',
    }));
    await expect(
      f.updateCheckRun('a', 'r', run.id, { output: { title: 't', summary: 's', annotations: tooMany } }),
    ).rejects.toThrow(/50/);
    await expect(f.updateCheckRun('a', 'r', 999, {})).rejects.toThrow(/404/);
    const ref = { owner: 'a', repo: 'r', number: 1 };
    const c = await f.createIssueComment(ref, 'hello');
    await f.updateIssueComment('a', 'r', c.id, 'edited');
    expect((await f.listIssueComments(ref)).map((x) => x.body)).toEqual(['first', 'edited']);
    await expect(f.updateIssueComment('a', 'r', 1, 'x')).rejects.toThrow(/404/);
    await f.addLabels(ref, ['x']);
    await f.addLabels(ref, ['x', 'y']);
    expect(f.labels.get('a/r#1')).toEqual(['x', 'y']);
    await f.createReviewComments(ref, 'h', [{ path: 'a.ts', line: 1, body: 'b' }]);
    expect(f.reviewComments).toHaveLength(1);
    f.permissions.set('a/r:dev', 'write');
    expect(await f.getPermission('a', 'r', 'dev')).toBe('write');
    expect(await f.getPermission('a', 'r', 'x')).toBe('none');
    expect(await f.getDefaultBranch('a', 'r')).toBe('main');
  });
});

describe('GitHub App auth', () => {
  it('signs a verifiable RS256 JWT within the 10 minute limit', () => {
    const jwt = appJwt('123', pem, 1_700_000_000_000);
    const [h, p, sig] = jwt.split('.');
    const payload = JSON.parse(Buffer.from(p as string, 'base64url').toString());
    expect(payload).toEqual({ iat: 1_700_000_000 - 60, exp: 1_700_000_000 + 540, iss: '123' });
    const v = createVerify('RSA-SHA256');
    v.update(`${h}.${p}`);
    expect(v.verify(publicKey, Buffer.from(sig as string, 'base64url'))).toBe(true);
    expect(() => appJwt('1', 'not a key')).toThrow(/private key/);
  });

  it('exchanges the JWT for an installation token and converts a manifest code', async () => {
    let auth = '';
    server.use(
      http.post(`${API}/app/installations/42/access_tokens`, ({ request }) => {
        auth = request.headers.get('authorization') ?? '';
        return HttpResponse.json({ token: 'installation-value', expires_at: '2026-01-01T01:00:00Z' });
      }),
      http.post(`${API}/app-manifests/abc123/conversions`, () =>
        HttpResponse.json({
          id: 5,
          slug: 'remit',
          html_url: 'https://github.com/apps/remit',
          pem: 'PEM',
          webhook_secret: 'w',
          client_id: 'c',
          client_secret: 's',
        }),
      ),
    );
    expect(await installationToken({ appId: '1', privateKey: pem }, 42)).toEqual({
      token: 'installation-value',
      expiresAt: '2026-01-01T01:00:00Z',
    });
    expect(auth).toMatch(/^bearer ey/i);
    expect(await convertManifest('abc123')).toMatchObject({ id: 5, slug: 'remit', webhookSecret: 'w' });
    await expect(convertManifest('bad code!')).rejects.toThrow(/invalid manifest code/);
    server.use(http.get(`${API}/app`, () => HttpResponse.json({ id: 1, slug: 'remit-acme' })));
    expect(await appSlug({ appId: '1', privateKey: pem })).toBe('remit-acme');
  });
});
