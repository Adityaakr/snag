import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeGitHub, type PullFile } from '@remit/providers';
import { describe, expect, it } from 'vitest';
import { explicitRequirementCount, mineSeeds, qualifies } from './mine.js';

const file = (filename: string, n: number, status: PullFile['status'] = 'modified'): PullFile => ({
  filename,
  status,
  additions: n,
  deletions: 0,
  patch: '@@',
});
const twoReqs = '- [ ] Export CSV\n- [ ] Include a header row\n';

describe('real seed criteria (G.2)', () => {
  it('counts task lists, numbered lists and should statements', () => {
    expect(explicitRequirementCount({ body: twoReqs })).toBe(2);
    expect(explicitRequirementCount({ body: '1. a\n2) b\n3. c' })).toBe(3);
    expect(explicitRequirementCount({ body: 'It should retry. It must log. Thanks!' })).toBe(2);
    expect(explicitRequirementCount({ body: 'Please fix the bug.' })).toBe(0);
  });

  it('rejects each failing criterion', () => {
    const ok = {
      closing: 1,
      issue: { body: twoReqs },
      files: [file('src/a.ts', 30)],
      mergedAt: '2025-03-01T00:00:00Z',
    };
    expect(qualifies(ok)).toBeNull();
    expect(qualifies({ ...ok, closing: 2 })).toBe('not_one_closing_issue');
    expect(qualifies({ ...ok, issue: { body: 'fix it' } })).toBe('too_few_requirements');
    expect(qualifies({ ...ok, files: [file('src/a.ts', 5)] })).toBe('size_out_of_range');
    expect(qualifies({ ...ok, files: [file('src/a.ts', 900)] })).toBe('size_out_of_range');
    expect(qualifies({ ...ok, files: [file('src/a.ts', 20), file('pnpm-lock.yaml', 40)] })).toBe(
      'generated_dominated',
    );
    expect(qualifies({ ...ok, mergedAt: '2023-12-31T00:00:00Z' })).toBe('merged_out_of_range');
  });
});

describe('mineSeeds', () => {
  it('writes qualifying candidates with only what the eval needs, and skips non-permissive repos', async () => {
    const gh = new FakeGitHub();
    gh.licenses.set('acme/tool', 'MIT');
    gh.licenses.set('gpl/tool', 'GPL-3.0');
    const pull = (n: number, files: PullFile[], closing: number[]) => {
      const ref = { owner: 'acme', repo: 'tool', number: n };
      gh.addPull(ref, {
        title: `PR ${n}`,
        body: 'Closes the issue.',
        author: 'dev',
        draft: false,
        baseSha: `b${n}`,
        headSha: `h${n}`,
        files,
        closing: closing.map((c) => ({ owner: 'acme', repo: 'tool', number: c })),
      }).setMerged(ref, `2025-01-0${n}T00:00:00Z`);
    };
    gh.addIssue(
      { owner: 'acme', repo: 'tool', number: 100 },
      { title: 'CSV export', body: twoReqs, author: 'pm' },
    );
    gh.addIssue(
      { owner: 'acme', repo: 'tool', number: 101 },
      { title: 'Vague', body: 'make it better', author: 'pm' },
    );
    pull(1, [file('src/export.ts', 25), file('src/new.ts', 10, 'added'), file('pnpm-lock.yaml', 2)], [100]);
    pull(2, [file('src/a.ts', 30)], []);
    pull(3, [file('src/a.ts', 30)], [101]);
    gh.addContent('acme', 'tool', 'b1', 'src/export.ts', 'old\n');
    gh.addContent('acme', 'tool', 'h1', 'src/export.ts', 'new\n');
    gh.addContent('acme', 'tool', 'h1', 'src/new.ts', 'added\n');
    const outDir = mkdtempSync(join(tmpdir(), 'remit-mine-'));
    const r = await mineSeeds(gh, { repos: { ts: ['acme/tool', 'gpl/tool'], py: [], rs: [] }, outDir });
    expect(r.candidates).toEqual(['ts-acme-tool-1']);
    expect(r.rejected).toEqual({ not_one_closing_issue: 1, too_few_requirements: 1 });
    expect(r.skippedRepos).toEqual([{ repo: 'gpl/tool', reason: 'license GPL-3.0' }]);
    const dir = join(outDir, 'ts-acme-tool-1');
    expect(readFileSync(join(dir, 'base/src/export.ts'), 'utf8')).toBe('old\n');
    expect(readFileSync(join(dir, 'head/src/new.ts'), 'utf8')).toBe('added\n');
    expect(existsSync(join(dir, 'head/pnpm-lock.yaml'))).toBe(false);
    expect(readFileSync(join(dir, 'issue.md'), 'utf8')).toContain('<!-- issue: acme/tool#100 -->');
    expect(JSON.parse(readFileSync(join(dir, 'candidate.json'), 'utf8'))).toMatchObject({
      license: 'MIT',
      baseSha: 'b1',
      headSha: 'h1',
      changedLines: 37,
    });
  });
});
