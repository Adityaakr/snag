import { createHash } from 'node:crypto';
import type { IssueSnapshot } from './contracts/index.js';

/**
 * Content hash of an issue: title, body and comments (id, role, body). Used as the extraction cache key and to
 * find confirmed checklists (BUILD_PROMPT 6.2, 10.2). Stable across key order and author renames.
 */
export function issueContentHash(issue: Omit<IssueSnapshot, 'contentHash'>): string {
  const payload = JSON.stringify({
    title: issue.title,
    body: issue.body,
    comments: issue.comments.map((c) => [c.id, c.role, c.body]),
  });
  return `sha256:${createHash('sha256').update(payload).digest('hex')}`;
}
