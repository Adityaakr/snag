/**
 * A local fake GitHub over HTTP for the end-to-end test (BUILD_PROMPT M7): the REST and GraphQL endpoints Remit uses,
 * backed by a FakeGitHub. It checks the App JWT signature on the token endpoint and requires the issued installation
 * token on every other call, so the test proves per-job tokens are used.
 */
import { createVerify, type KeyObject, randomBytes } from 'node:crypto';
import type { FakeGitHub } from '@remit/providers';
import { Hono } from 'hono';

export function fakeGitHubApi(
  gh: FakeGitHub,
  /** The App public key; null accepts any JWT for the App id (local stacks with a generated key). */
  appPublicKey: KeyObject | null,
  appId: string,
): { app: Hono; tokens: string[] } {
  const app = new Hono();
  const tokens: string[] = [];

  app.post('/app/installations/:id/access_tokens', (c) => {
    const jwt = (c.req.header('authorization') ?? '').replace(/^bearer /i, '');
    const [h, p, s] = jwt.split('.');
    const v = createVerify('RSA-SHA256');
    v.update(`${h}.${p}`);
    const payload = p
      ? (JSON.parse(Buffer.from(p, 'base64url').toString()) as { iss?: string; exp?: number })
      : {};
    const signed = appPublicKey
      ? Boolean(s) && v.verify(appPublicKey, Buffer.from(s as string, 'base64url'))
      : Boolean(s);
    if (!signed || payload.iss !== appId)
      return c.json({ message: 'A JSON web token could not be decoded' }, 401);
    const token = `ghs_fake${randomBytes(8).toString('hex')}`;
    tokens.push(token);
    return c.json({ token, expires_at: new Date(Date.now() + 3600_000).toISOString() }, 201);
  });

  app.get('/app', (c) =>
    (c.req.header('authorization') ?? '').toLowerCase().startsWith('bearer ')
      ? c.json({ id: Number(appId), slug: 'remit' })
      : c.json({ message: 'A JSON web token could not be decoded' }, 401),
  );

  app.use('/repos/*', async (c, next) => {
    const auth = c.req.header('authorization') ?? '';
    if (!tokens.some((t) => auth === `token ${t}`)) return c.json({ message: 'Bad credentials' }, 401);
    return next();
  });
  app.use('/graphql', async (c, next) => {
    const auth = c.req.header('authorization') ?? '';
    if (!tokens.some((t) => auth === `token ${t}` || auth === `bearer ${t}`))
      return c.json({ message: 'Bad credentials' }, 401);
    return next();
  });

  const notFound = (c: { json: (b: unknown, s: 404) => Response }) => c.json({ message: 'Not Found' }, 404);
  const ref = (c: { req: { param: (k: string) => string } }) => ({
    owner: c.req.param('o'),
    repo: c.req.param('r'),
    number: Number(c.req.param('n')),
  });

  app.get('/repos/:o/:r', async (c) =>
    c.json({ default_branch: await gh.getDefaultBranch(c.req.param('o'), c.req.param('r')) }),
  );
  app.get('/repos/:o/:r/pulls/:n', async (c) => {
    try {
      const p = await gh.getPull(ref(c));
      return c.json({
        title: p.title,
        body: p.body,
        draft: p.draft,
        user: { login: p.author, type: p.authorIsBot ? 'Bot' : 'User' },
        base: { sha: p.baseSha, ref: p.baseRef },
        head: { sha: p.headSha, ref: p.headRef, repo: { full_name: p.headRepo } },
      });
    } catch {
      return notFound(c);
    }
  });
  app.get('/repos/:o/:r/pulls/:n/files', async (c) => {
    if (Number(c.req.query('page') ?? 1) > 1) return c.json([]);
    const files = await gh.listPullFiles(ref(c));
    return c.json(
      files.map((f) => ({
        filename: f.filename,
        previous_filename: f.previousFilename,
        status: f.status,
        patch: f.patch,
        additions: f.additions,
        deletions: f.deletions,
      })),
    );
  });
  app.get('/repos/:o/:r/contents/*', async (c) => {
    const path = decodeURIComponent(c.req.path.split('/contents/')[1] ?? '');
    const r = await gh.getContent(c.req.param('o'), c.req.param('r'), path, c.req.query('ref') ?? 'main');
    if (!r || !('content' in r)) return notFound(c);
    const buf = Buffer.from(r.content);
    return c.json({ type: 'file', size: buf.length, encoding: 'base64', content: buf.toString('base64') });
  });
  app.get('/repos/:o/:r/issues/:n', async (c) => {
    const i = gh.issues.get(`${c.req.param('o')}/${c.req.param('r')}#${c.req.param('n')}`);
    if (!i) return notFound(c);
    return c.json({
      title: i.title,
      body: i.body,
      state: i.state ?? 'open',
      user: { login: i.author, type: 'User' },
    });
  });
  app.get('/repos/:o/:r/issues/:n/comments', async (c) => {
    if (Number(c.req.query('page') ?? 1) > 1) return c.json([]);
    const key = `${c.req.param('o')}/${c.req.param('r')}#${c.req.param('n')}`;
    const original = (gh.issues.get(key)?.comments ?? []).map((x, i) => ({
      id: i + 1,
      body: x.body,
      user: { login: x.author, type: x.userType ?? 'User' },
      author_association: x.association ?? 'NONE',
      created_at: x.createdAt ?? '2026-01-01T00:00:00Z',
    }));
    const posted = (gh.posted.get(key) ?? []).map((x) => ({
      id: x.id,
      body: x.body,
      user: { login: x.author, type: 'Bot' },
      author_association: 'NONE',
      created_at: '2026-01-01T00:00:00Z',
    }));
    return c.json([...original, ...posted]);
  });
  app.post('/repos/:o/:r/issues/:n/comments', async (c) => {
    const { body } = await c.req.json<{ body: string }>();
    return c.json(await gh.createIssueComment(ref(c), body), 201);
  });
  app.patch('/repos/:o/:r/issues/comments/:id', async (c) => {
    const { body } = await c.req.json<{ body: string }>();
    await gh.updateIssueComment(c.req.param('o'), c.req.param('r'), Number(c.req.param('id')), body);
    return c.json({ id: Number(c.req.param('id')) });
  });
  app.post('/repos/:o/:r/issues/:n/labels', async (c) => {
    const { labels } = await c.req.json<{ labels: string[] }>();
    await gh.addLabels(ref(c), labels);
    return c.json([]);
  });
  app.post('/repos/:o/:r/check-runs', async (c) => {
    const b = await c.req.json<{
      name: string;
      head_sha: string;
      status: 'in_progress';
      external_id?: string;
    }>();
    const r = await gh.createCheckRun(c.req.param('o'), c.req.param('r'), {
      name: b.name,
      headSha: b.head_sha,
      status: b.status,
      ...(b.external_id ? { externalId: b.external_id } : {}),
    });
    return c.json(r, 201);
  });
  app.patch('/repos/:o/:r/check-runs/:id', async (c) => {
    const b = await c.req.json<Parameters<FakeGitHub['updateCheckRun']>[3]>();
    await gh.updateCheckRun(c.req.param('o'), c.req.param('r'), Number(c.req.param('id')), b);
    return c.json({ id: Number(c.req.param('id')) });
  });
  app.post('/repos/:o/:r/pulls/:n/reviews', async (c) => {
    const b = await c.req.json<{
      commit_id: string;
      comments: { path: string; line: number; body: string }[];
    }>();
    await gh.createReviewComments(ref(c), b.commit_id, b.comments);
    return c.json({ id: 1 });
  });
  app.get('/repos/:o/:r/collaborators/:u/permission', async (c) => {
    const p = await gh.getPermission(c.req.param('o'), c.req.param('r'), c.req.param('u'));
    return p === 'none' ? notFound(c) : c.json({ permission: p, role_name: p });
  });
  app.post('/graphql', async (c) => {
    const { variables } = await c.req.json<{ variables: { owner: string; repo: string; number: number } }>();
    const refs = await gh.closingIssues(variables);
    return c.json({
      data: {
        repository: {
          pullRequest: {
            closingIssuesReferences: {
              nodes: refs.map((r) => ({
                number: r.number,
                repository: { name: r.repo, owner: { login: r.owner } },
              })),
            },
          },
        },
      },
    });
  });
  /** Test and smoke-check introspection: check runs, posted comments and labels. */
  app.get('/__fake/state', (c) =>
    c.json({
      checkRuns: gh.checkRuns.map((r) => ({
        id: r.id,
        repo: `${r.owner}/${r.repo}`,
        status: r.status,
        conclusion: r.conclusion ?? null,
        title: r.output?.title ?? null,
      })),
      comments: Object.fromEntries(
        [...gh.posted.entries()].map(([k, v]) => [k, v.map((x) => x.body.slice(0, 200))]),
      ),
    }),
  );
  return { app, tokens };
}
