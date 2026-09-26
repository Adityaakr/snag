import { parseDiff } from '@remit/analysis';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { pullDiff } from './diff.js';
import { FakeGitHub } from './fake.js';
import { closingKeywordRefs, linkIssues, plainRefs } from './links.js';
import { classifyGitHubError, LiveGitHub } from './live.js';
import { commentRole, isBotComment } from './roles.js';

const API = 'https://api.github.com';
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const gh = (extra: Partial<ConstructorParameters<typeof LiveGitHub>[0]> = {}) =>
  new LiveGitHub({ token: 'test-token-not-real', retry: { sleep: async () => {} }, ...extra });

describe('linked issues (6.1)', () => {
  it.each([
    ['Fixes #12', [12]],
    ['closes #3 and resolves #4', [3, 4]],
    ['Resolved: acme/other#9', [9]],
    ['fixed https://github.com/acme/app/issues/77', [77]],
    ['FIXES #5.', [5]],
  ])('closing keywords in %j', (body, numbers) => {
    expect(closingKeywordRefs(body, 'acme', 'app').map((r) => r.number)).toEqual(numbers);
  });

  it('ignores keywords inside code and comments', () => {
    expect(closingKeywordRefs('```\nfixes #1\n```\n`closes #2` <!-- resolves #3 -->', 'acme', 'app')).toEqual(
      [],
    );
  });

  it('reads cross-repo references', () => {
    expect(closingKeywordRefs('fixes acme/other#9', 'acme', 'app')).toEqual([
      { owner: 'acme', repo: 'other', number: 9 },
    ]);
  });

  it('prefers GraphQL plus keywords, then falls back to weak plain refs', () => {
    expect(
      linkIssues([{ owner: 'acme', repo: 'app', number: 31 }], 'Also closes #32', 'acme', 'app'),
    ).toEqual({
      issues: [
        { owner: 'acme', repo: 'app', number: 31 },
        { owner: 'acme', repo: 'app', number: 32 },
      ],
      strength: 'closing',
    });
    expect(linkIssues([], 'Related to #8, refs #9', 'acme', 'app')).toMatchObject({
      strength: 'weak',
      issues: [{ number: 8 }, { number: 9 }],
    });
    expect(linkIssues([], 'No references here, just C# notes', 'acme', 'app')).toEqual({
      issues: [],
      strength: 'none',
    });
    expect(plainRefs('see #4 and #4', 'a', 'b')).toHaveLength(1);
  });
});

describe('roles and bots', () => {
  it.each([
    ['maya', 'NONE', 'maya', 'author'],
    ['lee', 'MEMBER', 'maya', 'maintainer'],
    ['kim', 'OWNER', 'maya', 'maintainer'],
    ['jo', 'COLLABORATOR', 'maya', 'maintainer'],
    ['sam', 'CONTRIBUTOR', 'maya', 'other'],
  ])('%s (%s) on an issue by %s is %s', (login, assoc, author, role) => {
    expect(commentRole(login, assoc, author)).toBe(role);
  });

  it('skips bots and Remit comments', () => {
    expect(isBotComment('dependabot[bot]', 'Bot', 'x')).toBe(true);
    expect(isBotComment('renovate', 'Bot', 'x')).toBe(true);
    expect(isBotComment('maya', 'User', 'summary\n<!-- remit:summary v1 -->')).toBe(true);
    expect(isBotComment('maya', 'User', 'looks good')).toBe(false);
  });
});

