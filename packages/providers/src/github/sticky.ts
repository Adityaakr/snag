/** Sticky comments (BUILD_PROMPT 6.10, 10.2): one comment per kind and target, found again by a hidden marker. */
import { BRAND } from '@remit/core';
import type { GitHubWriter } from './types.js';

export type StickyKind = 'summary' | 'rework' | 'checklist';

/** The marker prefix; the summary marker is written by `renderComment` (`<!-- remit:summary v1 ... -->`). */
export function markerOf(kind: StickyKind): string {
  return kind === 'summary' ? `<!-- ${BRAND.commentMarker} v1` : `<!-- ${BRAND.slug}:${kind} v1`;
}

export function withMarker(kind: StickyKind, body: string, extra = ''): string {
  if (kind === 'summary') return body;
  return `${markerOf(kind)}${extra ? ` ${extra}` : ''} -->\n${body}`;
}

/** Updates the bot's comment carrying the marker, or creates one. Human comments are never edited. */
export async function upsertSticky(
  gh: GitHubWriter,
  ref: { owner: string; repo: string; number: number },
  kind: StickyKind,
  body: string,
): Promise<{ id: number; created: boolean }> {
  const marker = markerOf(kind);
  const existing = (await gh.listIssueComments(ref)).find((c) => c.authorIsBot && c.body.includes(marker));
  if (existing) {
    if (existing.body !== body) await gh.updateIssueComment(ref.owner, ref.repo, existing.id, body);
    return { id: existing.id, created: false };
  }
  return { ...(await gh.createIssueComment(ref, body)), created: true };
}
