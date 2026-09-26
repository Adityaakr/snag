/**
 * Local git ingest (BUILD_PROMPT 6.1 local mode): `base..head` and `base...head` diffs and file contents at a
 * commit. Uses execFile with argument arrays, never a shell, and rejects refs that look like options.
 */
import { execFileSync } from 'node:child_process';

/** Files over this size are skipped and listed as ignored (BUILD_PROMPT 6.1). */
export const MAX_FILE_BYTES = 1024 * 1024;

export interface GitRange {
  base: string;
  head: string;
  /** True for `base...head`: diff against the merge base, like a pull request. */
  mergeBase: boolean;
}

export class GitError extends Error {
  constructor(
    message: string,
    readonly hint: string,
  ) {
    super(`${message} ${hint}`);
    this.name = 'GitError';
  }
}

const REF_RE = /^[A-Za-z0-9_][A-Za-z0-9_./@{}^~-]*$/;

function assertRef(ref: string): void {
  if (!REF_RE.test(ref) || ref.includes('..')) {
    throw new GitError(
      `"${ref}" is not a valid git ref.`,
      'Use a branch, tag or commit SHA, for example main..HEAD.',
    );
  }
}

/** Parses `base..head` or `base...head`. Returns null when the text is not a range. */
export function parseRange(text: string): GitRange | null {
  const m = /^([^.\s][^\s]*?)(\.\.\.?)([^.\s][^\s]*)$/.exec(text.trim());
  if (!m) return null;
  const [, base, dots, head] = m as unknown as [string, string, string, string];
  // Git refs cannot contain '..' or end with '.', which also rules out 'a....b'.
  if (base.includes('..') || head.includes('..') || base.endsWith('.')) return null;
  return { base, head, mergeBase: dots === '...' };
}

export interface LocalDiff {
  baseSha: string;
  headSha: string;
  text: string;
}

/** Reads diffs and blobs from a local repository. */
export class LocalGit {
  constructor(readonly cwd: string) {}

  private git(args: string[], opts: { allowFail?: boolean; maxBuffer?: number } = {}): string | null {
    try {
      return execFileSync('git', args, {
        cwd: this.cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: opts.maxBuffer ?? 256 * 1024 * 1024,
      });
    } catch (e) {
      if (opts.allowFail) return null;
      const stderr = (e as { stderr?: string }).stderr?.trim() ?? String(e);
      throw new GitError(
        `git ${args[0]} failed: ${stderr.split('\n')[0]}`,
        'Check that you are inside a git repository and the refs exist.',
      );
    }
  }

  /** Resolves a ref to a full commit SHA. */
  resolve(ref: string): string {
    assertRef(ref);
    const out = this.git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { allowFail: true });
    if (!out)
      throw new GitError(`Cannot find commit "${ref}".`, 'Run `git log --oneline` to see available commits.');
    return out.trim();
  }

  /** Produces the unified diff for a range, with rename detection and a/ b/ prefixes. */
  diff(range: GitRange): LocalDiff {
    const head = this.resolve(range.head);
    let base = this.resolve(range.base);
    if (range.mergeBase) {
      const mb = this.git(['merge-base', base, head], { allowFail: true });
      if (!mb)
        throw new GitError(
          `"${range.base}" and "${range.head}" have no common ancestor.`,
          'Use base..head instead.',
        );
      base = mb.trim();
    }
    const text = this.git([
      'diff',
      '--no-color',
      '--no-ext-diff',
      '--no-textconv',
      '--find-renames',
      '--src-prefix=a/',
      '--dst-prefix=b/',
      base,
      head,
    ]) as string;
    return { baseSha: base, headSha: head, text };
  }

  /** Blob size in bytes, or null when the path does not exist at that commit. */
  size(sha: string, path: string): number | null {
    const out = this.git(['cat-file', '-s', `${sha}:${path}`], { allowFail: true });
    return out === null ? null : Number(out.trim());
  }

  /**
   * File content at a commit. Returns null when the file does not exist, and `{ skipped }` when it is too
   * large or binary.
   */
  show(sha: string, path: string): { content: string } | { skipped: 'too_large' | 'binary' } | null {
    const size = this.size(sha, path);
    if (size === null) return null;
    if (size > MAX_FILE_BYTES) return { skipped: 'too_large' };
    const buf = execFileSync('git', ['cat-file', 'blob', `${sha}:${path}`], {
      cwd: this.cwd,
      maxBuffer: MAX_FILE_BYTES * 2,
    });
    if (buf.includes(0)) return { skipped: 'binary' };
    return { content: buf.toString('utf8') };
  }

  /** Paths of every file at a commit. */
  listFiles(sha: string): string[] {
    return (this.git(['ls-tree', '-r', '--name-only', '-z', sha]) as string).split('\0').filter(Boolean);
  }
}

/** Adapts LocalGit to the ContentSource shape used by the unit builder. Skipped files read as null. */
export function localContents(git: LocalGit, baseSha: string, headSha: string) {
  return {
    async get(side: 'base' | 'head', path: string): Promise<string | null> {
      const r = git.show(side === 'base' ? baseSha : headSha, path);
      return r && 'content' in r ? r.content : null;
    },
  };
}