describe('pullDiff', () => {
  const pr = {
    ref: { owner: 'acme', repo: 'app', number: 5 },
    title: 't',
    body: '',
    author: 'bot',
    authorIsBot: true,
    draft: false,
    baseSha: 'b1',
    headSha: 'h1',
    baseRef: 'main',
    headRef: 'f',
    headRepo: 'fork/app',
  };

  it('assembles patches, diffs locally when a patch is missing, and marks binaries', async () => {
    const fake = new FakeGitHub()
      .addContent('acme', 'app', 'b1', 'big.ts', 'export const a = 1;\n')
      .addContent('fork', 'app', 'h1', 'big.ts', 'export const a = 2;\n')
      .addContent('acme', 'app', 'b1', 'img.png', Buffer.from([0, 1, 2]))
      .addContent('fork', 'app', 'h1', 'img.png', Buffer.from([0, 9, 9]));
    const { text, ignored } = await pullDiff(fake, pr, [
      { filename: 'src/a.ts', status: 'modified', patch: '@@ -1 +1 @@\n-a\n+b', additions: 1, deletions: 1 },
      { filename: 'big.ts', status: 'modified', additions: 1, deletions: 1 },
      { filename: 'img.png', status: 'modified', additions: 0, deletions: 0 },
      { filename: 'new.ts', previousFilename: 'old.ts', status: 'renamed', additions: 0, deletions: 0 },
    ]);
    const files = parseDiff(text).files;
    expect(files.map((f) => [f.newPath, f.status, f.binary])).toEqual([
      ['src/a.ts', 'modified', false],
      ['big.ts', 'modified', false],
      ['img.png', 'modified', true],
      ['new.ts', 'renamed', false],
    ]);
    expect(files[1]?.hunks[0]?.lines.map((l) => `${l.type}:${l.content}`)).toEqual([
      'del:export const a = 1;',
      'add:export const a = 2;',
    ]);
    expect(ignored).toEqual([{ file: 'img.png', reason: 'binary' }]);
    // Head contents come from the fork for fork PRs.
    expect(fake.calls).toContain('getContent fork/app@h1:big.ts');
  });

  it('handles added and removed files without patches, and an empty file list', async () => {
    const fake = new FakeGitHub()
      .addContent('fork', 'app', 'h1', 'n.py', 'x = 1\n')
      .addContent('acme', 'app', 'b1', 'gone.py', 'y = 2\n');
    const { text } = await pullDiff(fake, pr, [
      { filename: 'n.py', status: 'added', additions: 1, deletions: 0 },
      { filename: 'gone.py', status: 'removed', additions: 0, deletions: 1 },
    ]);
    expect(parseDiff(text).files.map((f) => [f.status, f.oldPath, f.newPath])).toEqual([
      ['added', null, 'n.py'],
      ['deleted', 'gone.py', null],
    ]);
    expect((await pullDiff(fake, pr, [])).text).toBe('');
  });
});

