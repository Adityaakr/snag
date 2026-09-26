/**
 * Real seed mining (BUILD_PROMPT G.2), only with GITHUB_TOKEN: merged PRs from active, permissively licensed
 * repositories that close exactly one issue, whose issue states at least 2 explicit requirements, that change 20 to
 * 800 lines, are not dominated by generated files or lockfiles, and were merged in 2024 to 2026. Each qualifying PR
 * becomes a candidate directory with only what the eval needs (issue text, diff, changed file versions, license,
 * SHAs). A candidate becomes a seed once it is annotated (seed.json), by hand.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { classifyFile } from '@remit/analysis';
import type { IssueSnapshot } from '@remit/core';
import { taskListRequirements } from '@remit/core';
import type { GitHubMining, PullFile, PullRef } from '@remit/providers';
import { CORPORA_ROOT } from '../corpora/files.js';

export const REAL_ROOT = join(CORPORA_ROOT, 'mutations', 'real');
export const PERMISSIVE = new Set([
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  '0BSD',
  'Unlicense',
]);
export const MERGED_RANGE = { from: '2024-01-01', to: '2026-12-31' };

/** Active, permissively licensed repositories to mine, per language. Licenses are re-checked at mining time. */
export const MINING_REPOS: Record<'ts' | 'py' | 'rs', string[]> = {
  ts: ['colinhacks/zod', 'date-fns/date-fns', 'sindresorhus/ky', 'honojs/hono', 'vitest-dev/vitest'],
  py: ['pallets/click', 'encode/httpx', 'pydantic/pydantic', 'Textualize/rich', 'python-attrs/attrs'],
  rs: ['clap-rs/clap', 'BurntSushi/ripgrep', 'tokio-rs/axum', 'serde-rs/serde', 'rust-lang/regex'],
};

/** Explicit requirements: task list items, numbered list items, or sentences with "should" or "must". */
export function explicitRequirementCount(
  issue: Pick<IssueSnapshot, 'body'> & Partial<IssueSnapshot>,
): number {
  const tasks = taskListRequirements({
    ref: { owner: 'x', repo: 'x', number: 1 },
    title: '',
    author: '',
    state: 'open',
    comments: [],
    contentHash: '',
    ...issue,
  }).length;
  const numbered = issue.body.split('\n').filter((l) => /^\s*\d+[.)]\s+\S/.test(l)).length;
  const should = issue.body.split(/(?<=[.!?])\s+/).filter((s) => /\b(should|must)\b/i.test(s)).length;
  return Math.max(tasks, numbered, should);
}

export type Rejection =
  | 'not_one_closing_issue'
  | 'too_few_requirements'
  | 'size_out_of_range'
  | 'generated_dominated'
  | 'merged_out_of_range';

export function qualifies(input: {
  closing: number;
  issue: Pick<IssueSnapshot, 'body'>;
  files: PullFile[];
  mergedAt: string;
}): Rejection | null {
  if (input.closing !== 1) return 'not_one_closing_issue';
  if (explicitRequirementCount(input.issue) < 2) return 'too_few_requirements';
  const lines = (f: PullFile) => f.additions + f.deletions;
  const total = input.files.reduce((s, f) => s + lines(f), 0);
  if (total < 20 || total > 800) return 'size_out_of_range';
  const filtered = input.files
    .filter((f) => classifyFile(f.filename).filtered)
    .reduce((s, f) => s + lines(f), 0);
  if (filtered * 2 >= total) return 'generated_dominated';
  const day = input.mergedAt.slice(0, 10);
  if (day < MERGED_RANGE.from || day > MERGED_RANGE.to) return 'merged_out_of_range';
  return null;
}

function issueMarkdown(i: IssueSnapshot): string {
  const comments = i.comments.map(
    (c) => `## Comment by @${c.author}${c.role === 'other' ? '' : ` (${c.role})`}\n\n${c.body}\n`,
  );
  return [
    `<!-- issue: ${i.ref.owner}/${i.ref.repo}#${i.ref.number} -->`,
    `<!-- author: ${i.author} -->`,
    `# ${i.title}`,
    '',
    i.body,
    '',
    ...comments,
  ].join('\n');
}

export interface MineResult {
  candidates: string[];
  rejected: Record<string, number>;
  skippedRepos: { repo: string; reason: string }[];
}

/** Mines up to `perLanguage` candidates per language. Every GitHub read goes through the given provider. */
export async function mineSeeds(
  gh: GitHubMining,
  opts: { repos?: typeof MINING_REPOS; perLanguage?: number; perRepoScan?: number; outDir?: string } = {},
): Promise<MineResult> {
  const repos = opts.repos ?? MINING_REPOS;
  const perLanguage = opts.perLanguage ?? 10;
  const outDir = opts.outDir ?? REAL_ROOT;
  const result: MineResult = { candidates: [], rejected: {}, skippedRepos: [] };
  const reject = (r: string) => {
    result.rejected[r] = (result.rejected[r] ?? 0) + 1;
  };
  for (const [lang, list] of Object.entries(repos) as ['ts' | 'py' | 'rs', string[]][]) {
    let found = 0;
    for (const full of list) {
      if (found >= perLanguage) break;
      const [owner = '', repo = ''] = full.split('/');
      const license = await gh.getLicense(owner, repo);
      if (!license || !PERMISSIVE.has(license)) {
        result.skippedRepos.push({ repo: full, reason: `license ${license ?? 'unknown'}` });
        continue;
      }
      for (const pr of await gh.searchMergedPulls(owner, repo, MERGED_RANGE, opts.perRepoScan ?? 50)) {
        if (found >= perLanguage) break;
        const ref: PullRef = pr.ref;
        const closing = await gh.closingIssues(ref);
        const first = closing[0];
        if (closing.length !== 1 || !first) {
          reject('not_one_closing_issue');
          continue;
        }
        const [issue, files, pull] = await Promise.all([
          gh.getIssue(first),
          gh.listPullFiles(ref),
          gh.getPull(ref),
        ]);
        const why = qualifies({ closing: closing.length, issue, files, mergedAt: pr.mergedAt });
        if (why) {
          reject(why);
          continue;
        }
        const id = `${lang}-${owner}-${repo}-${ref.number}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-');
        const dir = join(outDir, id);
        const write = (rel: string, text: string) => {
          mkdirSync(join(dir, rel, '..'), { recursive: true });
          writeFileSync(join(dir, rel), text);
        };
        for (const f of files) {
          if (classifyFile(f.filename).filtered) continue;
          const before =
            f.status === 'added'
              ? null
              : await gh.getContent(owner, repo, f.previousFilename ?? f.filename, pull.baseSha);
          const after =
            f.status === 'removed' ? null : await gh.getContent(owner, repo, f.filename, pull.headSha);
          if (before && 'content' in before)
            write(`base/${f.previousFilename ?? f.filename}`, before.content);
          if (after && 'content' in after) write(`head/${f.filename}`, after.content);
        }
        write('issue.md', issueMarkdown(issue));
        write('pr.md', `# ${pull.title}\n\n${pull.body}\n`);
        write(
          'candidate.json',
          `${JSON.stringify(
            {
              id,
              language: lang,
              repository: full,
              license,
              pr: ref.number,
              issue: first,
              baseSha: pull.baseSha,
              headSha: pull.headSha,
              mergedAt: pr.mergedAt,
              changedLines: files.reduce((s, f) => s + f.additions + f.deletions, 0),
              status: 'needs annotation (seed.json, annotated_by: claude-code)',
            },
            null,
            2,
          )}\n`,
        );
        result.candidates.push(id);
        found++;
      }
    }
  }
  return result;
}
