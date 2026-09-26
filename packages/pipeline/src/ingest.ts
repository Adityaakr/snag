/**
 * GitHub ingest (BUILD_PROMPT 6.1): PR snapshot, the diff rebuilt from the files API (with local diff fallback),
 * linked issues (GraphQL closing references, then closing keywords, then weak plain references) and issue
 * snapshots. Shared by the CLI, the App and the Action.
 */
import type { ContentSource } from '@remit/analysis';
import type { IssueSnapshot } from '@remit/core';
import {
  type GitHubProvider,
  githubContents,
  linkIssues,
  ProviderError,
  type PullRef,
  type PullSnapshot,
  pullDiff,
} from '@remit/providers';
import type { ReviewInput } from './types.js';

export interface IngestResult {
  input: ReviewInput;
  pr: PullSnapshot;
  contents: ContentSource;
  warnings: string[];
}

/** Parses `https://github.com/o/r/pull/12` or `o/r#12`. */
export function parsePullTarget(text: string): PullRef | null {
  const url = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)\/?(?:[#?/].*)?$/.exec(text);
  const short = /^([\w.-]+)\/([\w.-]+)#(\d+)$/.exec(text);
  const m = url ?? short;
  return m ? { owner: m[1] as string, repo: m[2] as string, number: Number(m[3]) } : null;
}

export async function ingestPullRequest(gh: GitHubProvider, ref: PullRef): Promise<IngestResult> {
  const warnings: string[] = [];
  const pr = await gh.getPull(ref);
  const files = await gh.listPullFiles(ref);
  if (files.length >= 3000)
    warnings.push('This PR has at least 3,000 changed files; GitHub lists only the first 3,000.');
  const diff = await pullDiff(gh, pr, files);
  for (const f of diff.ignored)
    warnings.push(`${f.file} was not reviewed (${f.reason === 'too_large' ? 'over 1 MB' : 'binary'}).`);
  let graphqlRefs: Awaited<ReturnType<GitHubProvider['closingIssues']>> = [];
  try {
    graphqlRefs = await gh.closingIssues(ref);
  } catch (e) {
    if (!(e instanceof ProviderError)) throw e;
    warnings.push(
      `Closing issue references could not be read (${e.message}); using the PR description only.`,
    );
  }
  const links = linkIssues(graphqlRefs, pr.body, ref.owner, ref.repo);
  if (links.strength === 'weak')
    warnings.push(
      'No closing reference was found; using plain issue references from the PR description, which may be unrelated.',
    );
  const issues: IssueSnapshot[] = [];
  for (const i of links.issues) {
    try {
      issues.push(await gh.getIssue(i));
    } catch (e) {
      if (!(e instanceof ProviderError)) throw e;
      warnings.push(`Issue ${i.owner}/${i.repo}#${i.number} could not be read (${e.message}).`);
    }
  }
  issues.sort((a, b) => a.ref.number - b.ref.number);
  const input: ReviewInput = {
    mode: 'github',
    repo: `${ref.owner}/${ref.repo}`,
    prNumber: ref.number,
    baseSha: pr.baseSha,
    headSha: pr.headSha,
    linkStrength: issues.length ? links.strength : 'none',
    issueRefs: issues.map((i) => i.ref),
    issues,
    pr: { title: pr.title, body: pr.body, author: pr.author },
    diffText: diff.text,
  };
  return { input, pr, contents: githubContents(gh, pr), warnings };
}