describe('LiveGitHub (msw)', () => {
  it('reads PR metadata with the token and a Remit user agent', async () => {
    let auth = '';
    server.use(
      http.get(`${API}/repos/acme/app/pulls/5`, ({ request }) => {
        auth = request.headers.get('authorization') ?? '';
        return HttpResponse.json({
          title: 'Add CSV export',
          body: null,
          draft: true,
          user: { login: 'agent[bot]', type: 'Bot' },
          base: { sha: 'b1', ref: 'main' },
          head: { sha: 'h1', ref: 'feat', repo: { full_name: 'fork/app' } },
        });
      }),
    );
    expect(await gh().getPull({ owner: 'acme', repo: 'app', number: 5 })).toMatchObject({
      title: 'Add CSV export',
      body: '',
      draft: true,
      authorIsBot: true,
      headRepo: 'fork/app',
      baseSha: 'b1',
    });
    expect(auth).toBe('token test-token-not-real');
  });

  it('paginates PR files', async () => {
    const pages: number[] = [];
    server.use(
      http.get(`${API}/repos/acme/app/pulls/5/files`, ({ request }) => {
        const page = Number(new URL(request.url).searchParams.get('page'));
        pages.push(page);
        const n = page < 3 ? 100 : 50;
        return HttpResponse.json(
          Array.from({ length: n }, (_, i) => ({
            filename: `f${page}-${i}.ts`,
            status: 'modified',
            additions: 1,
            deletions: 0,
            patch: '@@ -0,0 +1 @@\n+x',
          })),
        );
      }),
    );
    const files = await gh().listPullFiles({ owner: 'acme', repo: 'app', number: 5 });
    expect(files).toHaveLength(250);
    expect(pages).toEqual([1, 2, 3]);
  });

  it('reads contents at a SHA with a size guard, and returns null for 404 and directories', async () => {
    server.use(
      http.get(`${API}/repos/acme/app/contents/:path`, ({ params, request }) => {
        const ref = new URL(request.url).searchParams.get('ref');
        if (params.path === 'a.ts')
          return HttpResponse.json({
            type: 'file',
            size: 10,
            encoding: 'base64',
            content: Buffer.from(`at ${ref}`).toString('base64'),
          });
        if (params.path === 'big.bin')
          return HttpResponse.json({ type: 'file', size: 5_000_000, encoding: 'base64', content: '' });
        if (params.path === 'z.bin')
          return HttpResponse.json({
            type: 'file',
            size: 3,
            encoding: 'base64',
            content: Buffer.from([0, 1, 2]).toString('base64'),
          });
        if (params.path === 'dir') return HttpResponse.json([{ type: 'file', name: 'x' }]);
        return HttpResponse.json({ message: 'Not Found' }, { status: 404 });
      }),
    );
    const g = gh();
    expect(await g.getContent('acme', 'app', 'a.ts', 'h1')).toEqual({ content: 'at h1' });
    expect(await g.getContent('acme', 'app', 'big.bin', 'h1')).toEqual({ skipped: 'too_large' });
    expect(await g.getContent('acme', 'app', 'z.bin', 'h1')).toEqual({ skipped: 'binary' });
    expect(await g.getContent('acme', 'app', 'dir', 'h1')).toBeNull();
    expect(await g.getContent('acme', 'app', 'missing.ts', 'h1')).toBeNull();
  });

  it('reads issues with comment roles, skipping bots and Remit comments', async () => {
    server.use(
      http.get(`${API}/repos/acme/app/issues/12`, () =>
        HttpResponse.json({
          title: 'CSV export',
          body: '- [ ] header row',
          state: 'open',
          user: { login: 'maya' },
        }),
      ),
      http.get(`${API}/repos/acme/app/issues/12/comments`, () =>
        HttpResponse.json([
          {
            id: 1,
            user: { login: 'maya', type: 'User' },
            author_association: 'NONE',
            created_at: '2026-09-01T00:00:00Z',
            body: 'Also the date',
          },
          {
            id: 2,
            user: { login: 'lee', type: 'User' },
            author_association: 'MEMBER',
            created_at: '2026-09-02T00:00:00Z',
            body: 'ISO dates please',
          },
          {
            id: 3,
            user: { login: 'github-actions[bot]', type: 'Bot' },
            author_association: 'NONE',
            created_at: '2026-09-03T00:00:00Z',
            body: 'CI passed',
          },
          {
            id: 4,
            user: { login: 'remit-app', type: 'User' },
            author_association: 'NONE',
            created_at: '2026-09-04T00:00:00Z',
            body: 'Checklist\n<!-- remit:summary v1 -->',
          },
          {
            id: 5,
            user: { login: 'sam', type: 'User' },
            author_association: 'CONTRIBUTOR',
            created_at: '2026-09-05T00:00:00Z',
            body: 'me too',
          },
        ]),
      ),
    );
    const issue = await gh().getIssue({ owner: 'acme', repo: 'app', number: 12 });
    expect(issue.comments.map((c) => [c.id, c.role])).toEqual([
      ['1', 'author'],
      ['2', 'maintainer'],
      ['5', 'other'],
    ]);
    expect(issue.contentHash).toMatch(/^sha256:/);
  });

  it('reads closingIssuesReferences over GraphQL', async () => {
    server.use(
      http.post(`${API}/graphql`, async ({ request }) => {
        const body = (await request.json()) as { variables: { number: number } };
        expect(body.variables.number).toBe(5);
        return HttpResponse.json({
          data: {
            repository: {
              pullRequest: {
                closingIssuesReferences: {
                  nodes: [{ number: 31, repository: { name: 'app', owner: { login: 'acme' } } }],
                },
              },
            },
          },
        });
      }),
    );
    expect(await gh().closingIssues({ owner: 'acme', repo: 'app', number: 5 })).toEqual([
      { owner: 'acme', repo: 'app', number: 31 },
    ]);
  });

  it('waits for the rate limit reset, then retries', async () => {
    let n = 0;
    const sleeps: number[] = [];
    server.use(
      http.get(`${API}/repos/acme/app/pulls/5`, () => {
        if (n++ === 0)
          return HttpResponse.json(
            { message: 'API rate limit exceeded' },
            { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1002' } },
          );
        return HttpResponse.json({
          title: 't',
          body: '',
          draft: false,
          user: { login: 'a', type: 'User' },
          base: { sha: 'b', ref: 'main' },
          head: { sha: 'h', ref: 'f', repo: null },
        });
      }),
    );
    const g = gh({ now: () => 1_000_000, retry: { sleep: async (ms) => void sleeps.push(ms) } });
    await g.getPull({ owner: 'acme', repo: 'app', number: 5 });
    expect(n).toBe(2);
    expect(sleeps).toEqual([3000]);
  });

  it('classifies secondary limits, auth, not found and server errors', () => {
    expect(classifyGitHubError({ status: 403, response: { headers: { 'retry-after': '7' } } })).toMatchObject(
      { kind: 'rate_limited', retryAfterMs: 7000 },
    );
    expect(classifyGitHubError({ status: 403, response: { headers: {} } })).toMatchObject({ kind: 'auth' });
    expect(classifyGitHubError({ status: 401 })).toMatchObject({
      kind: 'auth',
      fix: expect.stringMatching(/GITHUB_TOKEN/),
    });
    expect(classifyGitHubError({ status: 404 })).toMatchObject({ kind: 'bad_request' });
    expect(classifyGitHubError({ status: 502 })).toMatchObject({ kind: 'server', retryable: true });
    expect(classifyGitHubError(new Error('ECONNRESET'))).toMatchObject({ kind: 'connection' });
  });
});
