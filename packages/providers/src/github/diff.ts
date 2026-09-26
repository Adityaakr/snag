/**
 * Builds a unified diff from the PR files API. When GitHub omits a patch for a text file (large diffs), both
 * versions are fetched and diffed locally (BUILD_PROMPT 6.1). Binary and oversized files become binary markers.
 */
import { createTwoFilesPatch } from 'diff';
import type { GitHubProvider, PullFile, PullSnapshot } from './types.js';

export interface PullDiff {
  text: string;
  /** Files listed as ignored (binary or over 1 MB), with the reason. */
  ignored: { file: string; reason: 'binary' | 'too_large' }[];
}

function header(f: PullFile): string[] {
  const oldPath = f.previousFilename ?? f.filename;
  const lines = [`diff --git a/${oldPath} b/${f.filename}`];
  if (f.status === 'added') lines.push('new file mode 100644');
  if (f.status === 'removed') lines.push('deleted file mode 100644');
  if (f.status === 'renamed' || f.status === 'copied') {
    const verb = f.status === 'renamed' ? 'rename' : 'copy';
    lines.push(`${verb} from ${oldPath}`, `${verb} to ${f.filename}`);
  }
  return lines;
}

function sides(f: PullFile): [string, string] {
  const oldPath = f.previousFilename ?? f.filename;
  return [
    f.status === 'added' ? '/dev/null' : `a/${oldPath}`,
    f.status === 'removed' ? '/dev/null' : `b/${f.filename}`,
  ];
}

export async function pullDiff(gh: GitHubProvider, pr: PullSnapshot, files: PullFile[]): Promise<PullDiff> {
  const out: string[] = [];
  const ignored: PullDiff['ignored'] = [];
  const [owner, repo] = [pr.ref.owner, pr.ref.repo];
  const [headOwner, headRepo] = pr.headRepo.split('/') as [string, string];
  for (const f of files) {
    const [a, b] = sides(f);
    if (f.patch !== undefined) {
      if (f.patch === '' && f.additions + f.deletions === 0) {
        out.push(...header(f));
        continue;
      }
      out.push(...header(f), `--- ${a}`, `+++ ${b}`, f.patch);
      continue;
    }
    if (f.additions + f.deletions === 0 && f.status !== 'modified') {
      out.push(...header(f)); // pure rename, copy or empty file
      continue;
    }
    // No patch: fetch both sides and diff locally, unless binary or too large.
    const before =
      f.status === 'added'
        ? { content: '' }
        : await gh.getContent(owner, repo, f.previousFilename ?? f.filename, pr.baseSha);
    const after =
      f.status === 'removed'
        ? { content: '' }
        : await gh.getContent(headOwner, headRepo, f.filename, pr.headSha);
    const skip = [before, after].find((x) => x !== null && 'skipped' in x) as
      | { skipped: 'binary' | 'too_large' }
      | undefined;
    if (skip || before === null || after === null) {
      const reason = skip?.skipped ?? 'binary';
      ignored.push({ file: f.filename, reason });
      out.push(...header(f), `Binary files ${a} and ${b} differ`);
      continue;
    }
    const patch = createTwoFilesPatch(
      a,
      b,
      (before as { content: string }).content,
      (after as { content: string }).content,
      '',
      '',
      { context: 3 },
    );
    const body = patch.split('\n').slice(1).join('\n').replace(/\t$/gm, ''); // drop jsdiff's "===" separator line
    out.push(...header(f), body.trimEnd());
  }
  return { text: out.length ? `${out.join('\n')}\n` : '', ignored };
}

/** Contents at the PR's base (base repo) and head (head repo, which differs for forks), for the unit builder. */
export function githubContents(gh: GitHubProvider, pr: PullSnapshot) {
  const [headOwner, headRepo] = pr.headRepo.split('/') as [string, string];
  return {
    async get(side: 'base' | 'head', path: string): Promise<string | null> {
      const r =
        side === 'base'
          ? await gh.getContent(pr.ref.owner, pr.ref.repo, path, pr.baseSha)
          : await gh.getContent(headOwner, headRepo, path, pr.headSha);
      return r && 'content' in r ? r.content : null;
    },
  };
}
