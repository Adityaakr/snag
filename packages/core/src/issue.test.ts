import { describe, expect, it } from 'vitest';
import { issueContentHash } from './issue.js';

const base = {
  ref: { owner: 'a', repo: 'b', number: 1 },
  title: 't',
  body: 'b',
  author: 'x',
  state: 'open' as const,
  comments: [{ id: 'c1', author: 'y', role: 'other' as const, createdAt: '2026-01-01', body: 'hi' }],
};

describe('issueContentHash', () => {
  it('is stable and ignores non-content fields', () => {
    expect(issueContentHash(base)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(issueContentHash({ ...base, author: 'renamed', state: 'closed' })).toBe(issueContentHash(base));
  });

  it('changes when the issue text or comments change', () => {
    expect(issueContentHash({ ...base, body: 'edited' })).not.toBe(issueContentHash(base));
    expect(issueContentHash({ ...base, comments: [] })).not.toBe(issueContentHash(base));
  });
});
