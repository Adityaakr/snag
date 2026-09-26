import { describe, expect, it } from 'vitest';
import { claimSentences, MAX_CLAIM_SENTENCES } from './claims.js';

describe('claimSentences (6.8)', () => {
  it('splits sentences and bullets, dropping code, boilerplate and short fragments', () => {
    const body = `## Summary
Implements the CSV export. All requirements are done.

- Adds a header row to every export
- [x] I have added tests
- ok

\`\`\`ts
// Part 2 comes later, ignore this code
\`\`\`
<!-- Please describe your change below -->
Fixes #12
Part 1 of #20. R2 (email notifications) comes in a follow-up.`;
    expect(claimSentences('Add CSV export for reports', body)).toEqual([
      'Add CSV export for reports',
      'Implements the CSV export.',
      'All requirements are done.',
      'Adds a header row to every export',
      'R2 (email notifications) comes in a follow-up.',
    ]);
  });

  it('caps at 40 sentences and removes duplicates', () => {
    const body = Array.from({ length: 60 }, (_, i) => `- This is claim number ${i} about the change`).join(
      '\n',
    );
    expect(claimSentences('', `${body}\n${body}`)).toHaveLength(MAX_CLAIM_SENTENCES);
    expect(claimSentences('', '')).toEqual([]);
  });
});
