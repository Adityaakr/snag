/**
 * Linked issue detection (BUILD_PROMPT 6.1): GraphQL closing references, then closing keywords in the PR body,
 * then (only when neither finds anything) plain references marked weak. Never fetches URLs; issue URLs are
 * parsed as text and must point at github.com.
 */
import type { IssueRef } from '@remit/core';
import type { LinkedIssues } from './types.js';

const KEYWORDS = '(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)';
const OWNER_REPO = '([A-Za-z0-9][A-Za-z0-9-]*)/([A-Za-z0-9._-]+)';
const TARGET = `(?:${OWNER_REPO}#(\\d+)|#(\\d+)|https://github\\.com/${OWNER_REPO}/issues/(\\d+))`;

const CLOSING = new RegExp(`\\b${KEYWORDS}\\b:?\\s+${TARGET}`, 'gi');
const PLAIN = new RegExp(`(?:^|[\\s(\\[])${TARGET}\\b`, 'g');

function stripCode(body: string): string {
  return body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
}

function refFrom(m: RegExpMatchArray, offset: number, owner: string, repo: string): IssueRef {
  const [o1, r1, n1, n2, o3, r3, n3] = m.slice(offset, offset + 7);
  if (n1) return { owner: o1 as string, repo: r1 as string, number: Number(n1) };
  if (n2) return { owner, repo, number: Number(n2) };
  return { owner: o3 as string, repo: r3 as string, number: Number(n3) };
}

function unique(refs: IssueRef[]): IssueRef[] {
  const seen = new Map<string, IssueRef>();
  for (const r of refs) seen.set(`${r.owner.toLowerCase()}/${r.repo.toLowerCase()}#${r.number}`, r);
  return [...seen.values()].sort((a, b) => a.number - b.number);
}

/** Issues closed by keywords (`fixes #12`, `closes owner/repo#3`, `resolves https://github.com/o/r/issues/4`). */
export function closingKeywordRefs(body: string, owner: string, repo: string): IssueRef[] {
  return unique([...stripCode(body).matchAll(CLOSING)].map((m) => refFrom(m, 1, owner, repo)));
}

/** Plain references (`#12`, `refs #12`, `owner/repo#3`). */
export function plainRefs(body: string, owner: string, repo: string): IssueRef[] {
  return unique([...stripCode(body).matchAll(PLAIN)].map((m) => refFrom(m, 1, owner, repo)));
}

/** Combines the three sources in priority order. */
export function linkIssues(graphql: IssueRef[], body: string, owner: string, repo: string): LinkedIssues {
  const closing = unique([...graphql, ...closingKeywordRefs(body, owner, repo)]);
  if (closing.length) return { issues: closing, strength: 'closing' };
  const weak = plainRefs(body, owner, repo);
  if (weak.length) return { issues: weak, strength: 'weak' };
  return { issues: [], strength: 'none' };
}
