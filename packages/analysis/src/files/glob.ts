/**
 * Gitignore-style glob matching, used for `.gitattributes`, file classes and `ignore_paths`.
 * - A pattern without a slash matches the basename at any depth (`*.min.js`).
 * - A pattern with a slash is anchored to the repo root (`docs/**`, `/build`).
 * - `**` matches any number of directories, `*` anything but `/`, `?` one character but `/`.
 * - A trailing `/**` or a directory name matches everything below it.
 */

const cache = new Map<string, RegExp>();

function escapeRegex(ch: string): string {
  return /[.+^${}()|[\]\\]/.test(ch) ? `\\${ch}` : ch;
}

/** Compiles a glob to a regex over repo-relative paths with forward slashes. */
export function globToRegExp(pattern: string): RegExp {
  const cached = cache.get(pattern);
  if (cached) return cached;
  let p = pattern.trim();
  const anchored = p.startsWith('/') || p.slice(0, -1).includes('/');
  p = p.replace(/^\//, '').replace(/\/$/, '/**');
  let re = '';
  for (let i = 0; i < p.length; i++) {
    const ch = p[i] as string;
    if (ch === '*') {
      if (p[i + 1] === '*') {
        const slashAfter = p[i + 2] === '/';
        const atStart = i === 0 || p[i - 1] === '/';
        if (atStart && slashAfter) {
          re += '(?:.*/)?';
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else {
        re += '[^/]*';
      }
    } else if (ch === '?') {
      re += '[^/]';
    } else {
      re += escapeRegex(ch);
    }
  }
  const prefix = anchored ? '^' : '^(?:.*/)?';
  // A plain name (no wildcard at the end) also matches a directory and everything below it.
  const compiled = new RegExp(`${prefix}${re}(?:/.*)?$`);
  cache.set(pattern, compiled);
  return compiled;
}

/** True when the path matches the glob. */
export function matchGlob(path: string, pattern: string): boolean {
  return globToRegExp(pattern).test(path.replace(/\\/g, '/').replace(/^\.\//, ''));
}

/** True when the path matches any of the globs. */
export function matchAny(path: string, patterns: readonly string[]): boolean {
  return patterns.some((p) => matchGlob(path, p));
}
