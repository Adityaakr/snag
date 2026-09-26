import { FakeGitHub } from '@remit/providers';
import { describe, expect, it } from 'vitest';
import { ingestPullRequest, parsePullTarget } from './ingest.js';

const pull = (over: Record<string, unknown> = {}) => ({
  title: 'Add CSV export',
  body: 'Closes #12',
  author: 'agent[bot]',
  authorIsBot: true,
  draft: false,
  baseSha: 'b1',
  headSha: 'h1',
  files: [
    {
      filename: 'src/a.ts',
      status: 'modified' as const,
      patch: '@@ -1 +1 @@\n-a\n+b',
      additions: 1,
      deletions: 1,
    },
  ],
  ...over,
});

describe('GitHub ingest (6.1)', () => {
  it('reads the PR, rebuilds the diff and links issues by closing keyword', async () => {
    const gh = new FakeGitHub()
      .addPull({ owner: 'acme', repo: 'app', number: 5 }, pull())
      .addIssue(
        { owner: 'acme', repo: 'app', number: 12 },
        { title: 'CSV', body: '- [ ] x', author: 'maya' },
      );
    const r = await ingestPullRequest(gh, { owner: 'acme', repo: 'app', number: 5 });
    expect(r.input).toMatchObject({
      mode: 'github',
      repo: 'acme/app',
      prNumber: 5,
      linkStrength: 'closing',
      baseSha: 'b1',
      headSha: 'h1',
      pr: { title: 'Add CSV export', body: 'Closes #12' },
    });
    expect(r.input.issues.map((i) => i.ref.number)).toEqual([12]);
    expect(r.input.diffText).toContain('diff --git a/src/a.ts b/src/a.ts');
  });

  it('prefers GraphQL closing references and falls back to weak plain references', async () => {
    const gh = new FakeGitHub()
      .addPull(
        { owner: 'acme', repo: 'app', number: 6 },
        pull({ body: 'See #7', closing: [{ owner: 'acme', repo: 'app', number: 31 }] }),
      )
      .addPull({ owner: 'acme', repo: 'app', number: 8 }, pull({ body: 'Related to #7' }))
      .addIssue({ owner: 'acme', repo: 'app', number: 31 }, { title: 'a', body: 'b', author: 'm' })
      .addIssue({ owner: 'acme', repo: 'app', number: 7 }, { title: 'c', body: 'd', author: 'm' });
    expect(
      (await ingestPullRequest(gh, { owner: 'acme', repo: 'app', number: 6 })).input.issueRefs.map(
        (i) => i.number,
      ),
    ).toEqual([31]);
    const weak = await ingestPullRequest(gh, { owner: 'acme', repo: 'app', number: 8 });
    expect(weak.input.linkStrength).toBe('weak');
    expect(weak.warnings.join('\n')).toMatch(/plain issue references/);
  });

  it('reports unreadable issues and no links', async () => {
    const gh = new FakeGitHub()
      .addPull({ owner: 'acme', repo: 'app', number: 9 }, pull({ body: 'Fixes #404' }))
      .addPull({ owner: 'acme', repo: 'app', number: 10 }, pull({ body: 'Nothing linked' }));
    const r = await ingestPullRequest(gh, { owner: 'acme', repo: 'app', number: 9 });
    expect(r.input.linkStrength).toBe('none');
    expect(r.warnings.join('\n')).toMatch(/acme\/app#404 could not be read/);
    expect((await ingestPullRequest(gh, { owner: 'acme', repo: 'app', number: 10 })).input.issues).toEqual(
      [],
    );
  });

  it('parses PR targets', () => {
    expect(parsePullTarget('https://github.com/acme/app/pull/5/files')).toEqual({
      owner: 'acme',
      repo: 'app',
      number: 5,
    });
    expect(parsePullTarget('acme/app#5')).toEqual({ owner: 'acme', repo: 'app', number: 5 });
    expect(parsePullTarget('https://gitlab.com/acme/app/pull/5')).toBeNull();
  });
});
