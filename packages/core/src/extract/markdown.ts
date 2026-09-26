/**
 * Local issue files (BUILD_PROMPT 6.1): the first `# ` line is the title; each `## Comment by @login` section is
 * a comment, role `other` unless `(author)` or `(maintainer)` follows the login. An optional
 * `<!-- issue: owner/repo#12 -->` line sets the issue reference (default `local/local#1`), and
 * `<!-- author: login -->` sets the opener.
 */
import type { IssueRef, IssueSnapshot } from '../contracts/index.js';
import { issueContentHash } from '../issue.js';

const COMMENT = /^##\s+Comment by @([\w.-]+(?:\[bot\])?)(?:\s+\((author|maintainer)\))?\s*$/i;

export function parseIssueMarkdown(
  text: string,
  fallback: IssueRef = { owner: 'local', repo: 'local', number: 1 },
): IssueSnapshot {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let ref = fallback;
  let author = 'local';
  let title = '';
  const body: string[] = [];
  const comments: IssueSnapshot['comments'] = [];
  let current: { author: string; role: 'author' | 'maintainer' | 'other'; lines: string[] } | null = null;
  const flush = () => {
    if (current) {
      comments.push({
        id: `c${comments.length + 1}`,
        author: current.author,
        role: current.role,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, comments.length)).toISOString(),
        body: current.lines.join('\n').trim(),
      });
    }
  };
  for (const line of lines) {
    const meta = /^<!--\s*(issue|author):\s*(.+?)\s*-->$/.exec(line.trim());
    if (meta && !current && !title) {
      if (meta[1] === 'issue') {
        const m = /^([\w.-]+)\/([\w.-]+)#(\d+)$/.exec(meta[2] as string);
        if (m) ref = { owner: m[1] as string, repo: m[2] as string, number: Number(m[3]) };
      } else author = meta[2] as string;
      continue;
    }
    if (!title && !current && /^#\s+/.test(line)) {
      title = line.replace(/^#\s+/, '').trim();
      continue;
    }
    const c = COMMENT.exec(line);
    if (c) {
      flush();
      current = {
        author: c[1] as string,
        role: (c[2]?.toLowerCase() as 'author' | 'maintainer' | undefined) ?? 'other',
        lines: [],
      };
      continue;
    }
    if (current) current.lines.push(line);
    else body.push(line);
  }
  flush();
  const snapshot = { ref, title, body: body.join('\n').trim(), author, state: 'open' as const, comments };
  return { ...snapshot, contentHash: issueContentHash(snapshot) };
}
