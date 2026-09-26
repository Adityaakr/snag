/**
 * A local fake GitHub for integration and end-to-end tests (BUILD_PROMPT M7): a golden scenario becomes a repository
 * in FakeGitHub (issue, pull request, changed files with patches, base and head contents), with that scenario's
 * scripted Jev and LLM as providers.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { filePath, parseDiff, renderHunk } from '@remit/analysis';
import type { RemitConfig } from '@remit/core';
import { loadScenario } from '@remit/pipeline';
import { FakeGitHub, FakeJev, FakeLlm, type PullFile, type PullRef } from '@remit/providers';

function tree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else out[relative(dir, p).split('\\').join('/')] = readFileSync(p, 'utf8');
    }
  };
  try {
    walk(dir);
  } catch {
    // A scenario without this side (for example no base tree) has no files there.
  }
  return out;
}

export interface FakeRepo {
  gh: FakeGitHub;
  pr: PullRef;
  installationId: number;
  providers: (config: RemitConfig) => { jev: FakeJev; llm: FakeLlm };
  config?: string;
}

/** Builds the fake repository for a golden scenario; the PR is #77 in the issue's repository. */
export function fakeRepo(scenario: string, opts: { config?: string; prNumber?: number } = {}): FakeRepo {
  const s = loadScenario(scenario);
  const issueRef = s.issues[0]?.ref ?? { owner: 'acme', repo: 'app', number: 1 };
  const pr: PullRef = { owner: issueRef.owner, repo: issueRef.repo, number: opts.prNumber ?? 77 };
  const diff = parseDiff(s.input.diffText);
  const files: PullFile[] = diff.files.map((f) => {
    const lines = f.hunks.flatMap((h) => h.lines);
    return {
      filename: filePath(f),
      status:
        f.status === 'added'
          ? 'added'
          : f.status === 'deleted'
            ? 'removed'
            : f.status === 'renamed'
              ? 'renamed'
              : 'modified',
      ...(f.status === 'renamed' && f.oldPath ? { previousFilename: f.oldPath } : {}),
      patch: f.hunks.flatMap((h) => renderHunk(h)).join('\n'),
      additions: lines.filter((l) => l.type === 'add').length,
      deletions: lines.filter((l) => l.type === 'del').length,
    };
  });
  const gh = new FakeGitHub().addPull(pr, {
    title: 'Implement the issue',
    body: `${s.input.pr.body}\n\nCloses #${issueRef.number}`.trim(),
    author: 'agent',
    draft: false,
    baseSha: 'base0000',
    headSha: 'head0000',
    files,
    closing: s.issues.map((i) => i.ref),
  });
  for (const i of s.issues)
    gh.addIssue(i.ref, {
      title: i.title,
      body: i.body,
      author: i.author,
      comments: i.comments.map((c) => ({
        id: c.id,
        author: c.author,
        body: c.body,
        association: c.role === 'maintainer' ? 'MEMBER' : 'NONE',
      })),
    });
  for (const [side, sha] of [
    ['base', 'base0000'],
    ['head', 'head0000'],
  ] as const)
    for (const [p, text] of Object.entries(tree(join(s.dir, side))))
      gh.addContent(pr.owner, pr.repo, sha, p, text);
  if (opts.config) gh.addContent(pr.owner, pr.repo, 'main', '.remit.yml', opts.config);
  gh.permissions.set(`${pr.owner}/${pr.repo}:maintainer`, 'write');
  gh.permissions.set(`${pr.owner}/${pr.repo}:reader`, 'read');
  return {
    gh,
    pr,
    installationId: 4242,
    providers: () => ({
      jev: new FakeJev(s.jevScript, 'jev-1.13.0', scenario),
      llm: new FakeLlm(s.llmScript),
    }),
    ...(opts.config ? { config: opts.config } : {}),
  };
}
