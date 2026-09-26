import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { IssueSnapshot, Requirement } from '../contracts/index.js';
import { issueExcerpt, issueQuestions, issueState } from './issue.js';

const spec = readFileSync(join(import.meta.dirname, '..', '..', '..', '..', 'BUILD_PROMPT.md'), 'utf8');

/** Reads `| id | Noul | instructions | **true:** x<br>**false:** y |` rows of one Appendix C section. */
function specRows(section: string): Map<string, { instructions: string; t?: string; f?: string }> {
  const start = spec.indexOf(section);
  const end = spec.indexOf('\n### ', start + 5);
  const rows = new Map<string, { instructions: string; t?: string; f?: string }>();
  for (const line of spec.slice(start, end).split('\n')) {
    const m = /^\| `([a-z_{}]+)` \| (\w+) \| (.+?) \| (.*) \|$/.exec(line);
    if (!m) continue;
    const crit = m[4] as string;
    const t = /\*\*true:\*\* (.+?)(?:<br>|$)/.exec(crit)?.[1];
    const f = /\*\*false:\*\* (.+)$/.exec(crit)?.[1];
    rows.set(m[1] as string, { instructions: m[3] as string, ...(t ? { t } : {}), ...(f ? { f } : {}) });
  }
  return rows;
}

describe('issue.v0 (Appendix C.1)', () => {
  it('matches the spec wording exactly', () => {
    const rows = specRows('### C.1 `issue.v0`');
    const qs = issueQuestions();
    expect([...rows.keys()]).toEqual(Object.keys(qs));
    for (const [id, q] of Object.entries(qs)) {
      const row = rows.get(id);
      expect(q.instructions).toBe(row?.instructions);
      expect(q.criteria).toEqual({ true: row?.t, false: row?.f });
    }
  });

  const issue: IssueSnapshot = {
    ref: { owner: 'a', repo: 'b', number: 1 },
    title: 'T',
    body: `${'x '.repeat(2000)}only return recent orders ${'y '.repeat(2000)}`,
    author: 'm',
    state: 'open',
    comments: [{ id: 'c1', author: 'l', role: 'maintainer', createdAt: 'now', body: 'Use 7 days.' }],
    contentHash: 'h',
  };
  const req = (over: Partial<Requirement>): Requirement => ({
    id: 'R1',
    issue: issue.ref,
    text: 'Only recent orders are returned.',
    quote: 'only return recent orders',
    source: { kind: 'body' },
    kind: 'behavior',
    explicitness: 'explicit',
    priority: 'must',
    examples: [],
    checkableInCode: true,
    ...over,
  });

  it('builds a state with at most 1,500 excerpt characters centered on the quote', () => {
    const state = issueState(issue, req({}));
    expect(state.issue_excerpt.length).toBe(1500);
    expect(state.issue_excerpt).toContain('only return recent orders');
    expect(state.requirement).toEqual({
      text: 'Only recent orders are returned.',
      quote: 'only return recent orders',
    });
  });

  it('uses the comment or title as the excerpt source', () => {
    expect(
      issueExcerpt(issue, req({ quote: 'Use 7 days', source: { kind: 'comment', commentId: 'c1' } })),
    ).toBe('Use 7 days.');
    expect(issueExcerpt(issue, req({ quote: 'T', source: { kind: 'title' } }))).toBe('T');
  });
});
